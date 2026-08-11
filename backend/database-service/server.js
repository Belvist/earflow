const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

function sanitizeUrlForLogs(rawUrl) {
  try {
    const url = new URL(rawUrl, 'http://localhost');
    for (const key of [...url.searchParams.keys()]) {
      const lower = key.toLowerCase();
      if (lower === 'token' || lower.includes('token') || lower.includes('authorization') || lower.includes('password') || lower.includes('secret')) {
        url.searchParams.set(key, '[REDACTED]');
      }
    }
    return url.pathname + (url.search ? url.search : '');
  } catch {
    return String(rawUrl || '').replace(/([?&]token=)[^&]+/gi, '$1[REDACTED]');
  }
}

const isProduction = process.env.NODE_ENV === 'production';

const db = require('./database/db');
const { authenticateService, generateServiceToken, ALLOWED_SERVICES } = require('./middleware/auth');
const usersRouter = require('./routes/users');
const songsRouter = require('./routes/songs');
const listensRouter = require('./routes/listens');
const likesRouter = require('./routes/likes');
const dislikesRouter = require('./routes/dislikes');
const eqRouter = require('./routes/eq');
const songFeaturesRouter = require('./routes/songFeatures');
const socialRouter = require('./routes/social');

const app = express();
const PORT = process.env.PORT || 3003;
const SERVICE_JWT_PRIVATE_KEY = process.env.SERVICE_JWT_PRIVATE_KEY;
const SERVICE_JWT_PRIVATE_KEY_B64 = process.env.SERVICE_JWT_PRIVATE_KEY_B64;
const SERVICE_JWT_PUBLIC_KEY = process.env.SERVICE_JWT_PUBLIC_KEY;
const SERVICE_JWT_PUBLIC_KEY_B64 = process.env.SERVICE_JWT_PUBLIC_KEY_B64;

// ============================================================================
// CONFIGURATION VALIDATION
// ============================================================================
if ((!SERVICE_JWT_PRIVATE_KEY && !SERVICE_JWT_PRIVATE_KEY_B64) || (!SERVICE_JWT_PUBLIC_KEY && !SERVICE_JWT_PUBLIC_KEY_B64)) {
  console.error('FATAL: SERVICE_JWT_PRIVATE_KEY(_B64) and SERVICE_JWT_PUBLIC_KEY(_B64) must be set');
  process.exit(1);
}

function getServiceKeyFor(serviceName) {
  const envKey = `SERVICE_KEY_${String(serviceName || '').toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`;
  return process.env[envKey] || null;
}

// ============================================================================
// SECURITY & MIDDLEWARE
// ============================================================================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    }
  },
  crossOriginEmbedderPolicy: true,
  crossOriginOpenerPolicy: true,
  crossOriginResourcePolicy: { policy: "same-site" },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

app.use(express.json({ limit: '64kb' }));

// Request logging
const morganFormat = isProduction
  ? ':remote-addr - :method :url :status :response-time ms'
  : 'dev';
morgan.token('safe-url', (req) => sanitizeUrlForLogs(req.originalUrl || req.url));
const effectiveMorganFormat = isProduction
  ? ':remote-addr - :method :safe-url :status :response-time ms'
  : 'dev';
app.use(morgan(effectiveMorganFormat, {
  skip: (req) => req.path === '/health'
}));

// ============================================================================
// RATE LIMITING (Service-to-Service communication has higher limits)
// ============================================================================
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 500, // 500 requests per minute (service-to-service)
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
  skip: (req) => {
    // Skip rate limiting for authenticated services
    return !!req.service;
  }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 token requests per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts' }
});

// Health check (без аутентификации)
app.get('/health', async (req, res) => {
  try {
    const dbConnected = await db.checkConnection();
    const health = {
      status: dbConnected ? 'healthy' : 'degraded',
      service: 'database-service',
      database: dbConnected ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    };

    if (req.query.detailed === 'true') {
      health.memory = process.memoryUsage();
      health.poolStats = db.getPoolStats ? await db.getPoolStats() : null;
    }

    res.json(health);
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      service: 'database-service',
      error: isProduction ? 'Database connection failed' : error.message
    });
  }
});

// Metrics endpoint
app.get('/metrics', async (req, res) => {
  try {
    const dbConnected = await db.checkConnection();
    res.json({
      uptime_seconds: process.uptime(),
      memory_heap_used_bytes: process.memoryUsage().heapUsed,
      memory_rss_bytes: process.memoryUsage().rss,
      database_connected: dbConnected ? 1 : 0,
      node_version: process.version
    });
  } catch {
    res.status(500).json({ error: 'Failed to get metrics' });
  }
});

/**
 * POST /auth/service-token
 * Получение токена для сервиса
 */
app.post('/auth/service-token', authLimiter, async (req, res) => {
  try {
    const { serviceName, serviceKey, audience } = req.body;

    // Логируем только в development
    if (!isProduction) {
      console.log('🔑 Service token request:', serviceName);
    }

    if (!serviceName || !serviceKey) {
      return res.status(400).json({
        error: 'Необходимо указать serviceName и serviceKey'
      });
    }

    const allowedAudiences = process.env.SERVICE_TOKEN_ALLOWED_AUDIENCES
      ? process.env.SERVICE_TOKEN_ALLOWED_AUDIENCES.split(',').map(s => s.trim()).filter(Boolean)
      : ['database-service', 'playlist-service', 'upload-service', 'lyrics-service', 'api-gateway', 'auth-service', 'track-processor', 'recommendations-service', 'audio-features-worker'];

    const requestedAudience = audience ? String(audience).trim() : null;
    if (requestedAudience && !allowedAudiences.includes(requestedAudience)) {
      return res.status(400).json({ error: 'Недопустимая аудитория токена' });
    }

    // Проверяем, что сервис в списке разрешенных
    if (!ALLOWED_SERVICES.includes(serviceName)) {
      console.warn(`⚠️ Unauthorized service attempt: ${serviceName}`);
      return res.status(403).json({
        error: 'Сервис не авторизован'
      });
    }

    const expectedKey = getServiceKeyFor(serviceName);
    if (!expectedKey) {
      console.error(`FATAL: Missing ${`SERVICE_KEY_${String(serviceName || '').toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`} for issuing service tokens`);
      return res.status(500).json({ error: 'Service auth misconfigured' });
    }

    // Проверяем serviceKey (безопасное сравнение)
    const crypto = require('crypto');
    const keyBuffer = Buffer.from(String(serviceKey || ''));
    const secretBuffer = Buffer.from(String(expectedKey));

    if (keyBuffer.length !== secretBuffer.length ||
      !crypto.timingSafeEqual(keyBuffer, secretBuffer)) {
      return res.status(401).json({
        error: 'Недействительный ключ сервиса'
      });
    }

    // Создаем запись в БД о сессии
    const tokenId = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 часа

    await db.query(
      `INSERT INTO service_sessions (service_name, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [serviceName, tokenId, expiresAt]
    );

    // Генерируем токен
    const token = generateServiceToken(serviceName, tokenId, requestedAudience);

    if (!isProduction) {
      console.log(`✅ Token issued for: ${serviceName}`);
    }

    res.json({
      token,
      expiresAt: expiresAt.toISOString(),
      serviceName
    });
  } catch (error) {
    console.error('❌ Token generation error:', error.message);
    res.status(500).json({ error: 'Ошибка аутентификации' });
  }
});

// Применяем аутентификацию и rate limiting ко всем API роутам
app.use('/api', authenticateService, apiLimiter);

// API роуты
app.use('/api/users', usersRouter);
app.use('/api/songs', songsRouter);
app.use('/api/song-features', songFeaturesRouter);
app.use('/api/listens', listensRouter);
app.use('/api/likes', likesRouter);
app.use('/api/dislikes', dislikesRouter);
app.use('/api/eq', eqRouter);
app.use('/api/social', socialRouter);

/**
 * GET /api/stats
 * Статистика использования API
 */
app.get('/api/stats', async (req, res) => {
  try {
    const userCount = await db.query('SELECT COUNT(*) as count FROM users');
    const songCount = await db.query('SELECT COUNT(*) as count FROM songs');
    const playlistCount = await db.query('SELECT COUNT(*) as count FROM playlists');
    const activeSessionsCount = await db.query(
      'SELECT COUNT(*) as count FROM service_sessions WHERE expires_at > NOW()'
    );

    res.json({
      users: parseInt(userCount.rows[0].count),
      songs: parseInt(songCount.rows[0].count),
      playlists: parseInt(playlistCount.rows[0].count),
      activeSessions: parseInt(activeSessionsCount.rows[0].count),
      service: req.service.name
    });
  } catch (error) {
    console.error('❌ Ошибка получения статистики:', error);
    res.status(500).json({ error: 'Ошибка получения статистики' });
  }
});

/**
 * DELETE /api/cleanup-sessions
 * Очистка истекших сессий
 */
app.delete('/api/cleanup-sessions', async (req, res) => {
  try {
    await db.cleanupOldSessions();
    res.json({ message: 'Сессии очищены' });
  } catch (error) {
    console.error('❌ Ошибка очистки сессий:', error);
    res.status(500).json({ error: 'Ошибка очистки сессий' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint не найден',
    path: req.path
  });
});

// Error handler (безопасный для продакшена)
app.use((err, req, res, next) => {
  console.error('Database service error:', {
    message: err.message,
    code: err.code,
    path: req.path,
    stack: isProduction ? undefined : err.stack
  });

  res.status(500).json({
    error: isProduction ? 'Внутренняя ошибка сервера' : err.message,
    code: 'INTERNAL_ERROR'
  });
});

// ============================================================================
// SERVER STARTUP WITH GRACEFUL SHUTDOWN
// ============================================================================
let server;
let cleanupInterval;
let isShuttingDown = false;

async function start() {
  try {
    console.log('🚀 Запуск Database Service...');

    // Проверяем подключение к БД
    const connected = await db.checkConnection();
    if (!connected) {
      throw new Error('Не удалось подключиться к PostgreSQL');
    }

    // Инициализируем БД
    await db.initDatabase();

    // Очищаем старые сессии
    await db.cleanupOldSessions();

    // Запускаем периодическую очистку сессий (каждый час)
    cleanupInterval = setInterval(() => {
      db.cleanupOldSessions().catch(err => {
        console.error('Session cleanup error:', err);
      });
    }, 60 * 60 * 1000);

    server = app.listen(PORT, () => {
      console.log(`✅ Database Service запущен на порту ${PORT}`);
      console.log(`🔐 Разрешенные сервисы: ${ALLOWED_SERVICES.join(', ')}`);
      console.log(`📊 Режим: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('❌ Ошибка запуска сервиса:', error);
    process.exit(1);
  }
}

async function gracefulShutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`\n${signal} received, starting graceful shutdown...`);

  // Stop accepting new connections
  if (server) {
    server.close(async () => {
      console.log('HTTP server closed');

      try {
        // Clear cleanup interval
        if (cleanupInterval) {
          clearInterval(cleanupInterval);
        }

        // Close database connections
        await db.close();
        console.log('Database connections closed');

        console.log('✅ Graceful shutdown completed');
        process.exit(0);
      } catch (err) {
        console.error('Error during shutdown:', err);
        process.exit(1);
      }
    });
  }

  // Force shutdown after 30 seconds
  setTimeout(() => {
    console.error('⚠️ Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

start();
