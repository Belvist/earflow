'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const pino = require('pino');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const { body, param, validationResult } = require('express-validator');
const db = require('./lib/database');
const externalLyrics = require('./lib/externalLyrics');
const { normalizePlainText, plainTextToSyncedLines } = require('./lib/plainLyrics');
const lyricsImport = require('./lib/lyricsImport');
const { createMetrics } = require('./lib/metrics');

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

const app = express();
const PORT = process.env.PORT || 3010;
const isProduction = process.env.NODE_ENV === 'production';
const metrics = createMetrics();

const logger = pino({
    level: isProduction ? 'info' : 'debug',
    transport: isProduction ? undefined : {
        target: 'pino-pretty',
        options: { colorize: true }
    }
});

const JWT_SECRET = String(process.env.JWT_SECRET || '').trim();
if (!JWT_SECRET) {
    logger.error('jwt_secret_missing');
}
if (JWT_SECRET && JWT_SECRET.length < 32) {
    logger.warn('jwt_secret_weak');
}

function readPemFromEnv(raw, b64) {
    if (b64) {
        try {
            return Buffer.from(b64, 'base64').toString('utf8');
        } catch {
            return null;
        }
    }
    return raw || null;
}

function getServiceJwtPublicKey() {
    return readPemFromEnv(process.env.SERVICE_JWT_PUBLIC_KEY, process.env.SERVICE_JWT_PUBLIC_KEY_B64);
}

const SERVICE_JWT_ISSUER = String(process.env.SERVICE_JWT_ISSUER || 'database-service').trim() || 'database-service';
const SERVICE_JWT_AUDIENCE = String(process.env.SERVICE_JWT_AUDIENCE || 'database-service').trim() || 'database-service';

const INTERNAL_ALLOWED_SERVICES = (() => {
    const raw = String(process.env.INTERNAL_ALLOWED_SERVICES || process.env.ALLOWED_SERVICES || '').trim();
    const base = raw
        ? raw.split(',').map((s) => s.trim()).filter(Boolean)
        : ['api-gateway', 'artist-api-gateway'];
    return Array.from(new Set(base));
})();

const LYRICS_VISIBILITY = String(process.env.LYRICS_VISIBILITY || 'library').toLowerCase();
const LIBRARY_USER_ID = parseInt(process.env.LYRICS_LIBRARY_USER_ID || process.env.LIBRARY_USER_ID || '1', 10);

function parsePositiveInt(value) {
    const n = parseInt(String(value || ''), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function extractUserFromClaims(claims) {
    const c = claims && typeof claims === 'object' ? claims : null;
    const rawId = c ? (c.userId ?? c.id ?? c.sub) : null;
    const userId = parsePositiveInt(rawId);
    const role = c && typeof c.role === 'string' ? c.role : '';
    const isAdmin = c && (c.isAdmin === true || role === 'admin');
    return { userId, isAdmin };
}

function canReadLyrics({ uploaderId, requestUserId, requestIsAdmin }) {
    const ownerId = parsePositiveInt(uploaderId);
    const userId = parsePositiveInt(requestUserId);

    if (LYRICS_VISIBILITY === 'public') {
        return true;
    }

    if (LYRICS_VISIBILITY === 'library') {
        const effectiveOwnerId = ownerId == null ? LIBRARY_USER_ID : ownerId;
        if (effectiveOwnerId === LIBRARY_USER_ID) return true;
        if (!userId) return false;
        if (requestIsAdmin === true) return true;
        return effectiveOwnerId === userId;
    }

    if (!userId) return false;
    if (requestIsAdmin === true) return true;
    return ownerId != null && ownerId === userId;
}

function clampString(value, maxLen) {
    const s = typeof value === 'string' ? value : '';
    const t = s.trim();
    if (!t) return '';
    return t.length > maxLen ? t.slice(0, maxLen) : t;
}

function cleanLyricLineText(raw) {
    if (!raw) return '';
    let s = String(raw);
    s = s.replace(/^\s*(?:\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]\s*)+/g, '');
    s = s.replace(/^\s*\[(?:ar|ti|al|by|offset|length|re|ve):[^\]]*\]\s*/gi, '');
    s = s.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
}

function isMeaningfulLyricText(text) {
    const s = typeof text === 'string' ? text : '';
    if (!s) return false;
    const stripped = s.replace(/[.,!?—–\-\s]/g, '').trim();
    return stripped.length > 0;
}

function normalizeLinesForClient(lines) {
    const list = Array.isArray(lines) ? lines : [];
    const out = [];
    for (const raw of list) {
        if (!raw || typeof raw !== 'object') continue;
        const textClean = cleanLyricLineText(raw.text);
        const text = isMeaningfulLyricText(textClean) ? clampString(textClean, 800) : '';
        const startTime = Number(raw.startTime);
        const endTime = Number(raw.endTime);
        const wordsRaw = Array.isArray(raw.words) ? raw.words : [];
        const words = [];
        for (const w of wordsRaw) {
            if (!w || typeof w !== 'object') continue;
            const wtClean = cleanLyricLineText(w.text);
            const wt = isMeaningfulLyricText(wtClean) ? clampString(wtClean, 80) : '';
            if (!wt) continue;
            const ws = Number(w.startTime);
            const we = Number(w.endTime);
            words.push({
                text: wt,
                ...(Number.isFinite(ws) ? { startTime: Math.max(0, ws) } : {}),
                ...(Number.isFinite(we) ? { endTime: Math.max(0, we) } : {}),
            });
            if (words.length >= 160) break;
        }

        if (!text && words.length === 0) continue;
        out.push({
            text,
            startTime: Number.isFinite(startTime) ? Math.max(0, startTime) : 0,
            endTime: Number.isFinite(endTime) ? Math.max(0, endTime) : 0,
            words,
        });
        if (out.length >= 600) break;
    }
    return out;
}

function sanitizeLyricsForClient(lyrics) {
    const l = lyrics && typeof lyrics === 'object' ? lyrics : null;
    if (!l) return null;
    return {
        songId: l.songId,
        language: l.language,
        lines: normalizeLinesForClient(l.lines),
        source: l.source,
        externalProvider: l.externalProvider,
        externalId: l.externalId,
        externalFetchedAt: l.externalFetchedAt,
        createdAt: l.createdAt,
        updatedAt: l.updatedAt,
    };
}

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
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
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
}));

app.use((req, res, next) => {
    const startedAt = process.hrtime.bigint();
    const route = metrics.routeName(req.path);
    res.on('finish', () => {
        const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
        metrics.recordHttp({ method: req.method, route, status: res.statusCode, durationSeconds });
    });
    next();
});

app.get('/metrics', (req, res) => {
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    res.status(200).send(metrics.prometheusText());
});

app.use(express.json({ limit: '1mb' }));

const importUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        files: 1,
        fileSize: 10 * 1024 * 1024,
    },
});

// Rate limiting
const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: isProduction ? 100 : 500,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/health' || req.path === '/metrics'
});

app.use(globalLimiter);

// Logging
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

// ============================================================================
// AUTH MIDDLEWARE
// ============================================================================

function tryAuthenticateFromServiceHeaders(req) {
    const userId = parsePositiveInt(req.get('x-user-id'));
    if (!userId) return null;

    const token = String(req.get('x-service-token') || '').trim();
    if (!token) return null;

    const publicKey = getServiceJwtPublicKey();
    if (!publicKey) return null;

    let decoded;
    try {
        decoded = jwt.verify(token, publicKey, {
            algorithms: ['RS256'],
            issuer: SERVICE_JWT_ISSUER,
            audience: SERVICE_JWT_AUDIENCE,
        });
    } catch {
        return null;
    }

    if (!decoded || decoded.type !== 'service') return null;
    if (!decoded.serviceName || !INTERNAL_ALLOWED_SERVICES.includes(String(decoded.serviceName))) return null;

    const role = String(req.get('x-user-role') || '').trim();
    return { userId, role, isAdmin: role === 'admin', isServiceCall: true, serviceName: String(decoded.serviceName) };
}

const authenticateUser = (req, res, next) => {
    try {
        const internalUser = tryAuthenticateFromServiceHeaders(req);
        if (internalUser) {
            req.user = internalUser;
            next();
            return;
        }

        if (!JWT_SECRET) {
            return res.status(503).json({ error: 'Service Unavailable' });
        }

        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Требуется авторизация' });
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        req.user = decoded;
        next();
    } catch (error) {
        if (error && error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Токен истёк' });
        }
        return res.status(401).json({ error: 'Недействительный токен' });
    }
};

const optionalAuth = (req, res, next) => {
    try {
        const internalUser = tryAuthenticateFromServiceHeaders(req);
        if (internalUser) {
            req.user = internalUser;
            next();
            return;
        }

        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7);
            const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
            req.user = decoded;
        }
    } catch (error) {
        // Игнорируем ошибки, пользователь просто не авторизован
    }
    next();
};

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            error: 'Ошибка валидации',
            details: errors.array().map(e => e.msg)
        });
    }
    next();
};

// ============================================================================
// LYRICS ENDPOINTS
// ============================================================================

/**
 * GET /api/lyrics/:songId
 * Получить текст песни с синхронизацией
 */
app.get('/api/lyrics/:songId',
    authenticateUser,
    param('songId').isInt({ min: 1 }).withMessage('Недопустимый ID песни'),
    handleValidationErrors,
    async (req, res) => {
        try {
            const songId = parseInt(req.params.songId, 10);
            const { userId: requestUserId, isAdmin: requestIsAdmin } = extractUserFromClaims(req.user);

            const access = await db.getSongAccessInfo(songId);
            if (!access.exists) {
                return res.status(404).json({
                    error: 'Песня не найдена',
                    songId
                });
            }

            const isServiceCall = req.user && req.user.isServiceCall === true;
            if (!requestIsAdmin && !isServiceCall) {
                if (!canReadLyrics({ uploaderId: access.uploaderId, requestUserId, requestIsAdmin })) {
                    return res.status(403).json({ error: 'Доступ запрещён' });
                }
            }

            const lyrics = await externalLyrics.getOrFetchLyrics({ songId });

            if (!lyrics) {
                return res.status(404).json({
                    error: 'Текст не найден',
                    songId
                });
            }

            res.json(sanitizeLyricsForClient(lyrics));
        } catch (error) {
            logger.error({ err: error }, 'lyrics_get_failed');
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    }
);

app.post('/api/lyrics/import',
    authenticateUser,
    importUpload.single('file'),
    async (req, res) => {
        try {
            const { userId, isAdmin: requestIsAdmin } = extractUserFromClaims(req.user);
            if (!userId) {
                return res.status(401).json({ error: 'Требуется авторизация' });
            }

            const result = await lyricsImport.importLyricsFromUpload({
                userId,
                requestIsAdmin,
                file: req.file,
                language: req.body?.language,
            });
            return res.status(200).json(result);
        } catch (error) {
            const status = error && typeof error === 'object' && Number.isFinite(Number(error.status)) ? Number(error.status) : 500;
            const safeMessage = error && typeof error === 'object' && typeof error.safeMessage === 'string' ? error.safeMessage : null;
            const details = error && typeof error === 'object' && Array.isArray(error.details) ? error.details : null;

            logger.error({ err: error }, 'lyrics_import_failed');

            if (details && (status === 400 || status === 422)) {
                return res.status(status).json({ error: safeMessage || 'Ошибка валидации', details });
            }
            if (status === 401 || status === 403 || status === 400) {
                return res.status(status).json({ error: safeMessage || 'Ошибка' });
            }
            return res.status(500).json({ error: 'Ошибка сервера' });
        }
    }
);

/**
 * POST /api/lyrics
 * Добавить текст песни (только админ или владелец трека)
 */
app.post('/api/lyrics',
    authenticateUser,
    body('songId').isInt({ min: 1 }).withMessage('Недопустимый ID песни'),
    body('lines').isArray({ min: 1 }).withMessage('Требуется массив строк'),
    body('lines.*.text').isString().trim().notEmpty().withMessage('Текст строки обязателен'),
    body('lines.*.startTime').isFloat({ min: 0 }).withMessage('Время начала обязательно'),
    body('lines.*.endTime').isFloat({ min: 0 }).withMessage('Время окончания обязательно'),
    body('lines.*.words').optional().isArray(),
    body('language').optional().isString().isLength({ min: 2, max: 5 }),
    handleValidationErrors,
    async (req, res) => {
        try {
            const { songId, lines, language } = req.body;
            const { userId, isAdmin: requestIsAdmin } = extractUserFromClaims(req.user);
            if (!userId) {
                return res.status(401).json({ error: 'Требуется авторизация' });
            }

            const canEdit = await db.canUserEditLyricsRbac({ requestUserId: userId, requestIsAdmin, songId });
            if (!canEdit) {
                return res.status(403).json({ error: 'Нет прав на добавление текста' });
            }

            const lyrics = await db.createLyrics({
                songId,
                lines,
                language: language || 'ru',
                createdBy: userId
            });

            res.status(201).json(sanitizeLyricsForClient(lyrics));
        } catch (error) {
            logger.error({ err: error }, 'lyrics_create_failed');
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    }
);

app.post('/api/lyrics/plain',
    authenticateUser,
    body('songId').isInt({ min: 1 }).withMessage('Недопустимый ID песни'),
    body('plainText').isString().trim().isLength({ min: 1, max: 50000 }).withMessage('Текст обязателен'),
    body('language').optional().isString().isLength({ min: 2, max: 5 }),
    handleValidationErrors,
    async (req, res) => {
        try {
            const { songId, plainText, language } = req.body;
            const { userId, isAdmin: requestIsAdmin } = extractUserFromClaims(req.user);
            if (!userId) {
                return res.status(401).json({ error: 'Требуется авторизация' });
            }

            const canEdit = await db.canUserEditLyricsRbac({ requestUserId: userId, requestIsAdmin, songId });
            if (!canEdit) {
                return res.status(403).json({ error: 'Нет прав на добавление текста' });
            }

            const meta = await db.getSongMetadata(songId);
            const durationSeconds = meta ? meta.duration : null;
            const normalized = normalizePlainText(plainText);
            const lines = plainTextToSyncedLines({ plainText: normalized, durationSeconds });
            if (!Array.isArray(lines) || lines.length === 0) {
                return res.status(400).json({ error: 'Невозможно распарсить текст' });
            }

            const lyrics = await db.createLyrics({
                songId,
                lines,
                language: language || 'ru',
                createdBy: userId,
                source: 'manual',
            });

            return res.status(201).json(sanitizeLyricsForClient(lyrics));
        } catch (error) {
            logger.error({ err: error }, 'lyrics_plain_create_failed');
            return res.status(500).json({ error: 'Ошибка сервера' });
        }
    }
);

/**
 * PUT /api/lyrics/:songId
 * Обновить текст песни
 */
app.put('/api/lyrics/:songId',
    authenticateUser,
    param('songId').isInt({ min: 1 }).withMessage('Недопустимый ID песни'),
    body('lines').isArray({ min: 1 }).withMessage('Требуется массив строк'),
    body('lines.*.text').isString().trim().notEmpty().withMessage('Текст строки обязателен'),
    body('lines.*.startTime').isFloat({ min: 0 }).withMessage('Время начала обязательно'),
    body('lines.*.endTime').isFloat({ min: 0 }).withMessage('Время окончания обязательно'),
    handleValidationErrors,
    async (req, res) => {
        try {
            const songId = parseInt(req.params.songId, 10);
            const { lines, language } = req.body;
            const { userId, isAdmin: requestIsAdmin } = extractUserFromClaims(req.user);
            if (!userId) {
                return res.status(401).json({ error: 'Требуется авторизация' });
            }

            const canEdit = await db.canUserEditLyricsRbac({ requestUserId: userId, requestIsAdmin, songId });
            if (!canEdit) {
                return res.status(403).json({ error: 'Нет прав на редактирование' });
            }

            const lyrics = await db.updateLyrics(songId, {
                lines,
                language,
                updatedBy: userId
            });

            if (!lyrics) {
                return res.status(404).json({ error: 'Текст не найден' });
            }

            res.json(sanitizeLyricsForClient(lyrics));
        } catch (error) {
            logger.error({ err: error }, 'lyrics_update_failed');
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    }
);

/**
 * DELETE /api/lyrics/:songId
 * Удалить текст песни
 */
app.delete('/api/lyrics/:songId',
    authenticateUser,
    param('songId').isInt({ min: 1 }).withMessage('Недопустимый ID песни'),
    handleValidationErrors,
    async (req, res) => {
        try {
            const songId = parseInt(req.params.songId, 10);
            const { userId, isAdmin: requestIsAdmin } = extractUserFromClaims(req.user);
            if (!userId) {
                return res.status(401).json({ error: 'Требуется авторизация' });
            }

            const canEdit = await db.canUserEditLyricsRbac({ requestUserId: userId, requestIsAdmin, songId });
            if (!canEdit) {
                return res.status(403).json({ error: 'Нет прав на удаление' });
            }

            const deleted = await db.deleteLyrics(songId);

            if (!deleted) {
                return res.status(404).json({ error: 'Текст не найден' });
            }

            res.json({ success: true, message: 'Текст удалён' });
        } catch (error) {
            logger.error({ err: error }, 'lyrics_delete_failed');
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    }
);

/**
 * GET /api/lyrics/search
 * Поиск песен по тексту
 */
app.get('/api/lyrics/search',
    authenticateUser,
    async (req, res) => {
        try {
            const { q, limit = 20, offset = 0 } = req.query;

            if (!q || q.trim().length < 2) {
                return res.status(400).json({ error: 'Минимум 2 символа для поиска' });
            }

            const effectiveLimit = Math.min(parseInt(limit, 10) || 20, 50);
            const effectiveOffset = parseInt(offset, 10) || 0;

            if (LYRICS_VISIBILITY === 'public') {
                const results = await db.searchLyrics(q.trim(), {
                    limit: effectiveLimit,
                    offset: effectiveOffset
                });
                return res.json(results);
            }

            const { userId: uid } = extractUserFromClaims(req.user);

            if (LYRICS_VISIBILITY === 'library') {
                const uploaderIds = uid ? [LIBRARY_USER_ID, uid] : [LIBRARY_USER_ID];
                const results = await db.searchLyricsByUploaderIds(q.trim(), uploaderIds, {
                    limit: effectiveLimit,
                    offset: effectiveOffset
                });
                return res.json(results);
            }

            if (!uid) {
                return res.status(401).json({ error: 'Требуется авторизация' });
            }

            const results = await db.searchLyricsByUploaderIds(q.trim(), [uid], {
                limit: effectiveLimit,
                offset: effectiveOffset
            });

            res.json(results);
        } catch (error) {
            logger.error({ err: error }, 'lyrics_search_failed');
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    }
);

/**
 * POST /api/lyrics/:songId/report
 * Сообщить о проблеме с текстом
 */
app.post('/api/lyrics/:songId/report',
    authenticateUser,
    param('songId').isInt({ min: 1 }).withMessage('Недопустимый ID песни'),
    body('reason').isString().trim().isLength({ min: 5, max: 500 }),
    handleValidationErrors,
    async (req, res) => {
        try {
            const songId = parseInt(req.params.songId, 10);
            const { reason } = req.body;
            const userId = req.user.userId;

            await db.reportLyrics(songId, userId, reason);

            res.json({ success: true, message: 'Жалоба отправлена' });
        } catch (error) {
            logger.error({ err: error }, 'lyrics_report_failed');
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    }
);

// ============================================================================
// HEALTH CHECK
// ============================================================================

app.get('/health', async (req, res) => {
    try {
        const dbHealthy = await db.healthCheck();
        res.json({
            status: dbHealthy ? 'healthy' : 'degraded',
            service: 'lyrics-service',
            timestamp: new Date().toISOString(),
            database: dbHealthy ? 'connected' : 'disconnected'
        });
    } catch (error) {
        logger.error({
            error: error.message,
            stack: isProduction ? undefined : error.stack,
        }, 'Health check failed');

        res.status(503).json({
            status: 'unhealthy',
            service: 'lyrics-service',
            ...(isProduction ? {} : { error: error.message })
        });
    }
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

app.use((err, req, res, next) => {
    logger.error({
        error: err?.message,
        stack: isProduction ? undefined : err?.stack,
        path: req.path,
        method: req.method
    }, 'Unhandled error');

    if (err && err.message === 'Not allowed by CORS') {
        return res.status(403).json({ error: 'CORS policy violation' });
    }

    res.status(500).json({
        error: isProduction ? 'Внутренняя ошибка сервера' : (err?.message || 'Ошибка сервера')
    });
});

app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint не найден' });
});

// ============================================================================
// STARTUP
// ============================================================================

async function startServer() {
    try {
        await db.initialize();
        logger.info({ port: PORT }, 'lyrics_service_started');

        app.listen(PORT, '0.0.0.0', () => {
            logger.info({ port: PORT }, 'lyrics_service_listening');
        });
    } catch (error) {
        logger.error({ err: error }, 'lyrics_service_start_failed');
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    logger.info('sigterm_received');
    await db.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    logger.info('sigint_received');
    await db.close();
    process.exit(0);
});

startServer();
