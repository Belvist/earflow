/**
 * Offline Recommendations Worker
 * Вычисляет персонализированные рекомендации используя SQL
 * БЕЗ загрузки всех данных в память (масштабируется до миллионов записей)
 * @module workers/offlineWorker
 */

require('dotenv').config();

const config = require('../config');
const { createLogger, logError, logEvent, logPerformance } = require('../lib/logger');
const { query, getClient, checkConnection: checkDb, close: closeDb } = require('../lib/database');
const redis = require('../lib/redis');
const { createHealthServer } = require('../lib/workerHealth');
const { computeUserRecommendations } = require('./algorithms/personalRecommendations');

const logger = createLogger('offline-worker');

// ============================================
// Worker State
// ============================================

let isShuttingDown = false;
const workerId = `offline-${process.pid}-${Date.now()}`;

const shardCount = Number(config.offlineWorker.shardCount) || 1;
const shardIndex = Number(config.offlineWorker.shardIndex) || 0;
const lockKey = config.redisKeys.offlineWorkerLock(shardCount > 1 ? shardIndex : null);

// Health check server
const HEALTH_PORT = Number.parseInt(process.env.OFFLINE_WORKER_HEALTH_PORT || '3017', 10);
let healthServer = null;
let healthHeartbeatTimer = null;
let totalUsersProcessed = 0;
let totalIterations = 0;
let lastIterationDurationMs = 0;
let currentPhase = 'idle';

// ============================================
// Graceful Shutdown
// ============================================

async function shutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.info({ signal, workerId }, 'Initiating shutdown...');

  // Закрываем health server
  if (healthServer) {
    try {
      await healthServer.close();
    } catch (err) {
      logError(err, 'shutdown-health');
    }
  }

  if (healthHeartbeatTimer) {
    clearInterval(healthHeartbeatTimer);
    healthHeartbeatTimer = null;
  }

  try {
    await redis.releaseLock(workerId, { key: lockKey });
  } catch (err) {
    logError(err, 'shutdown-release-lock');
  }

  try {
    await closeDb();
  } catch (err) {
    logError(err, 'shutdown-db');
  }

  try {
    await redis.disconnect();
  } catch (err) {
    logError(err, 'shutdown-redis');
  }

  logger.info({ workerId }, 'Shutdown complete');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ============================================
// SQL-based Score Computation
// ============================================

/**
 * Вычисляет глобальный топ песен (SQL, без загрузки в память)
 * Улучшенный алгоритм с учётом:
 * - Популярности и прослушиваний
 * - Лайков/дизлайков (из таблиц likes/dislikes)
 * - Истории прослушивания (user_history)
 * - Взаимодействий (user_interactions)
 * - Time decay для свежести
 * @returns {Promise<number[]>}
 */
async function computeGlobalTop() {
  const startTime = Date.now();
  const weights = config.offlineWorker.weights;
  const topN = config.offlineWorker.topN;
  const maxPerArtist = Number(config.offlineWorker.globalTopMaxPerArtist) || 0;

  // Вычисляем скоры с учётом реальной схемы БД
  const result = await query(`
    WITH song_stats AS (
      SELECT
        s.id,
        s.artist,
        s.genre,
        COALESCE(s.popularity, 0)::numeric AS popularity,
        COALESCE(s.play_count, 0)::numeric AS play_count,
        COALESCE(h.total_plays, 0)::numeric AS user_play_count,
        COALESCE(h.total_play_time, 0)::numeric AS total_play_time,
        COALESCE(h.skip_count, 0)::numeric AS user_skip_count,
        COALESCE(lk.like_count, 0)::numeric AS like_count,
        COALESCE(dlk.dislike_count, 0)::numeric AS dislike_count,
        COALESCE(recent.recent_plays, 0)::numeric AS recent_plays,
        -- Возраст трека в днях для time decay
        GREATEST(1, EXTRACT(EPOCH FROM (NOW() - s.created_at)) / 86400)::numeric AS age_days
      FROM songs s
      -- Агрегация из user_history
      LEFT JOIN (
        SELECT
          song_id,
          SUM(play_count) AS total_plays,
          SUM(total_play_time) AS total_play_time,
          SUM(skip_count) AS skip_count
        FROM user_history
        GROUP BY song_id
      ) h ON s.id = h.song_id
      -- Лайки из таблицы likes
      LEFT JOIN (
        SELECT song_id, COUNT(*) AS like_count
        FROM likes
        GROUP BY song_id
      ) lk ON s.id = lk.song_id
      -- Дизлайки из таблицы dislikes
      LEFT JOIN (
        SELECT song_id, COUNT(*) AS dislike_count
        FROM dislikes
        GROUP BY song_id
      ) dlk ON s.id = dlk.song_id
      -- Недавние прослушивания (последние 7 дней)
      LEFT JOIN (
        SELECT song_id, COUNT(*) AS recent_plays
        FROM user_interactions
        WHERE interaction_type = 'play' 
          AND created_at > NOW() - INTERVAL '7 days'
        GROUP BY song_id
      ) recent ON s.id = recent.song_id
      WHERE COALESCE(s.is_available, true) = true
    ),
    normalized AS (
      SELECT
        id,
        artist,
        genre,
        age_days,
        -- Min-Max normalization с защитой от деления на 0
        CASE WHEN MAX(popularity) OVER() - MIN(popularity) OVER() = 0 THEN 0.5
          ELSE (popularity - MIN(popularity) OVER()) / NULLIF(MAX(popularity) OVER() - MIN(popularity) OVER(), 1)
        END AS pop_norm,
        CASE WHEN MAX(play_count) OVER() - MIN(play_count) OVER() = 0 THEN 0.5
          ELSE (play_count - MIN(play_count) OVER()) / NULLIF(MAX(play_count) OVER() - MIN(play_count) OVER(), 1)
        END AS pc_norm,
        CASE WHEN MAX(user_play_count) OVER() - MIN(user_play_count) OVER() = 0 THEN 0
          ELSE (user_play_count - MIN(user_play_count) OVER()) / NULLIF(MAX(user_play_count) OVER() - MIN(user_play_count) OVER(), 1)
        END AS upc_norm,
        CASE WHEN MAX(like_count) OVER() - MIN(like_count) OVER() = 0 THEN 0
          ELSE (like_count - MIN(like_count) OVER()) / NULLIF(MAX(like_count) OVER() - MIN(like_count) OVER(), 1)
        END AS ulc_norm,
        CASE WHEN MAX(user_skip_count) OVER() - MIN(user_skip_count) OVER() = 0 THEN 0
          ELSE (user_skip_count - MIN(user_skip_count) OVER()) / NULLIF(MAX(user_skip_count) OVER() - MIN(user_skip_count) OVER(), 1)
        END AS usc_norm,
        CASE WHEN MAX(dislike_count) OVER() - MIN(dislike_count) OVER() = 0 THEN 0
          ELSE (dislike_count - MIN(dislike_count) OVER()) / NULLIF(MAX(dislike_count) OVER() - MIN(dislike_count) OVER(), 1)
        END AS dlc_norm,
        CASE WHEN MAX(recent_plays) OVER() - MIN(recent_plays) OVER() = 0 THEN 0
          ELSE (recent_plays - MIN(recent_plays) OVER()) / NULLIF(MAX(recent_plays) OVER() - MIN(recent_plays) OVER(), 1)
        END AS recent_norm
      FROM song_stats
    ),
    scored AS (
      SELECT
        id,
        artist,
        genre,
        -- Базовый скор с весами
        (
          ($1::numeric * COALESCE(pop_norm, 0)) +
          ($2::numeric * COALESCE(pc_norm, 0)) +
          ($3::numeric * COALESCE(upc_norm, 0)) +
          ($4::numeric * COALESCE(ulc_norm, 0)) +
          ($5::numeric * COALESCE(usc_norm, 0)) +
          (-0.3 * COALESCE(dlc_norm, 0)) +
          (0.15 * COALESCE(recent_norm, 0))
        ) * (
          -- Time decay: новые треки получают небольшой буст
          CASE 
            WHEN age_days <= 7 THEN 1.2
            WHEN age_days <= 30 THEN 1.1
            WHEN age_days <= 90 THEN 1.0
            ELSE 0.95
          END
        ) AS base_score
      FROM normalized
    )
    SELECT id
    FROM (
      SELECT
        id,
        base_score,
        ROW_NUMBER() OVER (
          PARTITION BY lower(btrim(COALESCE(artist, '')))
          ORDER BY base_score DESC
        ) AS artist_rn
      FROM scored
    ) t
    WHERE ($7::int <= 0 OR t.artist_rn <= $7::int)
    ORDER BY base_score DESC
    LIMIT $6::int
  `, [
    Number(weights.popularity),
    Number(weights.playCount),
    Number(weights.userPlayCount),
    Number(weights.userLikeCount),
    Number(weights.userSkipCount),
    Number(topN),
    Number(maxPerArtist),
  ]);

  const globalTop = result.rows.map((row) => row.id);

  logPerformance('compute-global-top', Date.now() - startTime, { count: globalTop.length });
  logger.info({ count: globalTop.length }, 'Global top computed');

  return globalTop;
}

/**
 * Получает список активных пользователей для персонализации
 * Учитывает только историю за последний год (для оптимизации)
 * @param {number} minHistory - Минимальное количество записей в истории
 * @returns {Promise<number[]>}
 */
async function getActiveUserIds(minHistory) {
  const historyLimitMonths = config.offlineWorker.historyLimitMonths || 12;

  const result = await query(`
    SELECT user_id
    FROM user_history
    WHERE last_played > NOW() - INTERVAL '1 month' * $2
    GROUP BY user_id
    HAVING COUNT(*) >= $1
    ORDER BY user_id
  `, [minHistory, historyLimitMonths]);

  return result.rows.map((row) => row.user_id);
}

function filterUserIdsForShard(userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) return [];
  if (shardCount <= 1) return userIds;
  const idx = shardIndex;
  const count = shardCount;
  return userIds.filter((id) => Number.isFinite(Number(id)) && (Number(id) % count) === idx);
}

// computeUserRecommendations импортируется из ./algorithms/personalRecommendations

/**
 * Обрабатывает пользователей батчами и сохраняет рекомендации
 * @param {number[]} userIds
 * @returns {Promise<number>}
 */
async function processUsersBatch(userIds) {
  const batchSize = config.offlineWorker.userBatchSize;
  const logProgressEvery = config.offlineWorker.logProgressEvery;
  const redisSaveThreshold = 1000;

  const lockTtlMs = Math.max(60, Number(config.offlineWorker.lockTtlSeconds) || 600) * 1000;
  const extendEveryMs = Math.max(15000, Math.floor(lockTtlMs * 0.5));
  let lastExtendAt = Date.now();

  const recommendations = new Map();
  let processedCount = 0;

  for (let i = 0; i < userIds.length && !isShuttingDown; i += batchSize) {
    const batch = userIds.slice(i, i + batchSize);

    // Параллельная обработка батча
    const batchResults = await Promise.all(
      batch.map(async (userId) => {
        try {
          const recs = await computeUserRecommendations(userId);
          return { userId, recs };
        } catch (err) {
          logError(err, 'compute-user-recs', { userId });
          return { userId, recs: [] };
        }
      })
    );

    for (const { userId, recs } of batchResults) {
      recommendations.set(userId, recs);
    }

    processedCount += batch.length;

    // Логируем прогресс с конфигурируемой частотой
    if (processedCount % logProgressEvery === 0) {
      const progress = ((processedCount / userIds.length) * 100).toFixed(1);
      logger.info({
        processed: processedCount,
        total: userIds.length,
        progress: `${progress}%`,
      }, 'Processing users...');
    }

    // Продлеваем lock каждые logProgressEvery пользователей
    if (Date.now() - lastExtendAt >= extendEveryMs) {
      await redis.extendLock(workerId, config.offlineWorker.lockTtlSeconds, { key: lockKey });
      lastExtendAt = Date.now();
    }

    // Сохраняем в Redis батчами для управления памятью
    if (recommendations.size >= redisSaveThreshold) {
      await redis.saveRecommendationsBatch(recommendations, null, config.offlineWorker.redisTtlSeconds);
      recommendations.clear();
    }
  }

  // Сохраняем оставшиеся
  if (recommendations.size > 0) {
    await redis.saveRecommendationsBatch(recommendations, null, config.offlineWorker.redisTtlSeconds);
  }

  return processedCount;
}

// ============================================
// Main Iteration
// ============================================

async function runIteration() {
  const iterationStart = Date.now();
  logger.info({ workerId }, 'Starting recommendations iteration');

  // Обновляем статус
  currentPhase = 'acquiring_lock';
  if (healthServer) healthServer.updateActivity();

  // Пробуем захватить lock
  const lockAcquired = await redis.acquireLock(workerId, config.offlineWorker.lockTtlSeconds, { key: lockKey });
  if (!lockAcquired) {
    currentPhase = 'waiting_lock';
    logger.info('Another worker holds the lock, skipping iteration');
    return;
  }

  try {
    // 1. Получаем список активных пользователей
    currentPhase = 'fetching_users';
    const userIdsAll = await getActiveUserIds(config.offlineWorker.minUserHistory);
    const userIds = filterUserIdsForShard(userIdsAll);
    logger.info({ userCount: userIds.length, shardIndex, shardCount }, 'Active users found');

    // 2. Обрабатываем пользователей батчами
    currentPhase = 'processing_users';
    if (healthServer) healthServer.updateActivity();

    const processedCount = await processUsersBatch(userIds);

    const duration = Date.now() - iterationStart;

    // Обновляем метрики
    totalUsersProcessed += processedCount;
    totalIterations += 1;
    lastIterationDurationMs = duration;
    currentPhase = 'idle';

    if (healthServer) {
      healthServer.updateActivity();
      healthServer.updateMetrics({
        users_processed: totalUsersProcessed,
        iterations: totalIterations,
        last_iteration_duration_ms: lastIterationDurationMs,
        global_top_size: 0,
      });
    }

    logPerformance('offline-iteration', duration, {
      globalTopSize: 0,
      userCount: processedCount,
    });

    logEvent('offline-iteration-complete', {
      workerId,
      globalTopSize: 0,
      userCount: processedCount,
      durationMs: duration,
    });

    logger.info({
      globalTopSize: 0,
      userCount: processedCount,
      durationMs: duration,
    }, 'Iteration completed successfully');

  } finally {
    // Освобождаем lock
    try {
      await redis.releaseLock(workerId, { key: lockKey });
    } catch (err) {
      logError(err, 'release-lock');
    }
    currentPhase = 'idle';
  }
}

// ============================================
// Main Loop
// ============================================

async function mainLoop() {
  logger.info({
    workerId,
    intervalMs: config.offlineWorker.runIntervalMs,
    topN: config.offlineWorker.topN,
  }, 'Starting main loop');

  while (!isShuttingDown) {
    const iterationStart = Date.now();

    try {
      await runIteration();
    } catch (err) {
      logError(err, 'run-iteration');
    }

    if (isShuttingDown) {
      break;
    }

    // Вычисляем время до следующей итерации
    const elapsed = Date.now() - iterationStart;
    const sleepTime = Math.max(5000, config.offlineWorker.runIntervalMs - elapsed);

    logger.info({ sleepMs: sleepTime }, 'Sleeping until next iteration');

    // Спим с возможностью прерывания
    const sleepEnd = Date.now() + sleepTime;
    while (Date.now() < sleepEnd && !isShuttingDown) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  logger.info({ workerId }, 'Main loop stopped');
}

// ============================================
// Bootstrap with Retry Logic
// ============================================

const MAX_CONNECT_RETRIES = 10;
const CONNECT_RETRY_DELAY_MS = 5000;

/**
 * Ожидает подключения к Redis с retry логикой
 * @returns {Promise<boolean>}
 */
async function waitForRedis() {
  for (let attempt = 1; attempt <= MAX_CONNECT_RETRIES; attempt++) {
    if (isShuttingDown) {
      return false;
    }

    try {
      await redis.connect();
      logger.info('Redis connected');
      return true;
    } catch (err) {
      logger.warn({
        attempt,
        maxAttempts: MAX_CONNECT_RETRIES,
        error: err.message,
      }, 'Redis connection failed, retrying...');

      if (attempt < MAX_CONNECT_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, CONNECT_RETRY_DELAY_MS));
      }
    }
  }

  return false;
}

/**
 * Ожидает подключения к PostgreSQL с retry логикой
 * @returns {Promise<boolean>}
 */
async function waitForDb() {
  for (let attempt = 1; attempt <= MAX_CONNECT_RETRIES; attempt++) {
    if (isShuttingDown) {
      return false;
    }

    const dbOk = await checkDb();
    if (dbOk) {
      logger.info('PostgreSQL connected');
      return true;
    }

    logger.warn({
      attempt,
      maxAttempts: MAX_CONNECT_RETRIES,
    }, 'PostgreSQL connection failed, retrying...');

    if (attempt < MAX_CONNECT_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, CONNECT_RETRY_DELAY_MS));
    }
  }

  return false;
}

async function bootstrap() {
  logger.info({ workerId, healthPort: HEALTH_PORT }, 'Bootstrapping offline worker...');

  // Запускаем health server
  healthServer = createHealthServer({
    port: HEALTH_PORT,
    workerId,
    getStatus: () => ({
      totalUsersProcessed,
      totalIterations,
      lastIterationDurationMs,
      currentPhase,
    }),
  });

  healthHeartbeatTimer = setInterval(() => {
    if (healthServer && typeof healthServer.updateActivity === 'function') {
      healthServer.updateActivity();
    }
  }, 60_000);

  // Ожидаем подключения к PostgreSQL (критично)
  const dbOk = await waitForDb();
  if (!dbOk) {
    logger.fatal('Failed to connect to PostgreSQL after retries');
    process.exit(1);
  }

  // Ожидаем подключения к Redis (критично для lock и сохранения)
  const redisOk = await waitForRedis();
  if (!redisOk) {
    logger.fatal('Failed to connect to Redis after retries');
    process.exit(1);
  }

  logEvent('offline-worker-started', { workerId, healthPort: HEALTH_PORT });

  // Запускаем main loop
  await mainLoop();
}

bootstrap().catch((err) => {
  logError(err, 'bootstrap');
  process.exit(1);
});
