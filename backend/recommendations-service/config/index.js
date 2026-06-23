/**
 * Централизованная конфигурация recommendations-service
 * Единый источник истины для всех настроек приложения
 * @module config
 */

require('dotenv').config();

/**
 * Валидирует и парсит числовую переменную окружения
 * @param {string} name - Имя переменной
 * @param {number} defaultValue - Значение по умолчанию
 * @param {object} options - Опции валидации
 * @param {number} [options.min] - Минимальное значение
 * @param {number} [options.max] - Максимальное значение
 * @param {boolean} [options.required] - Обязательная переменная
 * @returns {number}
 */
function parseIntEnv(name, defaultValue, options = {}) {
  const raw = process.env[name];
  const { min, max, required = false } = options;

  if (required && (raw === undefined || raw === '')) {
    throw new Error(`Environment variable ${name} is required but not set`);
  }

  if (raw === undefined || raw === '') {
    return defaultValue;
  }

  const parsed = Number.parseInt(raw, 10);

  if (Number.isNaN(parsed)) {
    throw new TypeError(`Environment variable ${name} must be a valid integer, got: ${raw}`);
  }

  if (min !== undefined && parsed < min) {
    throw new Error(`Environment variable ${name} must be >= ${min}, got: ${parsed}`);
  }

  if (max !== undefined && parsed > max) {
    throw new Error(`Environment variable ${name} must be <= ${max}, got: ${parsed}`);
  }

  return parsed;
}

/**
 * Валидирует и парсит строковую переменную окружения
 * @param {string} name - Имя переменной
 * @param {string} defaultValue - Значение по умолчанию
 * @param {object} options - Опции валидации
 * @param {boolean} [options.required] - Обязательная переменная
 * @param {string[]} [options.allowedValues] - Допустимые значения
 * @returns {string}
 */
function parseStringEnv(name, defaultValue, options = {}) {
  const raw = process.env[name];
  const { required = false, allowedValues } = options;

  if (required && (raw === undefined || raw === '')) {
    throw new Error(`Environment variable ${name} is required but not set`);
  }

  const value = raw !== undefined && raw !== '' ? raw : defaultValue;

  if (allowedValues && !allowedValues.includes(value)) {
    throw new Error(
      `Environment variable ${name} must be one of [${allowedValues.join(', ')}], got: ${value}`
    );
  }

  return value;
}

/**
 * Валидирует и парсит boolean переменную окружения
 * @param {string} name - Имя переменной
 * @param {boolean} defaultValue - Значение по умолчанию
 * @returns {boolean}
 */
function parseBoolEnv(name, defaultValue) {
  const raw = process.env[name];

  if (raw === undefined || raw === '') {
    return defaultValue;
  }

  const normalized = raw.toLowerCase().trim();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }

  throw new Error(`Environment variable ${name} must be a boolean, got: ${raw}`);
}

function parseRateLimitMultiplier() {
  const raw = process.env.RECO_RATE_LIMIT_MULTIPLIER || process.env.LOAD_TEST_RATE_LIMIT_MULTIPLIER;
  if (raw === undefined || raw === '') {
    return parseBoolEnv('LOAD_TEST_MODE', false) ? 30 : 1;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) {
    throw new Error(`Environment variable RECO_RATE_LIMIT_MULTIPLIER must be between 1 and 100, got: ${raw}`);
  }
  return parsed;
}

/**
 * Валидирует и парсит float переменную окружения
 * @param {string} name - Имя переменной
 * @param {number} defaultValue - Значение по умолчанию
 * @param {object} options - Опции валидации
 * @param {number} [options.min] - Минимальное значение
 * @param {number} [options.max] - Максимальное значение
 * @returns {number}
 */
function parseFloatEnv(name, defaultValue, options = {}) {
  const raw = process.env[name];
  const { min, max } = options;

  if (raw === undefined || raw === '') {
    return defaultValue;
  }

  const parsed = Number.parseFloat(raw);

  if (Number.isNaN(parsed)) {
    throw new TypeError(`Environment variable ${name} must be a valid number, got: ${raw}`);
  }

  if (min !== undefined && parsed < min) {
    throw new Error(`Environment variable ${name} must be >= ${min}, got: ${parsed}`);
  }

  if (max !== undefined && parsed > max) {
    throw new Error(`Environment variable ${name} must be <= ${max}, got: ${parsed}`);
  }

  return parsed;
}

/**
 * Парсит список строк из переменной окружения (через запятую)
 * @param {string} name - Имя переменной
 * @param {string[]} defaultValue - Значение по умолчанию
 * @returns {string[]}
 */
function parseListEnv(name, defaultValue) {
  const raw = process.env[name];

  if (raw === undefined || raw === '') {
    return defaultValue;
  }

  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ============================================
// Окружение
// ============================================

const NODE_ENV = parseStringEnv('NODE_ENV', 'development', {
  allowedValues: ['development', 'production', 'test'],
});

const isProduction = NODE_ENV === 'production';
const isDevelopment = NODE_ENV === 'development';
const isTest = NODE_ENV === 'test';

// ============================================
// Сервер
// ============================================

const server = Object.freeze({
  port: parseIntEnv('PORT', 3006, { min: 1, max: 65535 }),
  trustProxy: parseBoolEnv('TRUST_PROXY', true),
});

// ============================================
// База данных PostgreSQL
// ============================================

const db = Object.freeze({
  host: parseStringEnv('DB_HOST', 'localhost'),
  port: parseIntEnv('DB_PORT', 5432, { min: 1, max: 65535 }),
  database: parseStringEnv('DB_NAME', 'music_platform', { required: isProduction }),
  user: parseStringEnv('DB_USER', 'postgres', { required: isProduction }),
  password: parseStringEnv('DB_PASSWORD', '', { required: isProduction }),
  maxConnections: parseIntEnv('DB_MAX_CONNECTIONS', 20, { min: 1, max: 100 }),
  idleTimeoutMs: parseIntEnv('DB_IDLE_TIMEOUT_MS', 30000, { min: 1000 }),
  connectionTimeoutMs: parseIntEnv('DB_CONNECTION_TIMEOUT_MS', 5000, { min: 1000 }),
  statementTimeoutMs: parseIntEnv('RECO_DB_STATEMENT_TIMEOUT_MS', 30000, { min: 0 }),
  circuitBreaker: Object.freeze({
    failureThreshold: parseIntEnv('RECO_DB_CB_FAILURE_THRESHOLD', 5, { min: 1 }),
    cooldownMs: parseIntEnv('RECO_DB_CB_COOLDOWN_MS', 30000, { min: 1000 }),
  }),
});

// ============================================
// Redis
// ============================================

const redis = Object.freeze({
  host: parseStringEnv('REDIS_HOST', 'localhost'),
  port: parseIntEnv('REDIS_PORT', 6379, { min: 1, max: 65535 }),
  db: parseIntEnv('REDIS_DB', 0, { min: 0, max: 15 }),
  password: parseStringEnv('REDIS_PASSWORD', ''),
  retryDelayMs: parseIntEnv('REDIS_RETRY_DELAY_MS', 1000, { min: 100 }),
  maxRetries: parseIntEnv('REDIS_MAX_RETRIES', 10, { min: 1 }),
  connectTimeoutMs: parseIntEnv('REDIS_CONNECT_TIMEOUT_MS', 5000, { min: 1000 }),
});

// ============================================
// Ключи Redis (единое место для всех ключей)
// ============================================

const REDIS_KEY_PREFIX = parseStringEnv('RECO_REDIS_KEY_PREFIX', 'reco:');

const redisKeys = Object.freeze({
  prefix: REDIS_KEY_PREFIX,

  // Сессии рекомендаций
  session: (sessionId) => `${REDIS_KEY_PREFIX}session:${sessionId}`,
  activeSession: (userId) => `${REDIS_KEY_PREFIX}active-session:${userId}`,
  activeSessionByEngine: (engine, userId) => `${REDIS_KEY_PREFIX}active-session:${engine}:${userId}`,
  sessionExclude: (sessionId) => `${REDIS_KEY_PREFIX}session:${sessionId}:exclude`,
  sessionImpressions: (sessionId) => `${REDIS_KEY_PREFIX}session:${sessionId}:impressions`,
  sessionIntentPositive: (sessionId) => `${REDIS_KEY_PREFIX}session:${sessionId}:intent:positive`,
  sessionIntentNegative: (sessionId) => `${REDIS_KEY_PREFIX}session:${sessionId}:intent:negative`,

  // Realtime exclusion (чтобы не ждать offline-worker/БД)
  recentTrack: (userId, trackId) => `${REDIS_KEY_PREFIX}rt:recent:${userId}:${trackId}`,
  skipTrack: (userId, trackId) => `${REDIS_KEY_PREFIX}rt:skip:${userId}:${trackId}`,
  dislikeTrack: (userId, trackId) => `${REDIS_KEY_PREFIX}rt:dislike:${userId}:${trackId}`,

  // Daily anti-repeat (impressions)
  dailySeen: (userId) => `${REDIS_KEY_PREFIX}seen:today:${userId}`,

  // Офлайн-рекомендации
  offlineList: (userId) => `${REDIS_KEY_PREFIX}offline:list:${userId}`,
  offlineGlobal: () => `${REDIS_KEY_PREFIX}offline:list:__GLOBAL__`,
  offlineWorkerLock: (shardIndex = null) => {
    if (shardIndex === null || shardIndex === undefined) return `${REDIS_KEY_PREFIX}offline:worker:lock`;
    const idx = Number.parseInt(String(shardIndex), 10);
    if (!Number.isFinite(idx) || idx < 0) return `${REDIS_KEY_PREFIX}offline:worker:lock`;
    return `${REDIS_KEY_PREFIX}offline:worker:lock:${idx}`;
  },

  // Feedback Streams (замена Lists)
  feedbackStream: () => `${REDIS_KEY_PREFIX}feedback:stream`,
  feedbackConsumerGroup: () => 'feedback-workers',
  feedbackDLQ: () => `${REDIS_KEY_PREFIX}feedback:dlq`,

  // Skip-burst counter (window-based INCR with TTL)
  skipBurst: (userId) => `${REDIS_KEY_PREFIX}rt:skip_burst:${userId}`,
});

// ============================================
// Рекомендации
// ============================================

const recommendations = Object.freeze({
  defaultBatchSize: parseIntEnv('RECO_DEFAULT_BATCH_SIZE', 40, { min: 1, max: 100 }),
  maxBatchSize: parseIntEnv('RECO_MAX_BATCH_SIZE', 100, { min: 1, max: 500 }),
  maxExcludeIds: parseIntEnv('RECO_MAX_EXCLUDE_IDS', 2000, { min: 100, max: 10000 }),
  maxRequestExcludeIds: parseIntEnv('RECO_MAX_REQUEST_EXCLUDE_IDS', 2000, { min: 100, max: 10000 }),
  sessionTtlSeconds: parseIntEnv('RECO_SESSION_TTL_SECONDS', 3600, { min: 60 }),
  sessionMaxTrackIds: parseIntEnv('RECO_SESSION_MAX_TRACK_IDS', 5000, { min: 100, max: 20000 }),
  sessionBootstrapTarget: parseIntEnv('RECO_SESSION_BOOTSTRAP_TARGET', 1000, { min: 100, max: 20000 }),
  likeBoostCount: parseIntEnv('RECO_LIKE_BOOST_COUNT', 5, { min: 1, max: 20 }),

  contextEnabled: parseBoolEnv('RECO_CONTEXT_ENABLED', true),
  contextRecentTracks: parseIntEnv('RECO_CONTEXT_RECENT_TRACKS', 3, { min: 1, max: 10 }),
  contextMinHistoryTracks: parseIntEnv('RECO_CONTEXT_MIN_HISTORY_TRACKS', 3, { min: 1, max: 10 }),
  contextRerankWindow: parseIntEnv('RECO_CONTEXT_RERANK_WINDOW', 500, { min: 50, max: 5000 }),

  infiniteRefillEnabled: parseBoolEnv('RECO_INFINITE_REFILL_ENABLED', true),
  infiniteRefillMinRemaining: parseIntEnv('RECO_INFINITE_REFILL_MIN_REMAINING', 200, { min: 20, max: 5000 }),
  infiniteRefillTargetAdd: parseIntEnv('RECO_INFINITE_REFILL_TARGET_ADD', 1000, { min: 50, max: 20000 }),
  infiniteWrapEnabled: parseBoolEnv('RECO_INFINITE_WRAP_ENABLED', true),

  smartSamplingEnabled: parseBoolEnv('RECO_SMART_SAMPLING_ENABLED', true),
  smartSamplingGoldenTopSize: parseIntEnv('RECO_SMART_SAMPLING_GOLDEN_TOP_SIZE', 5, { min: 0, max: 20 }),
  smartSamplingPoolSize: parseIntEnv('RECO_SMART_SAMPLING_POOL_SIZE', 500, { min: 50, max: 5000 }),
  smartSamplingTopSize: parseIntEnv('RECO_SMART_SAMPLING_TOP_SIZE', 60, { min: 10, max: 2000 }),
  smartSamplingMidSize: parseIntEnv('RECO_SMART_SAMPLING_MID_SIZE', 180, { min: 0, max: 5000 }),
  smartSamplingTopWeight: parseFloatEnv('RECO_SMART_SAMPLING_TOP_WEIGHT', 0.7, { min: 0, max: 1 }),
  smartSamplingMidWeight: parseFloatEnv('RECO_SMART_SAMPLING_MID_WEIGHT', 0.25, { min: 0, max: 1 }),
  smartSamplingLongWeight: parseFloatEnv('RECO_SMART_SAMPLING_LONG_WEIGHT', 0.05, { min: 0, max: 1 }),
  tasteMaxClusters: parseIntEnv('RECO_TASTE_MAX_CLUSTERS', 5, { min: 1, max: 5 }),
  tasteNewClusterDistThreshold: parseFloatEnv('RECO_TASTE_NEW_CLUSTER_DIST_THRESHOLD', 0.25, { min: 0.05, max: 1 }),
  realtimeRecentTtlSeconds: parseIntEnv('RECO_REALTIME_RECENT_TTL_SECONDS', 172800, { min: 60, max: 604800 }),
  realtimeSkipTtlSeconds: parseIntEnv('RECO_REALTIME_SKIP_TTL_SECONDS', 172800, { min: 60, max: 604800 }),
  realtimeDislikeTtlSeconds: parseIntEnv('RECO_REALTIME_DISLIKE_TTL_SECONDS', 2592000, { min: 60, max: 31536000 }),
  dailySeenTtlSeconds: parseIntEnv('RECO_DAILY_SEEN_TTL_SECONDS', 172800, { min: 60, max: 604800 }),
  dailySeenMaxCheck: parseIntEnv('RECO_DAILY_SEEN_MAX_CHECK', 5000, { min: 100, max: 20000 }),
});

// ============================================
// Feedback Worker
// ============================================

const feedbackWorker = Object.freeze({
  batchSize: parseIntEnv('RECO_FEEDBACK_BATCH_SIZE', 200, { min: 1, max: 1000 }),
  blockTimeoutMs: parseIntEnv('RECO_FEEDBACK_BLOCK_TIMEOUT_MS', 5000, { min: 1000 }),
  maxRetries: parseIntEnv('RECO_FEEDBACK_MAX_RETRIES', 5, { min: 1 }),
  retryDelayMs: parseIntEnv('RECO_FEEDBACK_RETRY_DELAY_MS', 1000, { min: 100 }),
  shutdownTimeoutMs: parseIntEnv('RECO_FEEDBACK_SHUTDOWN_TIMEOUT_MS', 30000, { min: 5000 }),
  consumerName: parseStringEnv('RECO_FEEDBACK_CONSUMER_NAME', `worker-${process.pid}`),
});

// ============================================
// Offline Worker (Node.js версия)
// ============================================

const offlineWorker = Object.freeze({
  // Уменьшено с 1 часа до 15 минут для более быстрого обновления рекомендаций
  runIntervalMs: parseIntEnv('RECO_OFFLINE_RUN_INTERVAL_MS', 900000, { min: 60000 }),
  topN: parseIntEnv('RECO_OFFLINE_TOP_N', 1000, { min: 100, max: 10000 }),
  userVectorFallbackLimit: parseIntEnv('RECO_USER_VECTOR_FALLBACK_LIMIT', 200, { min: 10, max: 2000 }),
  // Уменьшено с 3 до 1 - персонализация начинается сразу после первого прослушивания
  minUserHistory: parseIntEnv('RECO_OFFLINE_MIN_USER_HISTORY', 1, { min: 1 }),
  redisTtlSeconds: parseIntEnv('RECO_OFFLINE_REDIS_TTL_SECONDS', 7200, { min: 60 }),
  lockTtlSeconds: parseIntEnv('RECO_OFFLINE_LOCK_TTL_SECONDS', 600, { min: 60 }),
  maxSongRows: parseIntEnv('RECO_OFFLINE_MAX_SONG_ROWS', 500000, { min: 1000 }),
  maxHistoryRows: parseIntEnv('RECO_OFFLINE_MAX_HISTORY_ROWS', 2000000, { min: 1000 }),
  chunkSize: parseIntEnv('RECO_OFFLINE_CHUNK_SIZE', 50000, { min: 1000 }),

  // Ограничение по времени для user_history (в месяцах)
  // Ускоряет запросы и фокусируется на свежих предпочтениях
  historyLimitMonths: parseIntEnv('RECO_OFFLINE_HISTORY_LIMIT_MONTHS', 12, { min: 1, max: 60 }),

  recentExcludeDays: parseIntEnv('RECO_OFFLINE_RECENT_EXCLUDE_DAYS', 30, { min: 1, max: 365 }),

  globalTopMaxPerArtist: parseIntEnv('RECO_OFFLINE_GLOBAL_TOP_MAX_PER_ARTIST', 0, { min: 0, max: 100 }),

  tasteRecomputeMonths: parseIntEnv('RECO_TASTE_RECOMPUTE_MONTHS', 12, { min: 1, max: 60 }),
  tasteRecomputeMaxTracksPerUser: parseIntEnv('RECO_TASTE_RECOMPUTE_MAX_TRACKS_PER_USER', 500, { min: 50, max: 5000 }),

  // Размер батча пользователей для параллельной обработки
  // Большие значения = быстрее, но больше RAM
  userBatchSize: parseIntEnv('RECO_OFFLINE_USER_BATCH_SIZE', 100, { min: 10, max: 1000 }),

  // Частота логирования прогресса (каждые N пользователей)
  logProgressEvery: parseIntEnv('RECO_OFFLINE_LOG_PROGRESS_EVERY', 500, { min: 50, max: 10000 }),

  // Веса для расчёта базового скора (настраиваемые через env для A/B тестов)
  weights: Object.freeze({
    popularity: parseFloatEnv('RECO_WEIGHT_POPULARITY', 0.05, { min: 0, max: 1 }),
    playCount: parseFloatEnv('RECO_WEIGHT_PLAY_COUNT', 0.05, { min: 0, max: 1 }),
    userPlayCount: parseFloatEnv('RECO_WEIGHT_USER_PLAY_COUNT', 0.1, { min: 0, max: 1 }),
    userLikeCount: parseFloatEnv('RECO_WEIGHT_USER_LIKE_COUNT', 0.15, { min: 0, max: 1 }),
    userSkipCount: parseFloatEnv('RECO_WEIGHT_USER_SKIP_COUNT', -0.4, { min: -1, max: 0 }),
  }),

  // Веса для персонализации пользователя (настраиваемые через env)
  personalizationWeights: Object.freeze({
    artistPreference: parseFloatEnv('RECO_WEIGHT_ARTIST_PREF', 0.15, { min: 0, max: 2 }),
    genrePreference: parseFloatEnv('RECO_WEIGHT_GENRE_PREF', 0.15, { min: 0, max: 2 }),
  }),

  shardCount: parseIntEnv('RECO_OFFLINE_SHARD_COUNT', 1, { min: 1, max: 512 }),
  shardIndex: parseIntEnv('RECO_OFFLINE_SHARD_INDEX', 0, { min: 0, max: 511 }),
  useCachedGlobalTop: parseBoolEnv('RECO_OFFLINE_USE_CACHED_GLOBAL_TOP', false),
});

if (offlineWorker.shardIndex >= offlineWorker.shardCount) {
  throw new Error(`Environment variable RECO_OFFLINE_SHARD_INDEX must be < RECO_OFFLINE_SHARD_COUNT, got ${offlineWorker.shardIndex} / ${offlineWorker.shardCount}`);
}

// ============================================
// Rate Limiting
// ============================================

const rateLimitMultiplier = parseRateLimitMultiplier();

const rateLimiting = Object.freeze({
  windowMs: parseIntEnv('RECO_RATE_LIMIT_WINDOW_MS', 60000, { min: 1000 }),
  maxRequests: isProduction
    ? parseIntEnv('RECO_RATE_LIMIT_MAX', 500, { min: 10 }) * rateLimitMultiplier
    : parseIntEnv('RECO_RATE_LIMIT_MAX_DEV', 5000, { min: 10 }) * rateLimitMultiplier,
  feedbackPerUser: parseIntEnv('RECO_RATE_LIMIT_FEEDBACK_PER_USER', 500, { min: 10 }) * rateLimitMultiplier,
  apiPerUser: parseIntEnv('RECO_RATE_LIMIT_API_PER_USER', 500, { min: 10 }) * rateLimitMultiplier,
  refreshPerUser: parseIntEnv('RECO_RATE_LIMIT_REFRESH_PER_USER', 2000, { min: 50 }) * rateLimitMultiplier,
  sessionsPerUserPerHour: Math.min(parseIntEnv('RECO_RATE_LIMIT_SESSIONS_PER_HOUR', 50, { min: 1, max: 200 }) * rateLimitMultiplier, 10000),
  useRedisStore: parseBoolEnv('RECO_RATE_LIMIT_USE_REDIS', isProduction),
});

// ============================================
// Аутентификация
// ============================================

const auth = Object.freeze({
  serviceUrl: parseStringEnv('AUTH_SERVICE_URL', 'http://auth-service:3001'),
  timeoutMs: parseIntEnv('RECO_AUTH_TIMEOUT_MS', 2000, { min: 500, max: 10000 }),
});

// ============================================
// CORS
// ============================================

const cors = Object.freeze({
  allowedOrigins: parseListEnv('RECO_ALLOWED_ORIGINS', []),
  allowEmptyInDev: !isProduction,
});

const engine = 'v2';

const engineV2 = Object.freeze({
  rankingServiceUrl: parseStringEnv('RECO_RANKING_SERVICE_URL', ''),
  rankingTimeoutMs: parseIntEnv('RECO_RANKING_TIMEOUT_MS', 150, { min: 10, max: 5000 }),
  sessionTtlSeconds: parseIntEnv('RECO_V2_SESSION_TTL_SECONDS', 3600, { min: 60, max: 86400 }),
  maxCandidates: parseIntEnv('RECO_V2_MAX_CANDIDATES', 800, { min: 100, max: 5000 }),
  exactTasteRatio: parseFloatEnv('RECO_V2_EXACT_TASTE_RATIO', 0.55, { min: 0, max: 1 }),
  nearTasteRatio: parseFloatEnv('RECO_V2_NEAR_TASTE_RATIO', 0.25, { min: 0, max: 1 }),
  discoveryRatio: parseFloatEnv('RECO_V2_DISCOVERY_RATIO', 0.20, { min: 0, max: 1 }),

  vectorRecentTracks: parseIntEnv('RECO_V2_VECTOR_RECENT_TRACKS', 3, { min: 1, max: 10 }),
  vectorLimit: parseIntEnv('RECO_V2_VECTOR_LIMIT', 120, { min: 10, max: 1000 }),

  onlineIntentEnabled: parseBoolEnv('RECO_V2_ONLINE_INTENT_ENABLED', true),
  onlineIntentLimit: parseIntEnv('RECO_V2_ONLINE_INTENT_LIMIT', 240, { min: 10, max: 1000 }),
  onlineIntentMaxAnchors: parseIntEnv('RECO_V2_ONLINE_INTENT_MAX_ANCHORS', 36, { min: 2, max: 100 }),
  onlineIntentNegativePenalty: parseFloatEnv('RECO_V2_ONLINE_INTENT_NEGATIVE_PENALTY', 1.45, { min: 0, max: 5 }),
  onlineIntentLikeWeight: parseFloatEnv('RECO_V2_ONLINE_INTENT_LIKE_WEIGHT', 4, { min: 0, max: 20 }),
  onlineIntentCompleteWeight: parseFloatEnv('RECO_V2_ONLINE_INTENT_COMPLETE_WEIGHT', 3.25, { min: 0, max: 20 }),
  onlineIntentLongPlayWeight: parseFloatEnv('RECO_V2_ONLINE_INTENT_LONG_PLAY_WEIGHT', 1.5, { min: 0, max: 20 }),
  onlineIntentDislikeWeight: parseFloatEnv('RECO_V2_ONLINE_INTENT_DISLIKE_WEIGHT', 6, { min: 0, max: 20 }),
  onlineIntentShortSkipWeight: parseFloatEnv('RECO_V2_ONLINE_INTENT_SHORT_SKIP_WEIGHT', 3.5, { min: 0, max: 20 }),
  onlineIntentLateSkipWeight: parseFloatEnv('RECO_V2_ONLINE_INTENT_LATE_SKIP_WEIGHT', 0.75, { min: 0, max: 20 }),
  onlineIntentPositivePlayMinSeconds: parseIntEnv('RECO_V2_ONLINE_INTENT_POSITIVE_PLAY_MIN_SECONDS', 35, { min: 1, max: 3600 }),
  onlineIntentPositivePlayMinProgress: parseFloatEnv('RECO_V2_ONLINE_INTENT_POSITIVE_PLAY_MIN_PROGRESS', 0.55, { min: 0, max: 1 }),
  onlineIntentLateSkipMinProgress: parseFloatEnv('RECO_V2_ONLINE_INTENT_LATE_SKIP_MIN_PROGRESS', 0.65, { min: 0, max: 1 }),

  momentumEnabled: parseBoolEnv('RECO_V2_MOMENTUM_ENABLED', true),
  momentumLimit: parseIntEnv('RECO_V2_MOMENTUM_LIMIT', 80, { min: 10, max: 1000 }),

  sideStepEnabled: parseBoolEnv('RECO_V2_SIDESTEP_ENABLED', true),
  sideStepLimit: parseIntEnv('RECO_V2_SIDESTEP_LIMIT', 60, { min: 10, max: 1000 }),
  sideStepMinCos: parseFloatEnv('RECO_V2_SIDESTEP_MIN_COS', 0.5, { min: 0, max: 1 }),
  sideStepMaxCos: parseFloatEnv('RECO_V2_SIDESTEP_MAX_COS', 0.62, { min: 0, max: 1 }),
  sideStepTargetCos: parseFloatEnv('RECO_V2_SIDESTEP_TARGET_COS', 0.56, { min: 0, max: 1 }),

  repulsionEnabled: parseBoolEnv('RECO_V2_REPULSION_ENABLED', true),
  repulsionLimit: parseIntEnv('RECO_V2_REPULSION_LIMIT', 80, { min: 10, max: 1000 }),
  repulsionHistoryTracks: parseIntEnv('RECO_V2_REPULSION_HISTORY_TRACKS', 8, { min: 2, max: 10 }),
  repulsionPenalty: parseFloatEnv('RECO_V2_REPULSION_PENALTY', 1.5, { min: 0, max: 10 }),

  collabNeighborLimit: parseIntEnv('RECO_V2_COLLAB_NEIGHBOR_LIMIT', 60, { min: 5, max: 200 }),
  collabLimit: parseIntEnv('RECO_V2_COLLAB_LIMIT', 120, { min: 10, max: 1000 }),

  contextLimit: parseIntEnv('RECO_V2_CONTEXT_LIMIT', 80, { min: 10, max: 1000 }),
  contextMaxEnergy: parseFloatEnv('RECO_V2_CONTEXT_MAX_ENERGY', 0.35, { min: 0, max: 1 }),

  explorationLimit: parseIntEnv('RECO_V2_EXPLORATION_LIMIT', 320, { min: 10, max: 1000 }),

  recentExcludeDays: parseIntEnv('RECO_V2_RECENT_EXCLUDE_DAYS', 14, { min: 1, max: 365 }),

  genreAffinityEnabled: parseBoolEnv('RECO_V2_GENRE_AFFINITY_ENABLED', true),
  genreAffinityLimit: parseIntEnv('RECO_V2_GENRE_AFFINITY_LIMIT', 200, { min: 10, max: 800 }),
  genreAffinityTopGenres: parseIntEnv('RECO_V2_GENRE_AFFINITY_TOP_GENRES', 5, { min: 1, max: 10 }),
  genreAffinityHistoryDays: parseIntEnv('RECO_V2_GENRE_AFFINITY_HISTORY_DAYS', 90, { min: 7, max: 365 }),

  artistAffinityEnabled: parseBoolEnv('RECO_V2_ARTIST_AFFINITY_ENABLED', true),
  artistAffinityLimit: parseIntEnv('RECO_V2_ARTIST_AFFINITY_LIMIT', 120, { min: 10, max: 500 }),
  artistAffinityTopArtists: parseIntEnv('RECO_V2_ARTIST_AFFINITY_TOP_ARTISTS', 8, { min: 1, max: 20 }),

  similarArtistEnabled: parseBoolEnv('RECO_V2_SIMILAR_ARTIST_ENABLED', true),
  similarArtistLimit: parseIntEnv('RECO_V2_SIMILAR_ARTIST_LIMIT', 80, { min: 10, max: 300 }),
  similarArtistTopArtists: parseIntEnv('RECO_V2_SIMILAR_ARTIST_TOP_ARTISTS', 6, { min: 1, max: 15 }),

  skipBurstThreshold: parseIntEnv('RECO_V2_SKIP_BURST_THRESHOLD', 3, { min: 1, max: 20 }),
  skipBurstWindowSeconds: parseIntEnv('RECO_V2_SKIP_BURST_WINDOW_SECONDS', 300, { min: 60, max: 3600 }),

  seenTtlSeconds: parseIntEnv('RECO_V2_SEEN_TTL_SECONDS', 172800, { min: 60, max: 604800 }),
  bloomBits: parseIntEnv('RECO_V2_BLOOM_BITS', 4194304, { min: 262144, max: 33554432 }),
  bloomHashes: parseIntEnv('RECO_V2_BLOOM_HASHES', 7, { min: 2, max: 12 }),

  timezoneOffsetMinutes: parseIntEnv('RECO_V2_TIMEZONE_OFFSET_MINUTES', 0, { min: -720, max: 840 }),
});

const debug = Object.freeze({
  recoDebugKey: parseStringEnv('RECO_DEBUG_KEY', ''),
  diagnosticsEnabled: parseBoolEnv('RECO_DIAGNOSTICS_ENABLED', false),
});

const internal = Object.freeze({
  serviceToken: parseStringEnv(
    'RECO_INTERNAL_SERVICE_TOKEN',
    parseStringEnv('INTERNAL_SERVICE_TOKEN', '')
  ),
});

const home = Object.freeze({
  cacheTtlSeconds: parseIntEnv('RECO_HOME_CACHE_TTL_SECONDS', 60, { min: 5, max: 600 }),
  maxPlaylists: parseIntEnv('RECO_HOME_MAX_PLAYLISTS', 8, { min: 3, max: 20 }),
  tracksPerPlaylist: parseIntEnv('RECO_HOME_TRACKS_PER_PLAYLIST', 20, { min: 5, max: 50 }),
  candidateLimit: parseIntEnv('RECO_HOME_CANDIDATE_LIMIT', 360, { min: 80, max: 2000 }),
});

// ============================================
// Feedback (валидация)
// ============================================

const feedback = Object.freeze({
  maxInteractionsPerBatch: parseIntEnv('RECO_MAX_FEEDBACK_INTERACTIONS', 500, { min: 10, max: 2000 }),
  allowedActions: Object.freeze(['play', 'pause', 'skip', 'complete', 'like', 'dislike', 'seek']),
  maxDurationMs: parseIntEnv('RECO_MAX_DURATION_MS', 86400000, { min: 1000 }), // 24 часа
  userEmbeddingAlpha: parseFloatEnv('RECO_USER_EMBEDDING_ALPHA', 0.05, { min: 0.001, max: 0.5 }),
  implicitUserEmbeddingAlpha: parseFloatEnv('RECO_IMPLICIT_USER_EMBEDDING_ALPHA', 0.01, { min: 0.0001, max: 0.2 }),
  implicitMinPlaySeconds: parseIntEnv('RECO_IMPLICIT_MIN_PLAY_SECONDS', 30, { min: 1, max: 3600 }),
  dislikeUserEmbeddingAlpha: parseFloatEnv('RECO_DISLIKE_USER_EMBEDDING_ALPHA', 0.01, { min: 0.0001, max: 0.2 }),
});

// ============================================
// Логирование
// ============================================

const logging = Object.freeze({
  level: parseStringEnv('LOG_LEVEL', isProduction ? 'info' : 'debug', {
    allowedValues: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'],
  }),
  prettyPrint: parseBoolEnv('LOG_PRETTY_PRINT', isDevelopment),
});

// ============================================
// Метрики
// ============================================

const metrics = Object.freeze({
  prefix: parseStringEnv('RECO_METRICS_PREFIX', 'reco_'),
  enabled: parseBoolEnv('RECO_METRICS_ENABLED', true),
});

// ============================================
// Кэширование
// ============================================

const cache = Object.freeze({
  tracksTtlMs: parseIntEnv('RECO_CACHE_TRACKS_TTL_MS', 300000, { min: 10000 }), // 5 минут (увеличено)
  tracksMaxSize: parseIntEnv('RECO_CACHE_TRACKS_MAX_SIZE', 20000, { min: 100 }), // 20k треков (увеличено)
  redisTtlSeconds: parseIntEnv('RECO_CACHE_REDIS_TTL_SECONDS', 300, { min: 60 }), // 5 минут Redis
  warmupCount: parseIntEnv('RECO_CACHE_WARMUP_COUNT', 100, { min: 10, max: 500 }), // Кол-во треков для прогрева
});

// ============================================
// Оптимизация Latency
// ============================================

const performance = Object.freeze({
  // Таймауты для внешних сервисов (меньше = быстрее fail)
  externalTimeoutMs: parseIntEnv('RECO_EXTERNAL_TIMEOUT_MS', 2000, { min: 500, max: 10000 }),

  // Keep-Alive настройки HTTP сервера
  keepAliveTimeoutMs: parseIntEnv('RECO_KEEP_ALIVE_TIMEOUT_MS', 65000, { min: 30000 }),

  // Максимальный размер батча для параллельной обработки
  maxParallelBatchSize: parseIntEnv('RECO_MAX_PARALLEL_BATCH', 50, { min: 10, max: 200 }),

  // Включить сжатие ответов
  compressionEnabled: parseBoolEnv('RECO_COMPRESSION_ENABLED', true),
  compressionThreshold: parseIntEnv('RECO_COMPRESSION_THRESHOLD', 1024, { min: 256 }),
});

// ============================================
// Экспорт конфигурации
// ============================================

const config = Object.freeze({
  env: NODE_ENV,
  isProduction,
  isDevelopment,
  isTest,

  engine,
  engineV2,

  server,
  db,
  redis,
  redisKeys,
  recommendations,
  feedback,
  feedbackWorker,
  offlineWorker,
  rateLimiting,
  auth,
  cors,
  debug,
  internal,
  home,
  logging,
  metrics,
  cache,
  performance,
});

module.exports = config;
