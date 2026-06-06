/**
 * Унифицированный модуль работы с Redis
 * Включает поддержку Redis Streams для надёжной обработки сообщений
 * @module lib/redis
 */

const { createClient } = require('redis');
const config = require('../config');
const { createLogger, logError, logPerformance } = require('./logger');
const { generateSecureSessionId, validateSecureSessionId } = require('./sessionSecurity');

const logger = createLogger('redis');

// ============================================
// Redis клиент (singleton)
// ============================================

/** @type {import('redis').RedisClientType|null} */
let client = null;
let isShuttingDown = false;

/**
 * Создаёт и подключает Redis клиент
 * @returns {Promise<import('redis').RedisClientType>}
 */
async function connect() {
  if (client && client.isOpen) {
    return client;
  }

  const redisPassword = typeof config.redis.password === 'string' ? config.redis.password : '';
  const encodedPassword = redisPassword ? encodeURIComponent(redisPassword) : '';
  const redisUrl = encodedPassword
    ? `redis://:${encodedPassword}@${config.redis.host}:${config.redis.port}/${config.redis.db}`
    : `redis://${config.redis.host}:${config.redis.port}/${config.redis.db}`;

  client = createClient({
    url: redisUrl,
    socket: {
      connectTimeout: config.redis.connectTimeoutMs,
      reconnectStrategy: (retries) => {
        if (isShuttingDown) {
          return new Error('Shutting down');
        }
        const delay = Math.min(retries * config.redis.retryDelayMs, 30000);
        logger.warn({ retries, delay }, 'Redis reconnecting...');
        return delay;
      },
    },
  });

  client.on('error', (err) => {
    logError(err, 'redis-client');
  });

  client.on('connect', () => {
    logger.info('Redis client connected');
  });

  client.on('ready', () => {
    logger.info('Redis client ready');
  });

  client.on('reconnecting', () => {
    logger.warn('Redis client reconnecting...');
  });

  await client.connect();
  return client;
}

/**
 * Получает Redis клиент (с автоматическим подключением)
 * @returns {Promise<import('redis').RedisClientType>}
 */
async function getClient() {
  if (!client || !client.isOpen) {
    return connect();
  }
  return client;
}

/**
 * Проверяет готовность Redis
 * @returns {boolean}
 */
function isReady() {
  return client !== null && client.isOpen && client.isReady;
}

/**
 * Закрывает соединение с Redis
 * @returns {Promise<void>}
 */
async function disconnect() {
  isShuttingDown = true;
  if (client) {
    try {
      await client.quit();
      logger.info('Redis client disconnected');
    } catch (err) {
      logError(err, 'redis-disconnect');
      // Принудительное закрытие
      client.disconnect();
    }
    client = null;
  }
}

async function setActiveSessionId(userId, sessionId, ttlSeconds = config.recommendations.sessionTtlSeconds, options = {}) {
  const uid = Number.parseInt(String(userId), 10);
  if (!Number.isFinite(uid) || uid <= 0) {
    return;
  }
  if (!sessionId || typeof sessionId !== 'string') {
    return;
  }

  let ttl = ttlSeconds;
  let opts = options;
  if (ttlSeconds && typeof ttlSeconds === 'object') {
    opts = ttlSeconds;
    ttl = config.recommendations.sessionTtlSeconds;
  }

  const engine = opts && typeof opts.engine === 'string' ? opts.engine.trim() : '';

  const redis = await getClient();
  const key = engine
    ? config.redisKeys.activeSessionByEngine(engine, uid)
    : config.redisKeys.activeSession(uid);

  await redis.set(key, sessionId, { EX: ttl });
}

async function getActiveSessionId(userId, options = {}) {
  const uid = Number.parseInt(String(userId), 10);
  if (!Number.isFinite(uid) || uid <= 0) {
    return null;
  }

  const engine = options && typeof options.engine === 'string' ? options.engine.trim() : '';

  const redis = await getClient();
  const key = engine
    ? config.redisKeys.activeSessionByEngine(engine, uid)
    : config.redisKeys.activeSession(uid);

  const value = await redis.get(key);
  return value && typeof value === 'string' ? value : null;
}

async function clearActiveSessionId(userId, options = {}) {
  const uid = Number.parseInt(String(userId), 10);
  if (!Number.isFinite(uid) || uid <= 0) {
    return false;
  }

  const engine = options && typeof options.engine === 'string' ? options.engine.trim() : '';

  const redis = await getClient();
  const key = engine
    ? config.redisKeys.activeSessionByEngine(engine, uid)
    : config.redisKeys.activeSession(uid);

  const result = await redis.del(key);
  return result > 0;
}

// ============================================
// Realtime Exclusion (anti-repeat)
// ============================================

async function markRecentTrack(userId, trackId, ttlSeconds = config.recommendations.realtimeRecentTtlSeconds) {
  const redis = await getClient();
  const key = config.redisKeys.recentTrack(userId, trackId);
  await redis.set(key, '1', { EX: ttlSeconds });
}

async function markSkipTrack(userId, trackId, ttlSeconds = config.recommendations.realtimeSkipTtlSeconds) {
  const redis = await getClient();
  const key = config.redisKeys.skipTrack(userId, trackId);
  await redis.set(key, '1', { EX: ttlSeconds });
}

async function markDislikeTrack(userId, trackId, ttlSeconds = config.recommendations.realtimeDislikeTtlSeconds) {
  const redis = await getClient();
  const key = config.redisKeys.dislikeTrack(userId, trackId);
  await redis.set(key, '1', { EX: ttlSeconds });
}

async function filterRealtimeDislikedIds(userId, ids) {
  const normalizedIds = [...new Set(
    (Array.isArray(ids) ? ids : [])
      .map((id) => Number.parseInt(id, 10))
      .filter((id) => Number.isFinite(id) && id > 0)
  )];

  if (normalizedIds.length === 0) return [];

  const redis = await getClient();
  const keys = normalizedIds.map((id) => config.redisKeys.dislikeTrack(userId, id));
  const values = await redis.mGet(keys);

  const blocked = new Set();
  for (let i = 0; i < normalizedIds.length; i++) {
    if (values[i] != null) {
      blocked.add(normalizedIds[i]);
    }
  }

  return normalizedIds.filter((id) => !blocked.has(id));
}

async function filterRealtimeExcludedIds(userId, ids) {
  const normalizedIds = [...new Set(
    (Array.isArray(ids) ? ids : [])
      .map((id) => Number.parseInt(id, 10))
      .filter((id) => Number.isFinite(id) && id > 0)
  )];

  if (normalizedIds.length === 0) return [];

  const redis = await getClient();
  const keys = [];
  for (const id of normalizedIds) {
    keys.push(config.redisKeys.recentTrack(userId, id));
    keys.push(config.redisKeys.skipTrack(userId, id));
    keys.push(config.redisKeys.dislikeTrack(userId, id));
  }

  const values = await redis.mGet(keys);
  const blocked = new Set();
  for (let i = 0; i < normalizedIds.length; i++) {
    const base = i * 3;
    const recentVal = values[base];
    const skipVal = values[base + 1];
    const dislikeVal = values[base + 2];
    if (recentVal != null || skipVal != null || dislikeVal != null) {
      blocked.add(normalizedIds[i]);
    }
  }

  return normalizedIds.filter((id) => !blocked.has(id));
}

// ============================================
// Daily Seen / Impression Tracking (anti-repeat)
// ============================================

async function addDailySeen(userId, ids, ttlSeconds = config.recommendations.dailySeenTtlSeconds) {
  const uid = Number.parseInt(String(userId), 10);
  if (!Number.isFinite(uid) || uid <= 0) {
    return;
  }

  const values = (Array.isArray(ids) ? ids : [])
    .map((id) => Number.parseInt(id, 10))
    .filter((id) => Number.isFinite(id) && id > 0)
    .map((id) => String(id));

  if (values.length === 0) {
    return;
  }

  const redis = await getClient();
  const key = config.redisKeys.dailySeen(uid);

  const pipeline = redis.multi();
  pipeline.sAdd(key, values);
  pipeline.expire(key, Math.max(60, Number(ttlSeconds) || 86400));
  await pipeline.exec();
}

async function filterDailySeenIds(userId, ids) {
  const uid = Number.parseInt(String(userId), 10);
  if (!Number.isFinite(uid) || uid <= 0) {
    return Array.isArray(ids) ? ids : [];
  }

  const list = Array.isArray(ids) ? ids : [];
  if (list.length === 0) {
    return [];
  }

  const normalized = [];
  const seenLocal = new Set();
  for (const raw of list) {
    const id = Number.parseInt(raw, 10);
    if (!Number.isFinite(id) || id <= 0) continue;
    if (seenLocal.has(id)) continue;
    seenLocal.add(id);
    normalized.push(id);
  }

  if (normalized.length === 0) {
    return [];
  }

  const maxCheck = Math.max(100, Number(config.recommendations.dailySeenMaxCheck) || 5000);
  const slice = normalized.slice(0, Math.min(maxCheck, normalized.length));

  const redis = await getClient();
  const key = config.redisKeys.dailySeen(uid);

  let membership = null;
  if (typeof redis.sMisMember === 'function') {
    membership = await redis.sMisMember(key, slice.map((id) => String(id)));
  }

  if (!membership) {
    const pipeline = redis.multi();
    for (const id of slice) {
      pipeline.sIsMember(key, String(id));
    }
    membership = await pipeline.exec();
  }

  const blocked = new Set();
  for (let i = 0; i < slice.length; i++) {
    const v = membership?.[i];
    if (v === 1 || v === true) {
      blocked.add(slice[i]);
    }
  }

  const out = [];
  for (const id of normalized) {
    if (!blocked.has(id)) {
      out.push(id);
    }
  }
  return out;
}

// ============================================
// Redis Streams для Feedback Queue
// ============================================

/**
 * Инициализирует consumer group для feedback stream
 * @returns {Promise<void>}
 */
async function initFeedbackStream() {
  const redis = await getClient();
  const streamKey = config.redisKeys.feedbackStream();
  const groupName = config.redisKeys.feedbackConsumerGroup();

  try {
    await redis.xGroupCreate(streamKey, groupName, '0', { MKSTREAM: true });
    logger.info({ streamKey, groupName }, 'Feedback stream consumer group created');
  } catch (err) {
    // BUSYGROUP = группа уже существует, это OK
    if (err.message && err.message.includes('BUSYGROUP')) {
      logger.debug({ streamKey, groupName }, 'Feedback stream consumer group already exists');
    } else {
      throw err;
    }
  }
}

/**
 * Добавляет событие в feedback stream
 * @param {object} event - Событие для записи
 * @returns {Promise<string>} - ID сообщения
 */
async function enqueueFeedback(event) {
  const redis = await getClient();
  const streamKey = config.redisKeys.feedbackStream();

  const startTime = Date.now();
  const messageId = await redis.xAdd(streamKey, '*', {
    data: JSON.stringify(event),
    timestamp: Date.now().toString(),
  });

  logPerformance('redis-xadd-feedback', Date.now() - startTime);
  logger.debug({ messageId, streamKey }, 'Feedback event enqueued');

  return messageId;
}

/**
 * Читает события из feedback stream (для consumer)
 * @param {string} consumerName - Имя consumer
 * @param {number} count - Количество сообщений
 * @param {number} blockMs - Время ожидания в мс
 * @returns {Promise<Array<{id: string, data: object}>>}
 */
async function readFeedbackBatch(consumerName, count, blockMs) {
  const redis = await getClient();
  const streamKey = config.redisKeys.feedbackStream();
  const groupName = config.redisKeys.feedbackConsumerGroup();

  const startTime = Date.now();
  let messages;
  try {
    messages = await redis.xReadGroup(
      groupName,
      consumerName,
      { key: streamKey, id: '>' },
      { COUNT: count, BLOCK: blockMs }
    );
  } catch (err) {
    if (err?.message && String(err.message).includes('NOGROUP')) {
      await initFeedbackStream();
      messages = await redis.xReadGroup(
        groupName,
        consumerName,
        { key: streamKey, id: '>' },
        { COUNT: count, BLOCK: blockMs }
      );
    } else {
      throw err;
    }
  }

  logPerformance('redis-xreadgroup-feedback', Date.now() - startTime, { count });

  if (!messages || messages.length === 0) {
    return [];
  }

  const result = [];
  for (const stream of messages) {
    for (const message of stream.messages) {
      try {
        const data = JSON.parse(message.message.data);
        result.push({
          id: message.id,
          data,
          timestamp: Number.parseInt(message.message.timestamp, 10),
        });
      } catch (err) {
        logger.error({ err, messageId: message.id }, 'Failed to parse feedback message');
      }
    }
  }

  return result;
}

/**
 * Подтверждает обработку сообщений (ACK)
 * @param {string[]} messageIds - ID сообщений для подтверждения
 * @returns {Promise<number>} - Количество подтверждённых
 */
async function ackFeedbackMessages(messageIds) {
  if (!messageIds || messageIds.length === 0) {
    return 0;
  }

  const redis = await getClient();
  const streamKey = config.redisKeys.feedbackStream();
  const groupName = config.redisKeys.feedbackConsumerGroup();

  const startTime = Date.now();
  const acked = await redis.xAck(streamKey, groupName, messageIds);

  logPerformance('redis-xack-feedback', Date.now() - startTime, { count: messageIds.length });
  logger.debug({ count: acked }, 'Feedback messages acknowledged');

  return acked;
}

/**
 * Перемещает сообщение в DLQ (Dead Letter Queue)
 * @param {string} messageId - ID сообщения
 * @param {object} data - Данные сообщения
 * @param {string} errorMessage - Причина ошибки
 * @returns {Promise<void>}
 */
async function moveToDLQ(messageId, data, errorMessage) {
  const redis = await getClient();
  const dlqKey = config.redisKeys.feedbackDLQ();
  const streamKey = config.redisKeys.feedbackStream();
  const groupName = config.redisKeys.feedbackConsumerGroup();

  const dlqEntry = {
    originalId: messageId,
    data: JSON.stringify(data),
    error: errorMessage,
    timestamp: Date.now().toString(),
  };

  const pipeline = redis.multi();
  pipeline.xAdd(dlqKey, '*', dlqEntry);
  pipeline.xAck(streamKey, groupName, messageId);

  await pipeline.exec();
  logger.warn({ messageId, error: errorMessage }, 'Message moved to DLQ');
}

/**
 * Получает pending сообщения (не обработанные)
 * @param {number} count - Количество сообщений
 * @param {number} minIdleMs - Минимальное время простоя
 * @returns {Promise<Array>}
 */
async function getPendingFeedback(count, minIdleMs) {
  const redis = await getClient();
  const streamKey = config.redisKeys.feedbackStream();
  const groupName = config.redisKeys.feedbackConsumerGroup();

  const pending = await redis.xPending(streamKey, groupName);
  if (!pending || pending.pending === 0) {
    return [];
  }

  const detailed = await redis.xPendingRange(
    streamKey,
    groupName,
    '-',
    '+',
    count
  );

  return detailed.filter((msg) => msg.millisecondsSinceLastDelivery >= minIdleMs);
}

/**
 * Забирает pending сообщения у другого consumer (claim)
 * @param {string} consumerName - Имя нового consumer
 * @param {string[]} messageIds - ID сообщений
 * @param {number} minIdleMs - Минимальное время простоя
 * @returns {Promise<Array>}
 */
async function claimPendingFeedback(consumerName, messageIds, minIdleMs) {
  if (!messageIds || messageIds.length === 0) {
    return [];
  }

  const redis = await getClient();
  const streamKey = config.redisKeys.feedbackStream();
  const groupName = config.redisKeys.feedbackConsumerGroup();

  const claimed = await redis.xClaim(
    streamKey,
    groupName,
    consumerName,
    minIdleMs,
    messageIds
  );

  logger.debug({ count: claimed.length, consumerName }, 'Claimed pending messages');
  return claimed;
}

// ============================================
// Сессии рекомендаций
// ============================================

/**
 * Сохраняет сессию рекомендаций
 * @param {string} sessionId
 * @param {object} data
 * @param {number} [ttlSeconds]
 * @returns {Promise<void>}
 */
async function saveSession(sessionId, data, ttlSeconds = config.recommendations.sessionTtlSeconds) {
  const redis = await getClient();
  const key = config.redisKeys.session(sessionId);

  await redis.set(key, JSON.stringify(data), { EX: ttlSeconds });
  logger.debug({ sessionId }, 'Session saved');
}

/**
 * Загружает сессию рекомендаций
 * @param {string} sessionId
 * @returns {Promise<object|null>}
 */
async function loadSession(sessionId) {
  const redis = await getClient();
  const key = config.redisKeys.session(sessionId);

  const data = await redis.get(key);
  if (!data) {
    return null;
  }

  try {
    return JSON.parse(data);
  } catch (err) {
    logger.error({ err, sessionId }, 'Failed to parse session data');
    return null;
  }
}

/**
 * Продлевает TTL сессии
 * @param {string} sessionId
 * @param {number} [ttlSeconds]
 * @returns {Promise<boolean>}
 */
async function touchSession(sessionId, ttlSeconds = config.recommendations.sessionTtlSeconds) {
  const redis = await getClient();
  const sessionKey = config.redisKeys.session(sessionId);
  const excludeKey = config.redisKeys.sessionExclude(sessionId);
  const impressionsKey = config.redisKeys.sessionImpressions(sessionId);
  const positiveIntentKey = config.redisKeys.sessionIntentPositive(sessionId);
  const negativeIntentKey = config.redisKeys.sessionIntentNegative(sessionId);

  const pipeline = redis.multi();
  pipeline.expire(sessionKey, ttlSeconds);
  pipeline.expire(excludeKey, ttlSeconds);
  pipeline.expire(impressionsKey, ttlSeconds);
  pipeline.expire(positiveIntentKey, ttlSeconds);
  pipeline.expire(negativeIntentKey, ttlSeconds);
  const results = await pipeline.exec();

  const first = results?.[0];
  return first === 1 || first === true;
}

async function createEphemeralSession(userId, ttlSeconds = config.engineV2.sessionTtlSeconds) {
  const uid = Number.parseInt(String(userId), 10);
  if (!Number.isFinite(uid) || uid <= 0) {
    throw new Error('Invalid userId');
  }

  const sessionId = generateSecureSessionId(uid);
  const redis = await getClient();
  const key = config.redisKeys.session(sessionId);

  await redis.set(
    key,
    JSON.stringify({
      userId: uid,
      engine: 'v2',
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    }),
    { EX: ttlSeconds }
  );

  return sessionId;
}

async function touchEphemeralSession(userId, sessionId, ttlSeconds = config.engineV2.sessionTtlSeconds) {
  const uid = Number.parseInt(String(userId), 10);
  if (!Number.isFinite(uid) || uid <= 0) {
    return false;
  }
  if (!sessionId || typeof sessionId !== 'string') {
    return false;
  }

  const validation = validateSecureSessionId(sessionId, uid);
  if (!validation.valid || Number(validation.userId) !== uid) {
    return false;
  }

  const redis = await getClient();
  const sessionKey = config.redisKeys.session(sessionId);
  const excludeKey = config.redisKeys.sessionExclude(sessionId);
  const impressionsKey = config.redisKeys.sessionImpressions(sessionId);
  const positiveIntentKey = config.redisKeys.sessionIntentPositive(sessionId);
  const negativeIntentKey = config.redisKeys.sessionIntentNegative(sessionId);

  const ttl = Math.max(60, Number(ttlSeconds) || config.engineV2.sessionTtlSeconds);

  const pipeline = redis.multi();
  pipeline.expire(sessionKey, ttl);
  pipeline.expire(excludeKey, ttl);
  pipeline.expire(impressionsKey, ttl);
  pipeline.expire(positiveIntentKey, ttl);
  pipeline.expire(negativeIntentKey, ttl);
  const results = await pipeline.exec();

  const first = results?.[0];
  return first === 1 || first === true;
}

async function addSessionImpressions(sessionId, ids, ttlSeconds = config.engineV2.sessionTtlSeconds) {
  if (!sessionId || !ids || ids.length === 0) {
    return;
  }

  const redis = await getClient();
  const key = config.redisKeys.sessionImpressions(sessionId);

  const values = ids
    .map((id) => Number.parseInt(id, 10))
    .filter((id) => Number.isFinite(id) && id > 0)
    .map((id) => String(id));

  if (values.length === 0) {
    return;
  }

  const pipeline = redis.multi();
  pipeline.sAdd(key, values);
  pipeline.expire(key, Math.max(60, Number(ttlSeconds) || config.engineV2.sessionTtlSeconds));
  await pipeline.exec();
}

async function sessionHadImpression(sessionId, trackId) {
  if (!sessionId) {
    return false;
  }

  const id = Number.parseInt(trackId, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return false;
  }

  const redis = await getClient();
  const key = config.redisKeys.sessionImpressions(sessionId);
  const v = await redis.sIsMember(key, String(id));
  return v === 1 || v === true;
}

async function sessionHadImpressions(sessionId, ids) {
  if (!sessionId) {
    return new Map();
  }

  const normalizedIds = [...new Set(
    (Array.isArray(ids) ? ids : [])
      .map((id) => Number.parseInt(id, 10))
      .filter((id) => Number.isFinite(id) && id > 0)
  )];

  if (normalizedIds.length === 0) {
    return new Map();
  }

  const redis = await getClient();
  const key = config.redisKeys.sessionImpressions(sessionId);

  if (typeof redis.sMisMember === 'function') {
    const results = await redis.sMisMember(key, normalizedIds.map((id) => String(id)));
    const out = new Map();
    for (let i = 0; i < normalizedIds.length; i++) {
      const v = results?.[i];
      out.set(normalizedIds[i], v === 1 || v === true);
    }
    return out;
  }

  const pipeline = redis.multi();
  for (const id of normalizedIds) {
    pipeline.sIsMember(key, String(id));
  }

  const results = await pipeline.exec();
  const out = new Map();
  for (let i = 0; i < normalizedIds.length; i++) {
    const v = results?.[i];
    out.set(normalizedIds[i], v === 1 || v === true);
  }
  return out;
}

async function appendSessionIntentTrack(sessionId, trackId, polarity, weight, ttlSeconds = config.engineV2.sessionTtlSeconds) {
  if (!sessionId || typeof sessionId !== 'string') {
    return false;
  }

  const id = Number.parseInt(trackId, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return false;
  }

  const score = Number(weight);
  if (!Number.isFinite(score) || score <= 0) {
    return false;
  }

  const key = polarity === 'negative'
    ? config.redisKeys.sessionIntentNegative(sessionId)
    : config.redisKeys.sessionIntentPositive(sessionId);
  const ttl = Math.max(60, Number(ttlSeconds) || config.engineV2.sessionTtlSeconds);
  const limit = Math.max(2, Number(config.engineV2.onlineIntentMaxAnchors) || 24);
  const redis = await getClient();

  await redis.sendCommand(['ZINCRBY', key, String(score), String(id)]);
  await redis.sendCommand(['ZREMRANGEBYRANK', key, '0', String(-(limit + 1))]);
  await redis.expire(key, ttl);
  return true;
}

async function loadSessionIntentTrackIds(sessionId, maxAnchors = config.engineV2.onlineIntentMaxAnchors) {
  if (!sessionId || typeof sessionId !== 'string') {
    return { positive: [], negative: [] };
  }

  const limit = Math.max(1, Number(maxAnchors) || 24);
  const redis = await getClient();
  const positiveKey = config.redisKeys.sessionIntentPositive(sessionId);
  const negativeKey = config.redisKeys.sessionIntentNegative(sessionId);
  const stop = String(limit - 1);

  const [positiveRaw, negativeRaw] = await Promise.all([
    redis.sendCommand(['ZREVRANGE', positiveKey, '0', stop]),
    redis.sendCommand(['ZREVRANGE', negativeKey, '0', stop]),
  ]);

  const normalize = (values) => [...new Set((Array.isArray(values) ? values : [])
    .map((id) => Number.parseInt(id, 10))
    .filter((id) => Number.isFinite(id) && id > 0))];

  return {
    positive: normalize(positiveRaw),
    negative: normalize(negativeRaw),
  };
}

async function boostSessionTrackIds(sessionId, anchorTrackId, insertTrackIds) {
  if (!sessionId || !Array.isArray(insertTrackIds) || insertTrackIds.length === 0) {
    return false;
  }

  const anchorId = Number.parseInt(anchorTrackId, 10);
  const normalizedInsertIds = [...new Set(
    insertTrackIds
      .map((id) => Number.parseInt(id, 10))
      .filter((id) => Number.isFinite(id) && id > 0)
  )];

  if (normalizedInsertIds.length === 0) {
    return false;
  }

  const baseClient = await getClient();
  const txClient = baseClient.duplicate();
  await txClient.connect();

  try {
    const key = config.redisKeys.session(sessionId);
    const ttlSeconds = config.recommendations.sessionTtlSeconds;
    const maxTrackIds = config.recommendations.sessionMaxTrackIds;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await txClient.watch(key);
      const raw = await txClient.get(key);
      if (!raw) {
        await txClient.unwatch();
        return false;
      }

      let session;
      try {
        session = JSON.parse(raw);
      } catch {
        await txClient.unwatch();
        return false;
      }

      const existing = Array.isArray(session.trackIds) ? session.trackIds : [];
      const normalizedExisting = existing
        .map((id) => Number.parseInt(id, 10))
        .filter((id) => Number.isFinite(id) && id > 0);
      const existingSet = new Set(normalizedExisting);

      const toInsert = normalizedInsertIds.filter((id) => !existingSet.has(id));
      if (toInsert.length === 0) {
        await txClient.unwatch();
        return false;
      }

      const anchorIndex = Number.isFinite(anchorId) && anchorId > 0 ? normalizedExisting.indexOf(anchorId) : -1;
      const insertPos = anchorIndex >= 0 ? anchorIndex + 1 : 0;

      const merged = normalizedExisting
        .slice(0, insertPos)
        .concat(toInsert)
        .concat(normalizedExisting.slice(insertPos));

      const limited = merged.slice(0, Math.max(1, Number(maxTrackIds) || 1000));
      session.trackIds = limited;
      session.lastAccessedAt = Date.now();

      const multi = txClient.multi();
      multi.set(key, JSON.stringify(session), { EX: ttlSeconds });
      const res = await multi.exec();

      if (res) {
        return true;
      }
    }

    return false;
  } finally {
    await txClient.quit().catch(() => { });
  }
}

async function appendSessionTrackIds(sessionId, insertTrackIds) {
  if (!sessionId || !Array.isArray(insertTrackIds) || insertTrackIds.length === 0) {
    return false;
  }

  const normalizedInsertIds = [...new Set(
    insertTrackIds
      .map((id) => Number.parseInt(id, 10))
      .filter((id) => Number.isFinite(id) && id > 0)
  )];

  if (normalizedInsertIds.length === 0) {
    return false;
  }

  const baseClient = await getClient();
  const txClient = baseClient.duplicate();
  await txClient.connect();

  try {
    const key = config.redisKeys.session(sessionId);
    const ttlSeconds = config.recommendations.sessionTtlSeconds;
    const maxTrackIds = config.recommendations.sessionMaxTrackIds;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await txClient.watch(key);
      const raw = await txClient.get(key);
      if (!raw) {
        await txClient.unwatch();
        return false;
      }

      let session;
      try {
        session = JSON.parse(raw);
      } catch {
        await txClient.unwatch();
        return false;
      }

      const existing = Array.isArray(session.trackIds) ? session.trackIds : [];
      const normalizedExisting = existing
        .map((id) => Number.parseInt(id, 10))
        .filter((id) => Number.isFinite(id) && id > 0);
      const existingSet = new Set(normalizedExisting);

      const toInsert = normalizedInsertIds.filter((id) => !existingSet.has(id));
      if (toInsert.length === 0) {
        await txClient.unwatch();
        return false;
      }

      const merged = normalizedExisting.concat(toInsert);
      const limit = Math.max(1, Number(maxTrackIds) || 1000);
      const start = Math.max(0, merged.length - limit);
      const limited = merged.slice(start);

      session.trackIds = limited;
      session.lastAccessedAt = Date.now();

      const multi = txClient.multi();
      multi.set(key, JSON.stringify(session), { EX: ttlSeconds });
      const res = await multi.exec();

      if (res) {
        return true;
      }
    }

    return false;
  } finally {
    await txClient.quit().catch(() => { });
  }
}

async function saveSessionExcludeIds(sessionId, ids, maxSize = config.recommendations.maxExcludeIds) {
  const redis = await getClient();
  const key = config.redisKeys.sessionExclude(sessionId);

  const validIds = [...new Set(
    (Array.isArray(ids) ? ids : [])
      .map((id) => Number.parseInt(id, 10))
      .filter((id) => Number.isFinite(id) && id > 0)
  )]
    .map((id) => String(id))
    .filter((id) => /^\d+$/.test(id));

  const limit = Math.max(0, Number(maxSize) || 0);
  const limited = limit > 0 ? validIds.slice(0, limit) : [];

  const pipeline = redis.multi();
  pipeline.del(key);
  if (limited.length > 0) {
    pipeline.rPush(key, limited);
  }
  pipeline.expire(key, config.recommendations.sessionTtlSeconds);
  await pipeline.exec();
}

/**
 * Добавляет ID в список исключений сессии (атомарно)
 * @param {string} sessionId
 * @param {number[]} ids
 * @param {number} maxSize - Максимальный размер списка
 * @returns {Promise<void>}
 */
async function appendSessionExcludeIds(
  sessionId,
  ids,
  maxSize = config.recommendations.maxExcludeIds,
  ttlSeconds = config.recommendations.sessionTtlSeconds
) {
  if (!ids || ids.length === 0) {
    return;
  }

  const redis = await getClient();
  const key = config.redisKeys.sessionExclude(sessionId);

  const validIds = [...new Set(
    ids
      .map((id) => String(id))
      .filter((id) => /^\d+$/.test(id))
  )];

  if (validIds.length === 0) {
    return;
  }

  const limit = Math.max(1, Number(maxSize) || config.recommendations.maxExcludeIds);

  const pipeline = redis.multi();
  for (const id of validIds) {
    pipeline.lRem(key, 0, id);
  }
  pipeline.lPush(key, validIds);
  pipeline.lTrim(key, 0, limit - 1);
  pipeline.expire(key, Math.max(60, Number(ttlSeconds) || config.recommendations.sessionTtlSeconds));

  await pipeline.exec();
}

/**
 * Загружает список исключений сессии
 * @param {string} sessionId
 * @returns {Promise<number[]>}
 */
async function loadSessionExcludeIds(sessionId) {
  const redis = await getClient();
  const key = config.redisKeys.sessionExclude(sessionId);

  // Используем cursor-based pagination для больших списков
  const maxFetch = config.recommendations.maxExcludeIds;
  const rawIds = await redis.lRange(key, 0, maxFetch - 1);

  if (!rawIds || rawIds.length === 0) {
    return [];
  }

  return rawIds
    .map((id) => Number.parseInt(id, 10))
    .filter((id) => Number.isFinite(id) && id > 0);
}

// ============================================
// Офлайн-рекомендации
// ============================================

/**
 * Загружает офлайн-рекомендации для пользователя
 * @param {number} userId
 * @returns {Promise<number[]>}
 */
async function loadOfflineRecommendations(userId) {
  const redis = await getClient();
  const key = config.redisKeys.offlineList(userId);

  const data = await redis.get(key);
  if (!data) {
    return [];
  }

  try {
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((id) => Number.parseInt(id, 10))
      .filter((id) => Number.isFinite(id) && id > 0);
  } catch (err) {
    logger.error({ err, userId }, 'Failed to parse offline recommendations');
    return [];
  }
}

/**
 * Загружает глобальные офлайн-рекомендации для legacy/offline worker.
 * @returns {Promise<number[]>}
 */
async function loadGlobalRecommendations() {
  const redis = await getClient();
  const key = config.redisKeys.offlineGlobal();

  const data = await redis.get(key);
  if (!data) {
    return [];
  }

  try {
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((id) => Number.parseInt(id, 10))
      .filter((id) => Number.isFinite(id) && id > 0);
  } catch (err) {
    logger.error({ err }, 'Failed to parse global recommendations');
    return [];
  }
}

/**
 * Сохраняет офлайн-рекомендации для пользователя
 * @param {number} userId
 * @param {number[]} trackIds
 * @param {number} ttlSeconds
 * @returns {Promise<void>}
 */
async function saveOfflineRecommendations(userId, trackIds, ttlSeconds = config.offlineWorker.redisTtlSeconds) {
  const redis = await getClient();
  const key = config.redisKeys.offlineList(userId);

  await redis.set(key, JSON.stringify(trackIds), { EX: ttlSeconds });
}

/**
 * Сохраняет глобальные рекомендации
 * @param {number[]} trackIds
 * @param {number} ttlSeconds
 * @returns {Promise<void>}
 */
async function saveGlobalRecommendations(trackIds, ttlSeconds = config.offlineWorker.redisTtlSeconds) {
  const redis = await getClient();
  const key = config.redisKeys.offlineGlobal();

  await redis.set(key, JSON.stringify(trackIds), { EX: ttlSeconds });
}

/**
 * Пакетное сохранение рекомендаций (для offline worker)
 * @param {Map<number, number[]>} recommendations - Map userId -> trackIds
 * @param {number[]} globalTrackIds
 * @param {number} ttlSeconds
 * @returns {Promise<number>} - Количество сохранённых
 */
async function saveRecommendationsBatch(recommendations, globalTrackIds, ttlSeconds = config.offlineWorker.redisTtlSeconds) {
  const redis = await getClient();
  const pipeline = redis.multi();

  // Глобальные рекомендации
  if (globalTrackIds && globalTrackIds.length > 0) {
    const globalKey = config.redisKeys.offlineGlobal();
    pipeline.set(globalKey, JSON.stringify(globalTrackIds), { EX: ttlSeconds });
  }

  // Персональные рекомендации
  let count = 0;
  for (const [userId, trackIds] of recommendations) {
    const key = config.redisKeys.offlineList(userId);
    pipeline.set(key, JSON.stringify(trackIds), { EX: ttlSeconds });
    count += 1;
  }

  await pipeline.exec();
  logger.info({ userCount: count, hasGlobal: globalTrackIds?.length > 0 }, 'Recommendations batch saved');

  return count;
}

// ============================================
// Distributed Lock для Offline Worker
// ============================================

/**
 * Пытается захватить распределённую блокировку
 * @param {string} lockId - Уникальный идентификатор воркера
 * @param {number} ttlSeconds
 * @returns {Promise<boolean>}
 */
async function acquireLock(lockId, ttlSeconds = config.offlineWorker.lockTtlSeconds, options = {}) {
  const redis = await getClient();
  const key = options && typeof options.key === 'string' && options.key.trim()
    ? options.key.trim()
    : config.redisKeys.offlineWorkerLock();

  const acquired = await redis.set(key, lockId, { NX: true, EX: ttlSeconds });
  if (acquired) {
    logger.info({ lockId }, 'Worker lock acquired');
  }
  return acquired === 'OK';
}

/**
 * Освобождает распределённую блокировку (только если владеем ей)
 * @param {string} lockId
 * @returns {Promise<boolean>}
 */
async function releaseLock(lockId, options = {}) {
  const redis = await getClient();
  const key = options && typeof options.key === 'string' && options.key.trim()
    ? options.key.trim()
    : config.redisKeys.offlineWorkerLock();

  // Lua script для атомарной проверки и удаления
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;

  const result = await redis.eval(script, { keys: [key], arguments: [lockId] });
  if (result === 1) {
    logger.info({ lockId }, 'Worker lock released');
    return true;
  }
  return false;
}

/**
 * Продлевает блокировку (если владеем ей)
 * @param {string} lockId
 * @param {number} ttlSeconds
 * @returns {Promise<boolean>}
 */
async function extendLock(lockId, ttlSeconds = config.offlineWorker.lockTtlSeconds, options = {}) {
  const redis = await getClient();
  const key = options && typeof options.key === 'string' && options.key.trim()
    ? options.key.trim()
    : config.redisKeys.offlineWorkerLock();

  // Lua script для атомарной проверки и обновления TTL
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("expire", KEYS[1], ARGV[2])
    else
      return 0
    end
  `;

  const result = await redis.eval(script, { keys: [key], arguments: [lockId, String(ttlSeconds)] });
  return result === 1;
}

// ============================================
// Track Cache (распределённый Redis кэш)
// ============================================

const TRACK_CACHE_PREFIX = `${config.redisKeys.prefix}track:`;
const TRACK_CACHE_TTL = 300; // 5 минут

/**
 * Кэширует трек в Redis
 * @param {number} trackId
 * @param {object} track
 * @param {number} [ttlSeconds]
 * @returns {Promise<void>}
 */
async function cacheTrack(trackId, track, ttlSeconds = TRACK_CACHE_TTL) {
  const redis = await getClient();
  const key = `${TRACK_CACHE_PREFIX}${trackId}`;
  await redis.set(key, JSON.stringify(track), { EX: ttlSeconds });
}

/**
 * Получает трек из кэша
 * @param {number} trackId
 * @returns {Promise<object|null>}
 */
async function getCachedTrack(trackId) {
  const redis = await getClient();
  const key = `${TRACK_CACHE_PREFIX}${trackId}`;
  const data = await redis.get(key);
  return data ? JSON.parse(data) : null;
}

/**
 * Кэширует несколько треков одним batch запросом
 * @param {object[]} tracks
 * @param {number} [ttlSeconds]
 * @returns {Promise<void>}
 */
async function cacheTracksBatch(tracks, ttlSeconds = TRACK_CACHE_TTL) {
  if (!tracks || tracks.length === 0) return;

  const redis = await getClient();
  const pipeline = redis.multi();

  for (const track of tracks) {
    if (track && track.id) {
      const key = `${TRACK_CACHE_PREFIX}${track.id}`;
      pipeline.set(key, JSON.stringify(track), { EX: ttlSeconds });
    }
  }

  await pipeline.exec();
}

/**
 * Получает несколько треков из кэша
 * @param {number[]} trackIds
 * @returns {Promise<{cached: Map<number, object>, missing: number[]}>}
 */
async function getCachedTracksBatch(trackIds) {
  if (!trackIds || trackIds.length === 0) {
    return { cached: new Map(), missing: [] };
  }

  const redis = await getClient();
  const keys = trackIds.map((id) => `${TRACK_CACHE_PREFIX}${id}`);

  const results = await redis.mGet(keys);

  const cached = new Map();
  const missing = [];

  for (let i = 0; i < trackIds.length; i++) {
    const data = results[i];
    if (data) {
      try {
        cached.set(trackIds[i], JSON.parse(data));
      } catch {
        missing.push(trackIds[i]);
      }
    } else {
      missing.push(trackIds[i]);
    }
  }

  return { cached, missing };
}

/**
 * Инвалидирует кэш трека
 * @param {number} trackId
 * @returns {Promise<void>}
 */
async function invalidateTrackCache(trackId) {
  const redis = await getClient();
  const key = `${TRACK_CACHE_PREFIX}${trackId}`;
  await redis.del(key);
}

/**
 * Удаляет ключ из Redis
 * @param {string} key
 * @returns {Promise<boolean>}
 */
async function deleteKey(key) {
  const redis = await getClient();
  const result = await redis.del(key);
  return result > 0;
}

async function incrementSkipBurst(userId) {
  const uid = Number.parseInt(String(userId), 10);
  if (!Number.isFinite(uid) || uid <= 0) return 0;

  const windowSeconds = Math.max(60, Number(config.engineV2?.skipBurstWindowSeconds) || 300);
  const redisClient = await getClient();
  const key = config.redisKeys.skipBurst(uid);

  const pipeline = redisClient.multi();
  pipeline.incr(key);
  pipeline.expire(key, windowSeconds);
  const results = await pipeline.exec();

  return Number(results?.[0]) || 0;
}

async function getSkipBurstCount(userId) {
  const uid = Number.parseInt(String(userId), 10);
  if (!Number.isFinite(uid) || uid <= 0) return 0;

  const redisClient = await getClient();
  const key = config.redisKeys.skipBurst(uid);
  const value = await redisClient.get(key);
  return Number(value) || 0;
}

module.exports = {
  connect,
  getClient,
  isReady,
  disconnect,

  // Feedback Stream
  initFeedbackStream,
  enqueueFeedback,
  readFeedbackBatch,
  ackFeedbackMessages,
  moveToDLQ,

  // Realtime exclusion
  markRecentTrack,
  markSkipTrack,
  markDislikeTrack,
  filterRealtimeExcludedIds,
  filterRealtimeDislikedIds,
  addDailySeen,
  filterDailySeenIds,
  getPendingFeedback,
  claimPendingFeedback,

  // Sessions
  saveSession,
  loadSession,
  setActiveSessionId,
  getActiveSessionId,
  clearActiveSessionId,
  touchSession,
  createEphemeralSession,
  touchEphemeralSession,
  saveSessionExcludeIds,
  loadSessionExcludeIds,
  appendSessionExcludeIds,
  addSessionImpressions,
  sessionHadImpression,
  sessionHadImpressions,
  appendSessionIntentTrack,
  loadSessionIntentTrackIds,
  boostSessionTrackIds,

  // Offline Recommendations
  loadOfflineRecommendations,
  loadGlobalRecommendations,
  saveOfflineRecommendations,
  saveGlobalRecommendations,
  saveRecommendationsBatch,

  // Distributed Lock
  acquireLock,
  releaseLock,
  extendLock,

  // Track Cache
  cacheTrack,
  getCachedTrack,
  cacheTracksBatch,
  getCachedTracksBatch,
  invalidateTrackCache,

  // Utils
  deleteKey,

  // Skip-burst detection
  incrementSkipBurst,
  getSkipBurstCount,
};
