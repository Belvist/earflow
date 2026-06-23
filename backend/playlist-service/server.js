/**
 * Playlist Service - Микросервис управления плейлистами
 * Обеспечивает CRUD операции для плейлистов и их треков
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const pino = require('pino');
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

const db = require('./lib/database');
const playlistRoutes = require('./routes/playlists');
const queueRoutes = require('./routes/queue');
const mixRoutes = require('./routes/mix');
const discoverRoutes = require('./routes/discover');
const shareRoutes = require('./routes/share');
const resolveRoutes = require('./routes/resolve');
const { authenticateToken, authenticateService, optionalAuth } = require('./middleware/auth');

// ============================================================================
// CONFIGURATION
// ============================================================================

const PORT = parseInt(process.env.PORT || '3020', 10);
const isProduction = process.env.NODE_ENV === 'production';

const JWT_SECRET = process.env.JWT_SECRET;

// Validate required environment variables
const requiredEnvVars = ['DATABASE_URL', 'JWT_SECRET'];
for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        console.error(`FATAL: ${envVar} environment variable is required`);
        process.exit(1);
    }
}

if (!JWT_SECRET || JWT_SECRET.length < 32) {
    console.error('FATAL: JWT_SECRET must be set and at least 32 characters');
    process.exit(1);
}

if (!process.env.SERVICE_JWT_PUBLIC_KEY && !process.env.SERVICE_JWT_PUBLIC_KEY_B64) {
    console.error('FATAL: SERVICE_JWT_PUBLIC_KEY(_B64) must be set for service-to-service authentication');
    process.exit(1);
}

// Logger
const logger = pino({
    level: isProduction ? 'info' : 'debug',
    transport: isProduction ? undefined : {
        target: 'pino-pretty',
        options: { colorize: true }
    }
});

// ============================================================================
// EXPRESS APP SETUP
// ============================================================================

const app = express();

// Make db accessible to routes without circular imports
app.locals.db = db;

// Trust proxy for rate limiting behind nginx
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
}));

const allowedOriginsRaw = (process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGIN || '').toString();
const allowedOrigins = allowedOriginsRaw
    ? allowedOriginsRaw.split(',').map((o) => o.trim()).filter(Boolean)
    : (() => {
        const cookieDomainRaw = String(process.env.COOKIE_DOMAIN || '').trim();
        const host = cookieDomainRaw.replace(/^\.+/, '').trim() || 'earflow.ru';
        return [`https://${host}`, `https://www.${host}`];
    })();

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        if (!isProduction && /\.(ngrok-free\.app|ngrok-free\.dev|ngrok\.io|loca\.lt|trycloudflare\.com)$/.test(origin)) {
            return callback(null, true);
        }
        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Service-Token', 'X-User-Id'],
}));

app.use(compression());
app.use(express.json({ limit: '1mb' }));

// Request logging
const morganFormat = isProduction
    ? ':remote-addr - :method :url :status :response-time ms'
    : 'dev';
morgan.token('safe-url', (req) => sanitizeUrlForLogs(req.originalUrl || req.url));
const effectiveMorganFormat = isProduction
    ? ':remote-addr - :method :safe-url :status :response-time ms'
    : 'dev';
app.use(morgan(effectiveMorganFormat, {
    skip: (req) => req.path === '/health' || req.path === '/metrics'
}));

// Rate limiting
const globalLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: isProduction ? 100 : 500,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/health' || req.path === '/metrics',
    message: { error: 'Слишком много запросов, попробуйте позже' }
});

app.use(globalLimiter);

// ============================================================================
// HEALTH & METRICS
// ============================================================================

app.get('/health', async (req, res) => {
    try {
        // Check database connection
        const dbHealthy = await db.healthCheck();

        const health = {
            status: dbHealthy ? 'healthy' : 'degraded',
            service: 'playlist-service',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            database: dbHealthy ? 'connected' : 'disconnected'
        };

        if (req.query.detailed === 'true') {
            health.memory = process.memoryUsage();
            health.nodeVersion = process.version;
            health.poolStats = db.getPoolStats();
        }

        res.status(dbHealthy ? 200 : 503).json(health);
    } catch (error) {
        logger.error({ error: error.message }, 'Health check failed');
        res.status(503).json({
            status: 'unhealthy',
            service: 'playlist-service',
            error: 'Health check failed'
        });
    }
});

app.get('/metrics', (req, res) => {
    const poolStats = db.getPoolStats();
    res.json({
        uptime_seconds: process.uptime(),
        memory_heap_used_bytes: process.memoryUsage().heapUsed,
        memory_rss_bytes: process.memoryUsage().rss,
        db_pool_total: poolStats.totalCount,
        db_pool_idle: poolStats.idleCount,
        db_pool_waiting: poolStats.waitingCount,
        node_version: process.version
    });
});

// ============================================================================
// API ROUTES
// ============================================================================

// Mix share links: GET is public, POST requires user JWT
const authenticateMix = (req, res, next) => {
    if (req.method === 'POST') {
        return authenticateToken(req, res, next);
    }
    return next();
};

app.use('/api/mix', authenticateMix, mixRoutes);

// Public playlists are accessible without user auth
// All other playlist routes require user JWT
const authenticatePlaylists = (req, res, next) => {
    if (req.path && (req.path === '/public' || req.path.startsWith('/public/'))) {
        return next();
    }
    return authenticateToken(req, res, next);
};

// Discover rails MUST be mounted before /api/playlists/:id routes
app.use('/api/playlists/discover', optionalAuth, discoverRoutes);

// Centralized playlist identifier resolution (supports anon legacy discover)
app.use('/api/playlists/resolve', optionalAuth, resolveRoutes);

// Share compiled playlists (requires user JWT)
app.use('/api/playlists/share', authenticateToken, shareRoutes);

// Public routes (with user authentication via JWT except /public)
app.use('/api/playlists', authenticatePlaylists, playlistRoutes);
app.use('/api/queue', authenticateToken, queueRoutes);

// Internal service routes (with service token)
app.use('/internal/playlists/discover', authenticateService, discoverRoutes);
app.use('/internal/playlists/share', authenticateService, shareRoutes);
app.use('/internal/playlists', authenticateService, playlistRoutes);

// ============================================================================
// ERROR HANDLING
// ============================================================================

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Not found',
        path: req.path
    });
});

// Global error handler
app.use((err, req, res, next) => {
    logger.error({
        error: err.message,
        stack: isProduction ? undefined : err.stack,
        path: req.path,
        method: req.method
    }, 'Unhandled error');

    if (err && err.message === 'Not allowed by CORS') {
        return res.status(403).json({
            error: 'CORS policy violation'
        });
    }

    res.status(err.status || 500).json({
        error: isProduction ? 'Внутренняя ошибка сервера' : err.message
    });
});

// ============================================================================
// SERVER STARTUP
// ============================================================================

let server;

async function startServer() {
    try {
        // Initialize database
        await db.initialize();
        logger.info('Database initialized');

        // Start HTTP server
        server = app.listen(PORT, () => {
            logger.info({ port: PORT, env: process.env.NODE_ENV || 'development' },
                'Playlist Service started');
        });

        // Optimize for keep-alive connections
        server.keepAliveTimeout = 65000;
        server.headersTimeout = 66000;

    } catch (error) {
        logger.fatal({ error: error.message }, 'Failed to start server');
        process.exit(1);
    }
}

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

let isShuttingDown = false;

async function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info({ signal }, 'Graceful shutdown initiated');

    // Stop accepting new connections
    if (server) {
        server.close(() => {
            logger.info('HTTP server closed');
        });
    }

    // Close database connections
    try {
        await db.close();
        logger.info('Database connections closed');
    } catch (error) {
        logger.error({ error: error.message }, 'Error closing database');
    }

    // Force exit after timeout
    setTimeout(() => {
        logger.warn('Forced shutdown after timeout');
        process.exit(1);
    }, 30000);

    process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start the server
startServer();

module.exports = app;
