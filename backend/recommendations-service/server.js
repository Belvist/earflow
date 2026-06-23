/**
 * Recommendations Service - HTTP Server
 * Express сервер для API рекомендаций
 * @module server
 */

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const compression = require('compression');

const config = require('./config');
const { createLogger, logError, logEvent, requestLogger } = require('./lib/logger');
const { checkConnection: checkDb, close: closeDb } = require('./lib/database');
const redis = require('./lib/redis');
const { authenticateUser } = require('./middleware/auth');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const healthRoutes = require('./routes/health');
const recommendationsRoutes = require('./routes/recommendations');
const { applyCorsHeaders } = require('./lib/corsHeaders');
const { metricsMiddleware } = require('./metrics');

const logger = createLogger('server');

// ============================================
// Express App Setup
// ============================================

const app = express();
app.set('trust proxy', config.server.trustProxy ? 1 : 0);

// ============================================
// CORS Configuration
// ============================================

const corsOptions = {
  origin(origin, callback) {
    // Запросы без origin (например, от серверов)
    if (!origin) {
      callback(null, true);
      return;
    }

    // Проверяем whitelist
    if (config.cors.allowedOrigins.length > 0 && config.cors.allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    // В development разрешаем всё при пустом whitelist
    if (config.cors.allowEmptyInDev && config.cors.allowedOrigins.length === 0) {
      callback(null, true);
      return;
    }

    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Correlation-ID', 'X-Reco-Debug-Key'],
  credentials: true,
  maxAge: 86400, // 24 hours
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// ============================================
// Security Headers
// ============================================

app.use(helmet({
  contentSecurityPolicy: config.isProduction ? undefined : false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-site' },
  hsts: config.isProduction ? {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  } : false,
}));

// ============================================
// Response Compression (для минимальной latency)
// ============================================

if (config.performance.compressionEnabled) {
  app.use(compression({
    // Сжимать только ответы больше threshold
    threshold: config.performance.compressionThreshold,
    // Уровень сжатия (6 = баланс скорости и размера)
    level: 6,
    // Не сжимать если клиент не поддерживает
    filter: (req, res) => {
      if (req.headers['x-no-compression']) {
        return false;
      }
      return compression.filter(req, res);
    },
  }));
}

// ============================================
// Body Parsing
// ============================================

app.use(express.json({ limit: '32kb' }));

// ============================================
// Rate Limiting
// ============================================

let rateLimitStore;

// Используем Redis store в production для распределённого rate limiting
if (config.rateLimiting.useRedisStore) {
  try {
    const RedisStore = require('rate-limit-redis').default;
    rateLimitStore = new RedisStore({
      sendCommand: async (...args) => {
        const client = await redis.getClient();
        return client.sendCommand(args);
      },
      prefix: `${config.redisKeys.prefix}ratelimit:`,
    });
    logger.info('Using Redis store for rate limiting');
  } catch (err) {
    logError(err, 'redis-rate-limit-store');
    logger.warn('Falling back to memory store for rate limiting');
  }
}

// Кастомный handler для добавления CORS headers к ответам rate limiter
const rateLimitHandler = (req, res) => {
  applyCorsHeaders(req, res);
  res.status(429).json({
    error: 'Too many requests, please slow down',
    retryAfter: Math.ceil(config.rateLimiting.windowMs / 1000)
  });
};

const globalLimiter = rateLimit({
  windowMs: config.rateLimiting.windowMs,
  max: config.rateLimiting.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: (req) => req.path.startsWith('/health') || req.path === '/metrics',
  store: rateLimitStore,
});

app.use(globalLimiter);

// ============================================
// Logging & Metrics Middleware
// ============================================

app.use(requestLogger());
app.use(metricsMiddleware);

// ============================================
// Routes
// ============================================

// Health & Metrics (без аутентификации)
app.use('/', healthRoutes);

// Health & Metrics via API Gateway prefix (без аутентификации)
app.use('/api/recommendations', healthRoutes);

// API Routes (с аутентификацией)
app.use('/api/recommendations', authenticateUser, recommendationsRoutes);

// 404 Handler
app.use(notFoundHandler);

// Error Handler
app.use(errorHandler);

// ============================================
// Global Error Handlers
// ============================================

process.on('unhandledRejection', (reason, promise) => {
  logger.fatal({ reason, promise }, 'Unhandled Promise Rejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught Exception');
  process.exit(1);
});

// ============================================
// Graceful Shutdown
// ============================================

let server;

async function shutdown(signal) {
  logger.info({ signal }, 'Initiating graceful shutdown...');

  // Перестаём принимать новые соединения
  if (server) {
    server.close((err) => {
      if (err) {
        logError(err, 'server-close');
      } else {
        logger.info('HTTP server closed');
      }
    });
  }

  // Даём время на завершение текущих запросов
  await new Promise((resolve) => setTimeout(resolve, 5000));

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

  logger.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ============================================
// Bootstrap
// ============================================

async function bootstrap() {
  logger.info({
    port: config.server.port,
    env: config.env,
  }, 'Starting recommendations-service...');

  // Проверяем PostgreSQL
  const dbOk = await checkDb();
  if (!dbOk) {
    logger.fatal('Failed to connect to PostgreSQL');
    process.exit(1);
  }
  logger.info('PostgreSQL connected');

  // Подключаемся к Redis
  try {
    await redis.connect();
    logger.info('Redis connected');

  } catch (err) {
    logError(err, 'redis-connect');
    // Redis не критичен, можем работать в degraded mode
    logger.warn('Running in degraded mode without Redis');
  }

  // Запускаем HTTP сервер с оптимизациями
  server = app.listen(config.server.port, () => {
    logger.info({ port: config.server.port }, 'HTTP server started');
    logEvent('server-started', {
      port: config.server.port,
      env: config.env,
    });
  });

  // Оптимизация Keep-Alive для минимальной latency
  server.keepAliveTimeout = config.performance.keepAliveTimeoutMs;
  server.headersTimeout = config.performance.keepAliveTimeoutMs + 1000;

  server.on('error', (err) => {
    logError(err, 'server-error');
    process.exit(1);
  });
}

bootstrap().catch((err) => {
  logError(err, 'bootstrap');
  process.exit(1);
});

module.exports = app;
