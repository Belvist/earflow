/**
 * Унифицированный модуль работы с PostgreSQL
 * Единая точка входа для всех операций с БД
 * @module lib/database
 */

const { Pool } = require('pg');
const config = require('../config');
const { createLogger, logPerformance, logError } = require('./logger');

const logger = createLogger('database');

// ============================================
// Пул соединений
// ============================================

const pgOptions = [];
if (config.db.statementTimeoutMs > 0) {
  const timeoutMs = Number.parseInt(config.db.statementTimeoutMs, 10);
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    pgOptions.push(`-c statement_timeout=${timeoutMs}`);
  }
}

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  max: config.db.maxConnections,
  idleTimeoutMillis: config.db.idleTimeoutMs,
  connectionTimeoutMillis: config.db.connectionTimeoutMs,
  ...(pgOptions.length > 0 ? { options: pgOptions.join(' ') } : {}),
});

pool.on('error', (err) => {
  logError(err, 'database-pool');
});

// ============================================
// Circuit Breaker
// ============================================

const circuitBreaker = {
  state: 'CLOSED', // CLOSED, OPEN, HALF_OPEN
  failureCount: 0,
  nextAttemptTs: 0,
  lastError: null,
};

/**
 * Проверяет, можно ли выполнить запрос
 * @returns {boolean}
 */
function shouldAllowQuery() {
  if (circuitBreaker.state === 'OPEN') {
    if (Date.now() >= circuitBreaker.nextAttemptTs) {
      circuitBreaker.state = 'HALF_OPEN';
      logger.info('Circuit breaker moved to HALF_OPEN state');
      return true;
    }
    return false;
  }
  return true;
}

/**
 * Сбрасывает circuit breaker после успешного запроса
 */
function resetCircuit() {
  if (circuitBreaker.state !== 'CLOSED') {
    logger.info('Circuit breaker reset to CLOSED state');
  }
  circuitBreaker.state = 'CLOSED';
  circuitBreaker.failureCount = 0;
  circuitBreaker.nextAttemptTs = 0;
  circuitBreaker.lastError = null;
}

/**
 * Регистрирует ошибку в circuit breaker
 * @param {Error} err
 */
function registerFailure(err) {
  circuitBreaker.failureCount += 1;
  circuitBreaker.lastError = err;

  if (
    circuitBreaker.failureCount >= config.db.circuitBreaker.failureThreshold &&
    circuitBreaker.state !== 'OPEN'
  ) {
    circuitBreaker.state = 'OPEN';
    circuitBreaker.nextAttemptTs = Date.now() + config.db.circuitBreaker.cooldownMs;
    logger.error(
      {
        failureCount: circuitBreaker.failureCount,
        cooldownMs: config.db.circuitBreaker.cooldownMs,
      },
      'Circuit breaker OPENED after repeated failures'
    );
  }
}

/**
 * Получает состояние circuit breaker
 * @returns {object}
 */
function getCircuitState() {
  return {
    state: circuitBreaker.state,
    failureCount: circuitBreaker.failureCount,
    isOpen: circuitBreaker.state === 'OPEN',
  };
}

// ============================================
// Базовые операции
// ============================================

/**
 * Выполняет SQL запрос с circuit breaker
 * @param {string} text - SQL запрос
 * @param {any[]} [params] - Параметры запроса
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params) {
  if (!shouldAllowQuery()) {
    const error = new Error('Database temporarily unavailable (circuit breaker open)');
    error.code = 'DB_CIRCUIT_OPEN';
    throw error;
  }

  const startTime = Date.now();
  try {
    const result = await pool.query(text, params);
    resetCircuit();
    logPerformance('db-query', Date.now() - startTime, {
      rowCount: result.rowCount,
      command: result.command,
    });
    return result;
  } catch (err) {
    registerFailure(err);
    logError(err, 'db-query', { query: text.substring(0, 100) });
    throw err;
  }
}

/**
 * Получает клиента из пула для транзакций
 * @returns {Promise<import('pg').PoolClient>}
 */
async function getClient() {
  if (!shouldAllowQuery()) {
    const error = new Error('Database temporarily unavailable (circuit breaker open)');
    error.code = 'DB_CIRCUIT_OPEN';
    throw error;
  }

  const client = await pool.connect();

  return client;
}

function getUserEmbeddingAlpha() {
  const a = Number(config.feedback.userEmbeddingAlpha);
  if (!Number.isFinite(a) || a <= 0 || a >= 1) {
    return 0.05;
  }
  return a;
}

function getImplicitUserEmbeddingAlpha() {
  const a = Number(config.feedback.implicitUserEmbeddingAlpha);
  if (!Number.isFinite(a) || a <= 0 || a >= 1) {
    return 0.01;
  }
  return a;
}

function getImplicitMinPlaySeconds() {
  const s = Number(config.feedback.implicitMinPlaySeconds);
  if (!Number.isFinite(s) || s <= 0) {
    return 30;
  }
  return Math.floor(s);
}

function getDislikeUserEmbeddingAlpha() {
  const a = Number(config.feedback.dislikeUserEmbeddingAlpha);
  if (!Number.isFinite(a) || a <= 0 || a >= 1) {
    return 0.01;
  }
  return a;
}

/**
 * Выполняет функцию в транзакции
 * @template T
 * @param {function(import('pg').PoolClient): Promise<T>} fn - Функция для выполнения
 * @returns {Promise<T>}
 */
async function withTransaction(fn) {
  const client = await getClient();
  const startTime = Date.now();

  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    resetCircuit();
    logPerformance('db-transaction', Date.now() - startTime);
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch((rollbackErr) => {
      logger.error({ err: rollbackErr }, 'ROLLBACK failed');
    });
    registerFailure(err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Проверяет соединение с БД
 * @returns {Promise<boolean>}
 */
async function checkConnection() {
  try {
    const result = await pool.query('SELECT NOW()');
    logger.debug({ timestamp: result.rows[0].now }, 'Database connection OK');
    return true;
  } catch (err) {
    logError(err, 'db-health-check');
    return false;
  }
}

/**
 * Закрывает пул соединений
 * @returns {Promise<void>}
 */
async function close() {
  try {
    await pool.end();
    logger.info('Database pool closed');
  } catch (err) {
    logError(err, 'db-close');
    throw err;
  }
}

// ============================================
// Унифицированные операции записи взаимодействий
// ============================================

/**
 * @typedef {object} InteractionData
 * @property {number} userId - ID пользователя
 * @property {number} trackId - ID трека
 * @property {string} action - Тип действия
 * @property {number} [durationMs] - Длительность в мс
 * @property {number} [progress] - Прогресс (0-1)
 * @property {string} [sessionId] - ID сессии
 */

/**
 * Нормализует данные взаимодействия
 * @param {InteractionData} data
 * @returns {object|null}
 */
function normalizeInteraction(data) {
  const userId = Number.parseInt(data.userId, 10);
  const trackId = Number.parseInt(data.trackId, 10);

  if (!Number.isFinite(userId) || userId <= 0) return null;
  if (!Number.isFinite(trackId) || trackId <= 0) return null;
  if (!data.action || typeof data.action !== 'string') return null;

  const action = data.action.toLowerCase().trim();
  if (!config.feedback.allowedActions.includes(action)) return null;

  const durationMs = Number.parseInt(data.durationMs || 0, 10) || 0;
  const durationSeconds = Math.min(
    Math.max(Math.floor(durationMs / 1000), 0),
    Math.floor(config.feedback.maxDurationMs / 1000)
  );

  let progress = Number.parseFloat(data.progress);
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    progress = null;
  }

  const eventId = typeof data.eventId === 'string' && data.eventId.trim().length > 0
    ? data.eventId.trim()
    : null;
  const playbackSessionId = typeof data.playbackSessionId === 'string' && data.playbackSessionId.trim().length > 0
    ? data.playbackSessionId.trim()
    : null;
  const schemaVersionRaw = Number.parseInt(data.schemaVersion, 10);
  const schemaVersion = Number.isFinite(schemaVersionRaw) && schemaVersionRaw > 0 ? schemaVersionRaw : 1;
  const eventTimeRaw = Number.parseInt(data.eventTime, 10);
  const eventTime = Number.isFinite(eventTimeRaw) && eventTimeRaw > 0 ? eventTimeRaw : Date.now();
  const context = data.context && typeof data.context === 'object' && !Array.isArray(data.context) ? data.context : null;

  return {
    userId,
    trackId,
    action,
    durationSeconds,
    sessionId: typeof data.sessionId === 'string' ? data.sessionId : null,
    durationMs,
    progress,
    eventId,
    playbackSessionId,
    schemaVersion,
    eventTime,
    context,
  };
}

async function updateUserEmbeddingsForEvents(client, pairs, alpha, direction = 1) {
  if (!pairs || pairs.length === 0) return;

  const a = Number(alpha);
  if (!Number.isFinite(a) || a <= 0 || a >= 1) return;

  const pairUserIds = [];
  const pairSongIds = [];
  for (const p of pairs) {
    pairUserIds.push(p.userId);
    pairSongIds.push(p.songId);
  }

  const dir = direction === -1 ? -1 : 1;
  const maxClusters = Math.min(Math.max(Number(config.recommendations.tasteMaxClusters) || 5, 1), 5);
  const newClusterThreshold = Math.min(
    Math.max(Number(config.recommendations.tasteNewClusterDistThreshold) || 0.25, 0.05),
    1.0
  );

  await client.query(
    `WITH pairs AS (
       SELECT *
       FROM UNNEST ($1::int[], $2::int[]) AS t(user_id, song_id)
     ),
     agg AS (
       SELECT
         p.user_id,
         reco_scale_vector(sum(s.embedding), (1.0::real / count(*)::real)) AS track_embedding
       FROM pairs p
       JOIN songs s ON s.id = p.song_id
       WHERE s.embedding IS NOT NULL
       GROUP BY p.user_id
     )
     INSERT INTO user_models (user_id, last_updated)
     SELECT a.user_id, NOW()
     FROM agg a
     ON CONFLICT (user_id) DO NOTHING`,
    [pairUserIds, pairSongIds]
  );

  await client.query(
    `WITH pairs AS (
       SELECT *
       FROM UNNEST ($1::int[], $2::int[]) AS t(user_id, song_id)
     ),
     agg AS (
       SELECT
         p.user_id,
         reco_scale_vector(sum(s.embedding), (1.0::real / count(*)::real)) AS track_embedding
       FROM pairs p
       JOIN songs s ON s.id = p.song_id
       WHERE s.embedding IS NOT NULL
       GROUP BY p.user_id
     )
     SELECT reco_apply_feedback_to_taste_clusters(a.user_id, a.track_embedding, $3::real, $4::int, $5::int, $6::real)
     FROM agg a`,
    [pairUserIds, pairSongIds, a, dir, maxClusters, newClusterThreshold]
  );
}

/**
 * Записывает одно взаимодействие в БД (транзакционно)
 * @param {InteractionData} data
 * @returns {Promise<boolean>}
 */
async function recordInteraction(data) {
  const normalized = normalizeInteraction(data);
  if (!normalized) {
    logger.warn({ data }, 'Invalid interaction data, skipping');
    return false;
  }

  return withTransaction(async (client) => {
    // Вставка в user_interactions
    await client.query(
      `INSERT INTO user_interactions (user_id, song_id, interaction_type, session_id, duration_ms, progress, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, NULL::jsonb)`,
      [
        normalized.userId,
        normalized.trackId,
        normalized.action,
        normalized.sessionId,
        normalized.durationMs,
        normalized.progress,
      ]
    );

    // Upsert в user_history с блокировкой строки
    await client.query(
      `INSERT INTO user_history (user_id, song_id, play_count, liked, last_played, total_play_time, skip_count)
       VALUES ($1, $2, 
         CASE WHEN $3 = 'play' THEN 1 ELSE 0 END,
         CASE WHEN $3 = 'like' THEN TRUE WHEN $3 = 'dislike' THEN FALSE ELSE FALSE END,
         NOW(),
         $4,
         CASE WHEN $3 IN ('skip', 'dislike') THEN 1 ELSE 0 END
       )
       ON CONFLICT (user_id, song_id) DO UPDATE SET
         play_count = user_history.play_count + CASE WHEN $3 = 'play' THEN 1 ELSE 0 END,
         skip_count = user_history.skip_count + CASE WHEN $3 IN ('skip', 'dislike') THEN 1 ELSE 0 END,
         total_play_time = user_history.total_play_time + $4,
         liked = CASE
           WHEN $3 = 'like' THEN TRUE
           WHEN $3 = 'dislike' THEN FALSE
           ELSE user_history.liked
         END,
         last_played = GREATEST(user_history.last_played, NOW())`,
      [normalized.userId, normalized.trackId, normalized.action, normalized.durationSeconds]
    );

    const implicitMinPlaySeconds = getImplicitMinPlaySeconds();
    const shouldImplicitUpdate =
      normalized.action === 'complete' ||
      (normalized.action === 'play' && normalized.durationSeconds >= implicitMinPlaySeconds);

    if (normalized.action === 'like') {
      await updateUserEmbeddingsForEvents(
        client,
        [{ userId: normalized.userId, songId: normalized.trackId }],
        getUserEmbeddingAlpha()
      );
      await client.query(
        `INSERT INTO likes (user_id, song_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, song_id) DO NOTHING`,
        [normalized.userId, normalized.trackId]
      );
      await client.query(
        `DELETE FROM dislikes WHERE user_id = $1 AND song_id = $2`,
        [normalized.userId, normalized.trackId]
      );
    } else if (shouldImplicitUpdate) {
      await updateUserEmbeddingsForEvents(
        client,
        [{ userId: normalized.userId, songId: normalized.trackId }],
        getImplicitUserEmbeddingAlpha()
      );
    } else if (normalized.action === 'dislike') {
      await updateUserEmbeddingsForEvents(
        client,
        [{ userId: normalized.userId, songId: normalized.trackId }],
        getDislikeUserEmbeddingAlpha(),
        -1
      );
      await client.query(
        `INSERT INTO dislikes (user_id, song_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, song_id) DO NOTHING`,
        [normalized.userId, normalized.trackId]
      );
      await client.query(
        `DELETE FROM likes WHERE user_id = $1 AND song_id = $2`,
        [normalized.userId, normalized.trackId]
      );
    }

    return true;
  });
}

/**
 * Записывает batch взаимодействий в БД (транзакционно)
 * Использует UNNEST для эффективной bulk вставки
 * @param {InteractionData[]} interactions
 * @returns {Promise<number>} - Количество успешно записанных
 */
async function recordInteractionsBatch(interactions) {
  if (!Array.isArray(interactions) || interactions.length === 0) {
    return 0;
  }

  // Нормализация и агрегация
  const normalized = [];
  for (const data of interactions) {
    const row = normalizeInteraction(data);
    if (row) {
      normalized.push(row);
    }
  }

  if (normalized.length === 0) {
    return 0;
  }

  const allTrackIds = [...new Set(normalized.map((r) => r.trackId))];
  let existingSongIds;
  try {
    const existingResult = await query(
      `SELECT id FROM songs WHERE id = ANY($1::int[])`,
      [allTrackIds]
    );
    existingSongIds = new Set(existingResult.rows.map((r) => r.id));
  } catch (err) {
    logger.error({ err }, 'Failed to validate song ids for batch interactions');
    throw err;
  }

  const validNormalized = normalized.filter((r) => existingSongIds.has(r.trackId));

  if (validNormalized.length === 0) {
    logger.warn({
      totalCount: normalized.length,
      invalidTrackIds: allTrackIds.filter((id) => !existingSongIds.has(id)),
    }, 'All interactions have invalid song_id, skipping batch');
    return 0;
  }

  if (validNormalized.length < normalized.length) {
    const invalidIds = allTrackIds.filter((id) => !existingSongIds.has(id));
    logger.warn({
      validCount: validNormalized.length,
      totalCount: normalized.length,
      invalidTrackIds: invalidIds.slice(0, 10),
    }, 'Some interactions have invalid song_id, filtering');
  }

  for (const row of validNormalized) {
    if (row.eventId) continue;
    row.eventId = `legacy:${row.userId}:${row.trackId}:${row.action}:${row.eventTime}`;
  }

  return withTransaction(async (client) => {

    const rawEventIds = [];
    const rawSchemaVersions = [];
    const rawEventTimes = [];
    const rawUserIds = [];
    const rawSessionIds = [];
    const rawPlaybackSessionIds = [];
    const rawTrackIds = [];
    const rawActions = [];
    const rawDurationMs = [];
    const rawProgress = [];
    const rawContext = [];

    for (const row of validNormalized) {
      if (!row.eventId) continue;
      rawEventIds.push(row.eventId);
      rawSchemaVersions.push(row.schemaVersion || 1);
      rawEventTimes.push(new Date(row.eventTime));
      rawUserIds.push(row.userId);
      rawSessionIds.push(row.sessionId);
      rawPlaybackSessionIds.push(row.playbackSessionId);
      rawTrackIds.push(row.trackId);
      rawActions.push(row.action);
      rawDurationMs.push(row.durationMs);
      rawProgress.push(row.progress);
      rawContext.push(row.context);
    }

    const insertedRaw = await client.query(
      `INSERT INTO analytics_events_raw (
         event_id,
         schema_version,
         event_time,
         user_id,
         session_id,
         playback_session_id,
         track_id,
         action,
         duration_ms,
         progress,
         context,
         metadata
       )
       SELECT
         t.event_id,
         t.schema_version,
         t.event_time,
         t.user_id,
         t.session_id,
         t.playback_session_id,
         t.track_id,
         t.action,
         t.duration_ms,
         t.progress,
         t.context,
         NULL::jsonb
       FROM UNNEST (
         $1::text[],
         $2::int[],
         $3::timestamptz[],
         $4::int[],
         $5::text[],
         $6::text[],
         $7::int[],
         $8::text[],
         $9::int[],
         $10::numeric[],
         $11::jsonb[]
       ) AS t(
         event_id,
         schema_version,
         event_time,
         user_id,
         session_id,
         playback_session_id,
         track_id,
         action,
         duration_ms,
         progress,
         context
       )
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [
        rawEventIds,
        rawSchemaVersions,
        rawEventTimes,
        rawUserIds,
        rawSessionIds,
        rawPlaybackSessionIds,
        rawTrackIds,
        rawActions,
        rawDurationMs,
        rawProgress,
        rawContext,
      ]
    );

    if (!insertedRaw.rows || insertedRaw.rows.length === 0) {
      return 0;
    }

    const insertedEventIds = new Set(insertedRaw.rows.map((r) => r.event_id));
    const freshNormalized = validNormalized.filter((r) => insertedEventIds.has(r.eventId));
    if (freshNormalized.length === 0) {
      return 0;
    }

    const validHistoryMap = new Map();
    const implicitPairs = [];
    const implicitMinPlaySeconds = getImplicitMinPlaySeconds();
    const dislikedKeys = new Set();
    const qualifiedPlaysByTrackId = new Map();
    for (const row of freshNormalized) {
      const key = `${row.userId}:${row.trackId}`;
      let entry = validHistoryMap.get(key);

      if (!entry) {
        entry = {
          userId: row.userId,
          trackId: row.trackId,
          playCount: 0,
          skipCount: 0,
          totalPlayTime: 0,
          likedAction: null,
        };
        validHistoryMap.set(key, entry);
      }

      if (row.action === 'play' || row.action === 'complete') {
        entry.playCount += 1;
      }
      if (row.action === 'skip' || row.action === 'dislike') {
        entry.skipCount += 1;
      }
      entry.totalPlayTime += row.durationSeconds;

      if (row.action === 'like') {
        entry.likedAction = 'like';
      } else if (row.action === 'dislike') {
        entry.likedAction = 'dislike';
        dislikedKeys.add(key);
      }

      const qualifiesByDuration = row.durationSeconds >= implicitMinPlaySeconds;
      const isQualifiedListen =
        row.action === 'complete' ||
        (row.action === 'play' && qualifiesByDuration);

      if (row.action === 'complete' || (row.action === 'play' && qualifiesByDuration)) {
        implicitPairs.push({ userId: row.userId, songId: row.trackId });
      }

      if (isQualifiedListen) {
        const prev = qualifiedPlaysByTrackId.get(row.trackId) || 0;
        qualifiedPlaysByTrackId.set(row.trackId, prev + 1);
      }
    }

    const filteredImplicitPairs = implicitPairs.filter((p) => !dislikedKeys.has(`${p.userId}:${p.songId}`));

    const userIds = [];
    const trackIds = [];
    const actions = [];
    const sessionIds = [];
    const durationMsList = [];
    const progressList = [];

    const eventIds = [];
    const playbackSessionIds = [];
    const eventTimes = [];

    for (const row of freshNormalized) {
      userIds.push(row.userId);
      trackIds.push(row.trackId);
      actions.push(row.action);
      sessionIds.push(row.sessionId);
      durationMsList.push(row.durationMs);
      progressList.push(row.progress);
      eventIds.push(row.eventId);
      playbackSessionIds.push(row.playbackSessionId);
      eventTimes.push(new Date(row.eventTime));
    }

    await client.query(
      `INSERT INTO user_interactions (
         user_id,
         song_id,
         interaction_type,
         session_id,
         duration_ms,
         progress,
         event_id,
         playback_session_id,
         event_time,
         metadata
       )
       SELECT
         user_id,
         song_id,
         action,
         session_id,
         duration_ms,
         progress,
         event_id,
         playback_session_id,
         event_time,
         NULL::jsonb
       FROM UNNEST (
         $1::int[],
         $2::int[],
         $3::text[],
         $4::text[],
         $5::int[],
         $6::numeric[],
         $7::text[],
         $8::text[],
         $9::timestamptz[]
       ) AS t(
         user_id,
         song_id,
         action,
         session_id,
         duration_ms,
         progress,
         event_id,
         playback_session_id,
         event_time
       )`,
      [userIds, trackIds, actions, sessionIds, durationMsList, progressList, eventIds, playbackSessionIds, eventTimes]
    );

    // Bulk upsert в user_history (используем validHistoryMap)
    const historyEntries = Array.from(validHistoryMap.values());
    const hUserIds = [];
    const hTrackIds = [];
    const hPlayCounts = [];
    const hSkipCounts = [];
    const hTotalPlayTimes = [];

    const likeUserIds = [];
    const likeTrackIds = [];
    const likeValues = [];

    const likesPairs = new Set();
    const dislikesPairs = new Set();

    for (const entry of historyEntries) {
      hUserIds.push(entry.userId);
      hTrackIds.push(entry.trackId);
      hPlayCounts.push(entry.playCount);
      hSkipCounts.push(entry.skipCount);
      hTotalPlayTimes.push(entry.totalPlayTime);

      if (entry.likedAction === 'like') {
        likeUserIds.push(entry.userId);
        likeTrackIds.push(entry.trackId);
        likeValues.push(true);

        likesPairs.add(`${entry.userId}:${entry.trackId}`);
      } else if (entry.likedAction === 'dislike') {
        likeUserIds.push(entry.userId);
        likeTrackIds.push(entry.trackId);
        likeValues.push(false);

        dislikesPairs.add(`${entry.userId}:${entry.trackId}`);
      }
    }

    // Upsert счётчиков
    await client.query(
      `INSERT INTO user_history (user_id, song_id, play_count, liked, last_played, total_play_time, skip_count)
       SELECT t.user_id, t.song_id, t.play_count, FALSE, NOW(), t.total_play_time, t.skip_count
       FROM UNNEST ($1::int[], $2::int[], $3::int[], $4::int[], $5::int[])
         AS t(user_id, song_id, play_count, skip_count, total_play_time)
       ON CONFLICT (user_id, song_id) DO UPDATE SET
         play_count = user_history.play_count + EXCLUDED.play_count,
         skip_count = user_history.skip_count + EXCLUDED.skip_count,
         total_play_time = user_history.total_play_time + EXCLUDED.total_play_time,
         last_played = GREATEST(user_history.last_played, NOW())`,
      [hUserIds, hTrackIds, hPlayCounts, hSkipCounts, hTotalPlayTimes]
    );

    // Отдельный UPDATE для liked (избегаем сложных subquery)
    if (likeUserIds.length > 0) {
      await client.query(
        `UPDATE user_history AS uh
         SET liked = t.liked_value
         FROM UNNEST ($1::int[], $2::int[], $3::boolean[])
           AS t(user_id, song_id, liked_value)
         WHERE uh.user_id = t.user_id AND uh.song_id = t.song_id`,
        [likeUserIds, likeTrackIds, likeValues]
      );
    }

    if (likesPairs.size > 0) {
      const u = [];
      const s = [];
      for (const key of likesPairs) {
        const [userId, songId] = key.split(':');
        u.push(Number.parseInt(userId, 10));
        s.push(Number.parseInt(songId, 10));
      }

      const likePairs = u.map((userId, idx) => ({ userId, songId: s[idx] }));
      await updateUserEmbeddingsForEvents(client, likePairs, getUserEmbeddingAlpha());

      await client.query(
        `INSERT INTO likes (user_id, song_id)
         SELECT t.user_id, t.song_id
         FROM UNNEST ($1::int[], $2::int[]) AS t(user_id, song_id)
         ON CONFLICT (user_id, song_id) DO NOTHING`,
        [u, s]
      );

      await client.query(
        `DELETE FROM dislikes d
         USING UNNEST ($1::int[], $2::int[]) AS t(user_id, song_id)
         WHERE d.user_id = t.user_id AND d.song_id = t.song_id`,
        [u, s]
      );
    }

    if (dislikesPairs.size > 0) {
      const u = [];
      const s = [];
      for (const key of dislikesPairs) {
        const [userId, songId] = key.split(':');
        u.push(Number.parseInt(userId, 10));
        s.push(Number.parseInt(songId, 10));
      }

      const dislikePairs = u.map((userId, idx) => ({ userId, songId: s[idx] }));
      await updateUserEmbeddingsForEvents(client, dislikePairs, getDislikeUserEmbeddingAlpha(), -1);

      await client.query(
        `INSERT INTO dislikes (user_id, song_id)
         SELECT t.user_id, t.song_id
         FROM UNNEST ($1::int[], $2::int[]) AS t(user_id, song_id)
         ON CONFLICT (user_id, song_id) DO NOTHING`,
        [u, s]
      );

      await client.query(
        `DELETE FROM likes l
         USING UNNEST ($1::int[], $2::int[]) AS t(user_id, song_id)
         WHERE l.user_id = t.user_id AND l.song_id = t.song_id`,
        [u, s]
      );
    }

    if (filteredImplicitPairs.length > 0) {
      await updateUserEmbeddingsForEvents(client, filteredImplicitPairs, getImplicitUserEmbeddingAlpha());
    }

    if (qualifiedPlaysByTrackId.size > 0) {
      const songIds = [];
      const incs = [];
      for (const [songId, inc] of qualifiedPlaysByTrackId.entries()) {
        if (!Number.isFinite(songId) || songId <= 0) continue;
        const n = Number(inc);
        if (!Number.isFinite(n) || n <= 0) continue;
        songIds.push(songId);
        incs.push(Math.floor(n));
      }

      if (songIds.length > 0) {
        await client.query(
          `UPDATE songs AS s
           SET play_count = COALESCE(s.play_count, 0) + t.inc,
               popularity = COALESCE(s.play_count, 0) + t.inc
           FROM UNNEST ($1::int[], $2::int[]) AS t(song_id, inc)
           WHERE s.id = t.song_id`,
          [songIds, incs]
        );
      }
    }

    return freshNormalized.length;
  });
}

/**
 * Получает треки по ID с использованием кэша
 * Возвращает нормализованные данные совместимые с фронтендом
 * @param {number[]} ids
 * @returns {Promise<object[]>}
 */
async function fetchTracksByIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return [];
  }

  // Валидация и дедупликация ID
  const validIds = [...new Set(
    ids
      .map((id) => Number.parseInt(id, 10))
      .filter((id) => Number.isFinite(id) && id > 0)
  )];

  if (validIds.length === 0) {
    return [];
  }

  const startTime = Date.now();

  // Запрос с JOIN на song_features для content-based данных
  // Фильтруем недоступные треки (is_available = false означает файл отсутствует в MinIO)
  let result = await query(
    `SELECT 
       s.id,
       s.title,
       s.artist,
       s.album,
       s.genre,
       s.duration,
       s.year,
       COALESCE(s.cover_path, s.cover) AS cover_path,
       COALESCE(s.audio_url, s.file_path) AS audio_url,
       s.file_path,
       COALESCE(s.popularity, 0) AS popularity,
       COALESCE(s.play_count, 0) AS play_count,
       COALESCE(s.has_ebap, false) AS has_ebap,
       sf.tempo,
       sf.energy,
       sf.valence,
       sf.danceability
     FROM songs s
     LEFT JOIN song_features sf ON s.id = sf.song_id
     WHERE s.id = ANY($1::int[])
       AND COALESCE(s.is_available, true) = true`,
    [validIds]
  );

  if ((result.rows || []).length === 0) {
    result = await query(
      `SELECT 
         s.id,
         s.title,
         s.artist,
         s.album,
         s.genre,
         s.duration,
         s.year,
         COALESCE(s.cover_path, s.cover) AS cover_path,
         COALESCE(s.audio_url, s.file_path) AS audio_url,
         s.file_path,
         COALESCE(s.popularity, 0) AS popularity,
         COALESCE(s.play_count, 0) AS play_count,
         COALESCE(s.has_ebap, false) AS has_ebap,
         sf.tempo,
         sf.energy,
         sf.valence,
         sf.danceability
       FROM songs s
       LEFT JOIN song_features sf ON s.id = sf.song_id
       WHERE s.id = ANY($1::int[])
         AND (
           NULLIF(s.audio_url, '') IS NOT NULL
           OR NULLIF(s.file_path, '') IS NOT NULL
         )`,
      [validIds]
    );
  }

  logPerformance('fetch-tracks-by-ids', Date.now() - startTime, { count: validIds.length });

  // Нормализация данных для фронтенда
  const normalizedRows = result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    artist: row.artist,
    album: row.album,
    genre: row.genre,
    duration: row.duration,
    year: row.year,
    cover: row.cover_path,
    coverPath: row.cover_path,
    has_ebap: !!row.has_ebap,
    popularity: Number(row.popularity) || 0,
    playCount: Number(row.play_count) || 0,
    // Audio features (если доступны)
    features: row.tempo != null ? {
      tempo: row.tempo,
      energy: row.energy,
      valence: row.valence,
      danceability: row.danceability,
    } : null,
  }));

  // Сохраняем порядок запроса
  const trackMap = new Map(normalizedRows.map((row) => [row.id, row]));
  return validIds.map((id) => trackMap.get(id)).filter(Boolean);
}

async function upsertUserGenrePlaybackRate(userId, genre, playbackRate) {
  const uid = Number.parseInt(userId, 10);
  if (!Number.isFinite(uid) || uid <= 0) {
    throw new Error('Invalid userId');
  }

  const g = typeof genre === 'string' ? genre.trim().toLowerCase() : '';
  if (!g || g.length > 100) {
    throw new Error('Invalid genre');
  }

  const rate = Number.parseFloat(playbackRate);
  if (!Number.isFinite(rate) || rate < 0.5 || rate > 2.0) {
    throw new Error('Invalid playbackRate');
  }

  await query(
    `INSERT INTO user_genre_playback_prefs (user_id, genre, playback_rate, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, genre) DO UPDATE SET
       playback_rate = EXCLUDED.playback_rate,
       updated_at = NOW()`,
    [uid, g, rate]
  );
}

async function loadUserGenrePlaybackRates(userId, genres) {
  const uid = Number.parseInt(userId, 10);
  if (!Number.isFinite(uid) || uid <= 0) {
    return new Map();
  }

  const list = (Array.isArray(genres) ? genres : [])
    .map((x) => (typeof x === 'string' ? x.trim().toLowerCase() : ''))
    .filter((x) => x && x.length <= 100);

  const unique = [...new Set(list)];
  if (unique.length === 0) {
    return new Map();
  }

  const result = await query(
    `SELECT genre, playback_rate
     FROM user_genre_playback_prefs
     WHERE user_id = $1
       AND genre = ANY($2::text[])`,
    [uid, unique]
  );

  const out = new Map();
  for (const row of result.rows || []) {
    const g = typeof row.genre === 'string' ? row.genre : '';
    const r = Number(row.playback_rate);
    if (g && Number.isFinite(r)) {
      out.set(g, r);
    }
  }
  return out;
}

module.exports = {
  pool,
  query,
  getClient,
  withTransaction,
  checkConnection,
  close,
  getCircuitState,
  normalizeInteraction,
  recordInteraction,
  recordInteractionsBatch,
  fetchTracksByIds,
  upsertUserGenrePlaybackRate,
  loadUserGenrePlaybackRates,
};
