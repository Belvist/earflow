/**
 * Feedback Worker
 * Обрабатывает события из Redis Stream и записывает в PostgreSQL
 * Использует Redis Streams с consumer groups для надёжной обработки
 * @module workers/feedbackWorker
 */

require('dotenv').config();

const config = require('../config');
const { createLogger, logError, logEvent } = require('../lib/logger');
const { recordInteractionsBatch, checkConnection: checkDb, close: closeDb } = require('../lib/database');
const redis = require('../lib/redis');
const { createHealthServer } = require('../lib/workerHealth');
const {
  feedbackEventsProcessed,
  feedbackBatchSize,
  feedbackProcessingDuration,
  feedbackRetriesTotal,
  feedbackDlqTotal,
  recommendationHitsTotal,
} = require('../metrics');

const logger = createLogger('feedback-worker');

// ============================================
// Worker State
// ============================================

let isShuttingDown = false;
let currentBatchPromise = null;
const workerId = `feedback-${process.pid}-${Date.now()}`;

// Health check server
const HEALTH_PORT = parseInt(process.env.FEEDBACK_WORKER_HEALTH_PORT || '3016', 10);
let healthServer = null;
let healthHeartbeatTimer = null;
let totalEventsProcessed = 0;
let totalBatchesProcessed = 0;
let lastBatchDurationMs = 0;

// ============================================
// Graceful Shutdown
// ============================================

async function shutdown(signal) {
  if (isShuttingDown) {
    logger.warn({ signal }, 'Shutdown already in progress');
    return;
  }

  isShuttingDown = true;
  logger.info({ signal, workerId }, 'Initiating graceful shutdown...');

  // Ждём завершения текущего batch
  if (currentBatchPromise) {
    logger.info('Waiting for current batch to complete...');
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => {
        logger.warn('Shutdown timeout exceeded');
        resolve();
      }, config.feedbackWorker.shutdownTimeoutMs);
    });

    try {
      await Promise.race([currentBatchPromise, timeoutPromise]);
      logger.info('Current batch completed');
    } catch (err) {
      logError(err, 'shutdown-wait-batch');
    }
  }

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

  // Закрываем соединения
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
// Message Processing
// ============================================

/**
 * Обрабатывает batch сообщений из Redis Stream
 * @param {Array<{id: string, data: object}>} messages
 * @returns {Promise<void>}
 */
async function processBatch(messages) {
  if (!messages || messages.length === 0) {
    return;
  }

  const startTime = Date.now();
  const successIds = [];
  const failedMessages = [];

  // Собираем все взаимодействия из сообщений
  const allInteractions = [];

  for (const msg of messages) {
    try {
      const event = msg.data;

      const fallbackEventId = `reco:${msg.id}`;
      const fallbackEventTime = Number.isFinite(msg.timestamp) && msg.timestamp > 0 ? msg.timestamp : Date.now();

      if (event.type === 'single') {
        allInteractions.push({
          userId: event.userId,
          trackId: event.trackId,
          action: event.action,
          durationMs: event.duration,
          progress: event.progress,
          sessionId: event.sessionId,
          eventId: event.eventId || fallbackEventId,
          playbackSessionId: event.playbackSessionId || null,
          schemaVersion: event.schemaVersion || 1,
          eventTime: event.eventTime || fallbackEventTime,
          context: event.context || null,
        });
      } else if (event.type === 'batch' && Array.isArray(event.interactions)) {
        for (const interaction of event.interactions) {
          allInteractions.push({
            userId: event.userId,
            trackId: interaction.trackId,
            action: interaction.action,
            durationMs: interaction.duration,
            progress: interaction.progress,
            sessionId: event.sessionId,
            eventId: interaction.eventId || fallbackEventId,
            playbackSessionId: interaction.playbackSessionId || null,
            schemaVersion: interaction.schemaVersion || 1,
            eventTime: interaction.eventTime || fallbackEventTime,
            context: interaction.context || null,
          });
        }
      }

      successIds.push(msg.id);
    } catch (err) {
      logError(err, 'parse-message', { messageId: msg.id });
      failedMessages.push({ message: msg, error: err.message });
    }
  }

  // Записываем в БД (единая транзакция)
  if (allInteractions.length > 0) {
    try {
      const recordedCount = await recordInteractionsBatch(allInteractions);

      const hitActions = new Set(['like', 'complete']);
      const bySession = new Map();
      for (const interaction of allInteractions) {
        if (!hitActions.has(interaction.action)) continue;
        if (!interaction.sessionId) continue;

        let entry = bySession.get(interaction.sessionId);
        if (!entry) {
          entry = { likes: [], completes: [] };
          bySession.set(interaction.sessionId, entry);
        }

        if (interaction.action === 'like') {
          entry.likes.push(interaction.trackId);
        } else {
          entry.completes.push(interaction.trackId);
        }
      }

      let likeHits = 0;
      let completeHits = 0;
      for (const [sessionId, ids] of bySession.entries()) {
        const allIds = [...ids.likes, ...ids.completes];
        if (allIds.length === 0) continue;
        try {
          const membership = await redis.sessionHadImpressions(sessionId, allIds);
          for (const id of ids.likes) {
            if (membership.get(Number.parseInt(id, 10)) === true) {
              likeHits += 1;
            }
          }
          for (const id of ids.completes) {
            if (membership.get(Number.parseInt(id, 10)) === true) {
              completeHits += 1;
            }
          }
        } catch (err) {
          logError(err, 'recommendation-hit-check', { sessionId });
        }
      }

      if (likeHits > 0) {
        recommendationHitsTotal.inc({ action: 'like' }, likeHits);
      }
      if (completeHits > 0) {
        recommendationHitsTotal.inc({ action: 'complete' }, completeHits);
      }

      logger.info({
        messageCount: messages.length,
        interactionCount: recordedCount,
        durationMs: Date.now() - startTime,
      }, 'Batch processed successfully');

      feedbackEventsProcessed.inc({ type: 'batch', status: 'success' }, recordedCount);
      feedbackBatchSize.observe(recordedCount);
    } catch (err) {
      logError(err, 'record-interactions-batch');

      // Помечаем все сообщения как failed
      failedMessages.push(
        ...messages.map((msg) => ({
          message: msg,
          error: err.message,
          retries: (msg.data.retries || 0) + 1,
        }))
      );
      successIds.length = 0; // Очищаем successIds

      feedbackEventsProcessed.inc({ type: 'batch', status: 'error' }, allInteractions.length);
    }
  }

  // ACK успешно обработанных сообщений
  if (successIds.length > 0) {
    try {
      await redis.ackFeedbackMessages(successIds);
    } catch (err) {
      logError(err, 'ack-messages', { count: successIds.length });
    }
  }

  // Обработка failed сообщений
  for (const failed of failedMessages) {
    const retries = failed.retries || (failed.message.data.retries || 0) + 1;

    if (retries >= config.feedbackWorker.maxRetries) {
      // Перемещаем в DLQ
      try {
        await redis.moveToDLQ(failed.message.id, failed.message.data, failed.error);
        feedbackDlqTotal.inc();
        logger.warn({
          messageId: failed.message.id,
          retries,
          error: failed.error,
        }, 'Message moved to DLQ after max retries');
      } catch (err) {
        logError(err, 'move-to-dlq', { messageId: failed.message.id });
      }
    } else {
      // Увеличиваем счётчик retry
      feedbackRetriesTotal.inc();
      logger.warn({
        messageId: failed.message.id,
        retries,
        error: failed.error,
      }, 'Message will be retried');
      // Сообщение останется в pending и будет перечитано
    }
  }

  const duration = (Date.now() - startTime) / 1000;
  feedbackProcessingDuration.observe(duration);
}

/**
 * Обрабатывает pending (зависшие) сообщения от упавших воркеров
 * @returns {Promise<void>}
 */
async function processPendingMessages() {
  const minIdleMs = config.feedbackWorker.blockTimeoutMs * 3; // 15 секунд простоя

  try {
    const pending = await redis.getPendingFeedback(config.feedbackWorker.batchSize, minIdleMs);

    if (pending.length === 0) {
      return;
    }

    logger.info({ count: pending.length }, 'Found pending messages to claim');

    const messageIds = pending.map((p) => p.id);
    const claimed = await redis.claimPendingFeedback(workerId, messageIds, minIdleMs);

    if (claimed.length > 0) {
      const messages = claimed.map((msg) => ({
        id: msg.id,
        data: JSON.parse(msg.message.data),
        timestamp: Number.parseInt(msg.message.timestamp, 10),
      }));

      await processBatch(messages);
    }
  } catch (err) {
    logError(err, 'process-pending');
  }
}

// ============================================
// Main Loop
// ============================================

async function mainLoop() {
  logger.info({ workerId }, 'Starting main loop');

  // Инициализируем consumer group
  try {
    await redis.initFeedbackStream();
  } catch (err) {
    logError(err, 'init-feedback-stream');
    process.exit(1);
  }

  let iterationCount = 0;

  while (!isShuttingDown) {
    try {
      // Периодически проверяем pending сообщения (каждые 10 итераций)
      if (iterationCount % 10 === 0) {
        await processPendingMessages();
      }

      // Читаем новые сообщения
      const messages = await redis.readFeedbackBatch(
        workerId,
        config.feedbackWorker.batchSize,
        config.feedbackWorker.blockTimeoutMs
      );

      if (messages.length > 0) {
        const batchStart = Date.now();
        currentBatchPromise = processBatch(messages);
        await currentBatchPromise;
        currentBatchPromise = null;

        // Обновляем метрики для health server
        lastBatchDurationMs = Date.now() - batchStart;
        totalEventsProcessed += messages.length;
        totalBatchesProcessed += 1;

        if (healthServer) {
          healthServer.updateActivity();
          healthServer.updateMetrics({
            events_processed: totalEventsProcessed,
            batches_processed: totalBatchesProcessed,
            last_batch_duration_ms: lastBatchDurationMs,
          });
        }
      }

      iterationCount += 1;
    } catch (err) {
      logError(err, 'main-loop');

      // Backoff при ошибках
      if (!isShuttingDown) {
        await new Promise((resolve) => setTimeout(resolve, config.feedbackWorker.retryDelayMs));
      }
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
  logger.info({
    workerId,
    batchSize: config.feedbackWorker.batchSize,
    blockTimeoutMs: config.feedbackWorker.blockTimeoutMs,
    maxRetries: config.feedbackWorker.maxRetries,
    healthPort: HEALTH_PORT,
  }, 'Bootstrapping feedback worker...');

  // Запускаем health server
  healthServer = createHealthServer({
    port: HEALTH_PORT,
    workerId,
    getStatus: () => ({
      totalEventsProcessed,
      totalBatchesProcessed,
      lastBatchDurationMs,
      isProcessing: currentBatchPromise !== null,
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

  // Ожидаем подключения к Redis (критично для этого воркера)
  const redisOk = await waitForRedis();
  if (!redisOk) {
    logger.fatal('Failed to connect to Redis after retries');
    process.exit(1);
  }

  logEvent('worker-started', { workerId, healthPort: HEALTH_PORT });

  // Запускаем main loop
  await mainLoop();
}

bootstrap().catch((err) => {
  logError(err, 'bootstrap');
  process.exit(1);
});
