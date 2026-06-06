'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const multer = require('multer');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { z } = require('zod');
const createTracksRouter = require('./routes/tracks');
const createPreviewRouter = require('./routes/preview');
const { applyCsrfProtection } = require('./middleware/csrfProtection');

const SAFE_COVER_PATH_RE = /^[a-zA-Z0-9/_.-]{1,500}$/;

const safeCoverPath = z
    .string()
    .max(500)
    .regex(SAFE_COVER_PATH_RE)
    .refine((v) => !v.includes('..'), { message: 'path traversal not allowed' })
    .refine((v) => !v.startsWith('/') && !v.endsWith('/'), { message: 'absolute/trailing slash not allowed' })
    .refine((v) => !v.includes('//'), { message: 'double slash not allowed' });

const artistCardPatchSchema = z.object({
    bio: z.string().max(2000).nullish(),
    heroCoverPath: safeCoverPath.nullish(),
    avatarCoverPath: safeCoverPath.nullish(),
    bannerCoverPath: safeCoverPath.nullish(),
}).strict();

require('dotenv').config();

const PORT = Number(process.env.PORT) || 3085;
const NODE_ENV = String(process.env.NODE_ENV || 'development');
const isProduction = NODE_ENV === 'production';
const JWT_SECRET = String(process.env.JWT_SECRET || '').trim();

const DISABLE_TRACK_UPLOAD_STEP_UP = !isProduction && String(process.env.ARTIST_PORTAL_DISABLE_TRACK_UPLOAD_STEP_UP || '').trim().toLowerCase() === 'true';
const UPLOAD_CONTEXT_HEADER = 'X-Earflow-Upload-Context';
const UPLOAD_CONTEXT_ARTIST_PORTAL = 'artist-portal';

const ARTIST_SERVICE_URL = String(process.env.ARTIST_SERVICE_URL || 'http://artist-service:3040').replace(/\/+$/, '');
const AUTH_SERVICE_URL = String(process.env.AUTH_SERVICE_URL || 'http://auth-service:3001').replace(/\/+$/, '');
const UPLOAD_SERVICE_URL = String(process.env.UPLOAD_SERVICE_URL || 'http://upload-service:3002').replace(/\/+$/, '');
const ARTIST_PORTAL_UPLOAD_TMP_DIR = String(process.env.ARTIST_PORTAL_UPLOAD_TMP_DIR || path.join(os.tmpdir(), 'earflow-artist-uploads')).trim();
const allowedOrigins = String(process.env.ALLOWED_ORIGINS || 'https://artists.earflow.ru')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

function safeUploadFilename(file, fallbackName) {
    const raw = typeof file?.originalname === 'string' && file.originalname.trim() ? file.originalname.trim() : fallbackName;
    const base = path.basename(raw).replace(/[^\w.\- ]+/g, '_').slice(0, 120);
    return base || fallbackName;
}

async function cleanupUploadFile(file) {
    const filePath = typeof file?.path === 'string' ? file.path : '';
    if (!filePath) return;
    try {
        await fsp.unlink(filePath);
    } catch (err) {
        if (err && err.code !== 'ENOENT') {
            console.warn('artist_upload_temp_cleanup_failed', { path: filePath, error: err.message });
        }
    }
}

async function appendMulterFileToFormData(form, file, fallbackName) {
    const name = safeUploadFilename(file, fallbackName);
    const type = file?.mimetype || 'application/octet-stream';

    if (Buffer.isBuffer(file?.buffer)) {
        form.append('file', new Blob([file.buffer], { type }), name);
        return;
    }

    if (typeof file?.path === 'string' && file.path) {
        if (typeof fs.openAsBlob === 'function') {
            const blob = await fs.openAsBlob(file.path, { type });
            form.append('file', blob, name);
            return;
        }

        const data = await fsp.readFile(file.path);
        form.append('file', new Blob([data], { type }), name);
        return;
    }

    throw new Error('NO_FILE');
}

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

async function proxyJson({ method, url, bearer, timeoutMs, body }) {
    const resp = await axios({
        method,
        url,
        data: body,
        timeout: timeoutMs,
        validateStatus: () => true,
        headers: {
            Authorization: bearer,
            [UPLOAD_CONTEXT_HEADER]: UPLOAD_CONTEXT_ARTIST_PORTAL,
        },
    });
    return { status: resp.status, data: resp.data };
}

async function uploadSongToUploadService({ bearer, file, timeoutMs }) {
    const url = `${UPLOAD_SERVICE_URL}/api/upload/song`;
    const form = new FormData();
    await appendMulterFileToFormData(form, file, 'track');

    const ctrl = new AbortController();
    const ms = Number(timeoutMs);
    const timer = Number.isFinite(ms) && ms > 0 ? setTimeout(() => ctrl.abort(), ms) : null;
    try {
        const resp = await fetch(url, {
            method: 'POST',
            body: form,
            signal: ctrl.signal,
            headers: {
                Authorization: bearer,
                Accept: 'application/json',
                [UPLOAD_CONTEXT_HEADER]: UPLOAD_CONTEXT_ARTIST_PORTAL,
            },
        });

        let data = null;
        try {
            data = await resp.json();
        } catch {
            data = null;
        }

        if (!resp.ok) {
            const status = resp.status;
            if (data && typeof data === 'object') {
                return { ok: false, status, data };
            }
            return { ok: false, status, data: { error: 'UPLOAD_FAILED', code: 'UPLOAD_FAILED' } };
        }

        return { ok: true, status: resp.status, data };
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function uploadSongCoverToUploadService({ bearer, songId, file, timeoutMs }) {
    const url = `${UPLOAD_SERVICE_URL}/api/songs/${encodeURIComponent(String(songId))}/cover`;
    const form = new FormData();
    const name = typeof file.originalname === 'string' && file.originalname.trim() ? file.originalname.trim() : 'cover.png';
    const blob = new Blob([file.buffer], { type: file.mimetype || 'application/octet-stream' });
    form.append('file', blob, name);

    const ctrl = new AbortController();
    const ms = Number(timeoutMs);
    const timer = Number.isFinite(ms) && ms > 0 ? setTimeout(() => ctrl.abort(), ms) : null;
    try {
        const resp = await fetch(url, {
            method: 'POST',
            body: form,
            signal: ctrl.signal,
            headers: {
                Authorization: bearer,
                Accept: 'application/json',
                [UPLOAD_CONTEXT_HEADER]: UPLOAD_CONTEXT_ARTIST_PORTAL,
            },
        });

        let data = null;
        try {
            data = await resp.json();
        } catch {
            data = null;
        }

        if (!resp.ok) {
            const status = resp.status;
            if (data && typeof data === 'object') {
                return { ok: false, status, data };
            }
            return { ok: false, status, data: { error: 'UPLOAD_FAILED', code: 'UPLOAD_FAILED' } };
        }

        return { ok: true, status: resp.status, data };
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function fetchUserId({ bearer, timeoutMs }) {
    const resp = await axios.get(`${AUTH_SERVICE_URL}/api/profile`, {
        headers: {
            Authorization: bearer,
        },
        timeout: timeoutMs,
        validateStatus: () => true,
    });
    const id = resp && resp.data && typeof resp.data === 'object' ? (resp.data.id ?? resp.data.userId ?? resp.data.user_id) : null;
    const parsed = Number.parseInt(String(id || ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        files: 1,
        fileSize: 12 * 1024 * 1024,
    },
});

const songDiskStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        fs.mkdir(ARTIST_PORTAL_UPLOAD_TMP_DIR, { recursive: true }, (err) => cb(err, ARTIST_PORTAL_UPLOAD_TMP_DIR));
    },
    filename: (req, file, cb) => {
        const ext = path.extname(safeUploadFilename(file, 'track')).slice(0, 20);
        cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
    },
});

const songUpload = multer({
    storage: songDiskStorage,
    limits: {
        files: 1,
        fileSize: 200 * 1024 * 1024,
    },
});

function validateImageFile(file) {
    if (!file || typeof file !== 'object') return { ok: false, code: 'NO_FILE' };
    if (!Buffer.isBuffer(file.buffer) || file.buffer.length === 0) return { ok: false, code: 'NO_FILE' };
    const mime = String(file.mimetype || '').toLowerCase();
    const okMime = mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp';
    if (!okMime) return { ok: false, code: 'UNSUPPORTED_IMAGE_TYPE' };
    return { ok: true };
}

async function ensureMfaStepUpForWrite({ bearer }) {
    const me = await fetchArtistMe({ bearer, timeoutMs: 5000 });
    if (me.status !== 200) return { ok: false, status: me.status, data: me.data };
    const isArtist = me.data && me.data.isArtist === true;
    const isAdmin = me.data && me.data.isAdmin === true;
    if (!isArtist && !isAdmin) {
        return { ok: false, status: 403, data: { error: 'ARTIST_ACCESS_REQUIRED', isArtist, isAdmin } };
    }

    const mfa = await fetchMfaStatus({ bearer, timeoutMs: 5000 });
    if (mfa.status !== 200) return { ok: false, status: mfa.status, data: mfa.data };
    if (mfa.data?.enabled !== true) {
        return { ok: false, status: 403, data: { error: 'MFA_REQUIRED', code: 'MFA_REQUIRED' } };
    }

    const stepUp = await fetchStepUpStatus({ bearer, timeoutMs: 5000 });
    if (stepUp.status !== 200) return { ok: false, status: stepUp.status, data: stepUp.data };
    if (stepUp.data?.ok !== true) {
        return { ok: false, status: 403, data: { error: 'MFA_STEP_UP_REQUIRED', code: 'MFA_STEP_UP_REQUIRED' } };
    }

    return { ok: true };
}

async function uploadArtistAssetToUploadService({ bearer, file, kind, timeoutMs }) {
    const url = `${UPLOAD_SERVICE_URL}/api/upload/artist/${encodeURIComponent(kind)}`;
    const form = new FormData();
    const name = typeof file.originalname === 'string' && file.originalname.trim() ? file.originalname.trim() : `${kind}.png`;
    const blob = new Blob([file.buffer], { type: file.mimetype || 'application/octet-stream' });
    form.append('file', blob, name);

    const ctrl = new AbortController();
    const ms = Number(timeoutMs);
    const timer = Number.isFinite(ms) && ms > 0 ? setTimeout(() => ctrl.abort(), ms) : null;
    try {
        const resp = await fetch(url, {
            method: 'POST',
            body: form,
            signal: ctrl.signal,
            headers: {
                Authorization: bearer,
                Accept: 'application/json',
            },
        });

        let data = null;
        try {
            data = await resp.json();
        } catch {
            data = null;
        }

        if (!resp.ok) {
            const status = resp.status;
            const upstreamCode = data && typeof data === 'object' ? data.code : null;
            return { ok: false, status, data: { error: upstreamCode || 'UPLOAD_FAILED' } };
        }

        const key = data && typeof data === 'object' && typeof data.key === 'string' ? data.key : '';
        if (!key) {
            return { ok: false, status: 502, data: { error: 'UPLOAD_FAILED' } };
        }
        return { ok: true, status: 201, data: { key } };
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function patchArtistCard({ bearer, payload, timeoutMs }) {
    const resp = await axios.patch(`${ARTIST_SERVICE_URL}/api/artists/me/card`, payload, {
        headers: {
            Authorization: bearer,
        },
        timeout: timeoutMs,
        validateStatus: () => true,
    });

    if (resp.status === 401) {
        return { status: 401, data: { error: 'Authentication required' } };
    }
    if (resp.status === 403) {
        return { status: 403, data: resp.data && typeof resp.data === 'object' ? resp.data : { error: 'FORBIDDEN' } };
    }
    if (resp.status < 200 || resp.status >= 300) {
        return { status: 400, data: resp.data && typeof resp.data === 'object' ? resp.data : { error: 'INVALID_UPDATE' } };
    }

    return { status: 200, data: resp.data };
}

async function fetchArtistCard({ bearer, timeoutMs }) {
    const resp = await axios.get(`${ARTIST_SERVICE_URL}/api/artists/me/card`, {
        headers: {
            Authorization: bearer,
        },
        timeout: timeoutMs,
        validateStatus: () => true,
    });

    if (resp.status === 401) {
        return { status: 401, data: { error: 'Authentication required' } };
    }
    if (resp.status === 403) {
        return { status: 403, data: resp.data && typeof resp.data === 'object' ? resp.data : { error: 'FORBIDDEN' } };
    }
    if (resp.status < 200 || resp.status >= 300) {
        return { status: 400, data: resp.data && typeof resp.data === 'object' ? resp.data : { error: 'ARTIST_NOT_FOUND' } };
    }

    return { status: 200, data: resp.data };
}

async function fetchMfaStatus({ bearer, timeoutMs }) {
    const resp = await axios.get(`${AUTH_SERVICE_URL}/api/auth/2fa/status`, {
        headers: {
            Authorization: bearer,
        },
        timeout: timeoutMs,
        validateStatus: () => true,
    });

    if (resp.status === 401) {
        return { status: 401, data: { enabled: false, enabledAt: null, recoveryCodesRemaining: 0 } };
    }
    if (resp.status < 200 || resp.status >= 300) {
        return { status: 502, data: { error: 'UPSTREAM_ERROR' } };
    }
    return { status: 200, data: resp.data };
}

async function fetchStepUpStatus({ bearer, timeoutMs }) {
    const resp = await axios.get(`${AUTH_SERVICE_URL}/api/auth/2fa/step-up/status`, {
        headers: {
            Authorization: bearer,
        },
        timeout: timeoutMs,
        validateStatus: () => true,
    });

    if (resp.status === 401) {
        return { status: 401, data: { ok: false, at: null } };
    }
    if (resp.status < 200 || resp.status >= 300) {
        return { status: 502, data: { error: 'UPSTREAM_ERROR' } };
    }
    return { status: 200, data: resp.data };
}

function getCookieValue(req, name) {
    try {
        const raw = req && req.headers ? req.headers.cookie : '';
        const v = typeof raw === 'string' ? raw : '';
        if (!v) return '';

        const parts = v.split(';');
        for (const part of parts) {
            const s = part.trim();
            if (!s) continue;
            const idx = s.indexOf('=');
            if (idx <= 0) continue;
            const k = s.slice(0, idx).trim();
            if (k !== name) continue;
            const val = s.slice(idx + 1);
            try {
                return decodeURIComponent(val);
            } catch {
                return val;
            }
        }
        return '';
    } catch {
        return '';
    }
}

function getBearer(req) {
    const raw = req && req.headers ? req.headers.authorization : '';
    const v = raw ? String(raw).trim() : '';
    if (v && v.toLowerCase().startsWith('bearer ')) return v;

    const tokenArtist = getCookieValue(req, 'mp_auth_artists');
    if (tokenArtist) return `Bearer ${tokenArtist}`;

    const token = getCookieValue(req, 'mp_auth');
    if (token) return `Bearer ${token}`;

    return '';
}

async function fetchArtistMe({ bearer, timeoutMs }) {
    const resp = await axios.get(`${ARTIST_SERVICE_URL}/api/artists/me`, {
        headers: {
            Authorization: bearer,
        },
        timeout: timeoutMs,
        validateStatus: () => true,
    });

    if (resp.status === 401) {
        return { status: 401, data: { isArtist: false, isAdmin: false, artistName: null, artistPublicId: null } };
    }

    if (resp.status < 200 || resp.status >= 300) {
        return { status: 502, data: { error: 'UPSTREAM_ERROR' } };
    }

    return { status: 200, data: resp.data };
}

async function fetchArtistMeta({ artistName, timeoutMs }) {
    const safeArtist = String(artistName || '').trim();
    if (!safeArtist) return { status: 404, data: { error: 'ARTIST_NOT_FOUND' } };

    const resp = await axios.get(`${ARTIST_SERVICE_URL}/api/artists/${encodeURIComponent(safeArtist)}/meta`, {
        timeout: timeoutMs,
        validateStatus: () => true,
    });

    if (resp.status < 200 || resp.status >= 300) {
        return { status: 502, data: { error: 'UPSTREAM_ERROR' } };
    }

    return { status: 200, data: resp.data };
}

const app = express();
app.set('trust proxy', 1);

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
            connectSrc: ["'self'", 'https:'],
        },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
}));

app.use(cors({
    origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Correlation-ID'],
}));

app.use(express.json({ limit: '64kb' }));

applyCsrfProtection(app, {
    jwtSecret: JWT_SECRET,
    allowedOrigins,
    devOriginPatterns: [/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/, /\.(ngrok-free\.app|ngrok\.io|loca\.lt)$/],
    nodeEnv: NODE_ENV,
});

const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: isProduction ? 120 : 1000,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/health' || req.path === '/metrics',
});

app.use(globalLimiter);

app.use(createTracksRouter({
    getBearer,
    ensureMfaStepUpForWrite,
    fetchArtistMe,
    fetchUserId,
    proxyJson,
    uploadSongToUploadService,
    uploadSongCoverToUploadService,
    cleanupUploadFile,
    imageUpload: upload,
    songUpload,
    uploadServiceUrl: UPLOAD_SERVICE_URL,
    disableTrackUploadStepUp: DISABLE_TRACK_UPLOAD_STEP_UP,
}));

app.use(createPreviewRouter({
    getBearer,
    fetchArtistMe,
    fetchUserId,
}));

morgan.token('safe-url', (req) => sanitizeUrlForLogs(req.originalUrl || req.url));
app.use(morgan(isProduction ? ':remote-addr - :method :safe-url :status :response-time ms' : 'dev', { skip: (req) => req.path === '/health' }));

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', service: 'artist-portal-service' });
});

app.get('/metrics', (_req, res) => {
    res.json({ uptime_seconds: process.uptime(), node_version: process.version });
});

app.get('/api/artist-portal/me', async (req, res) => {
    try {
        const bearer = getBearer(req);
        if (!bearer) {
            return res.status(401).json({ isArtist: false, isAdmin: false, artistName: null, artistPublicId: null });
        }

        const me = await fetchArtistMe({ bearer, timeoutMs: 5000 });
        if (me.status !== 200) {
            return res.status(me.status).json(me.data);
        }

        const mfa = await fetchMfaStatus({ bearer, timeoutMs: 5000 });
        if (mfa.status !== 200) {
            return res.status(mfa.status).json(mfa.data);
        }

        return res.json({ ...me.data, mfa: mfa.data });
    } catch {
        return res.status(502).json({ error: 'UPSTREAM_ERROR' });
    }
});

app.post('/api/artist-portal/artist-assets/avatar', upload.single('file'), async (req, res) => {
    try {
        const bearer = getBearer(req);
        if (!bearer) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const gate = await ensureMfaStepUpForWrite({ bearer });
        if (!gate.ok) {
            return res.status(gate.status).json(gate.data);
        }

        const validation = validateImageFile(req.file);
        if (!validation.ok) {
            const st = validation.code === 'UNSUPPORTED_IMAGE_TYPE' ? 415 : 400;
            return res.status(st).json({ error: validation.code });
        }

        const up = await uploadArtistAssetToUploadService({ bearer, file: req.file, kind: 'avatar', timeoutMs: 15_000 });
        if (!up.ok) {
            const st = up.status && Number.isFinite(Number(up.status)) ? Number(up.status) : 502;
            return res.status(st).json(up.data);
        }

        const updated = await patchArtistCard({ bearer, payload: { avatarCoverPath: up.data.key }, timeoutMs: 5000 });
        return res.status(updated.status).json(updated.data);
    } catch {
        return res.status(502).json({ error: 'UPSTREAM_ERROR' });
    }
});

app.post('/api/artist-portal/artist-assets/banner', upload.single('file'), async (req, res) => {
    try {
        const bearer = getBearer(req);
        if (!bearer) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const gate = await ensureMfaStepUpForWrite({ bearer });
        if (!gate.ok) {
            return res.status(gate.status).json(gate.data);
        }

        const validation = validateImageFile(req.file);
        if (!validation.ok) {
            const st = validation.code === 'UNSUPPORTED_IMAGE_TYPE' ? 415 : 400;
            return res.status(st).json({ error: validation.code });
        }

        const up = await uploadArtistAssetToUploadService({ bearer, file: req.file, kind: 'banner', timeoutMs: 15_000 });
        if (!up.ok) {
            const st = up.status && Number.isFinite(Number(up.status)) ? Number(up.status) : 502;
            return res.status(st).json(up.data);
        }

        const updated = await patchArtistCard({ bearer, payload: { bannerCoverPath: up.data.key }, timeoutMs: 5000 });
        return res.status(updated.status).json(updated.data);
    } catch {
        return res.status(502).json({ error: 'UPSTREAM_ERROR' });
    }
});

app.get('/api/artist-portal/artist-card', async (req, res) => {
    try {
        const bearer = getBearer(req);
        if (!bearer) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const card = await fetchArtistCard({ bearer, timeoutMs: 5000 });
        return res.status(card.status).json(card.data);
    } catch {
        return res.status(502).json({ error: 'UPSTREAM_ERROR' });
    }
});

app.patch('/api/artist-portal/artist-card', async (req, res) => {
    try {
        const bearer = getBearer(req);
        if (!bearer) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const gate = await ensureMfaStepUpForWrite({ bearer });
        if (!gate.ok) {
            return res.status(gate.status).json(gate.data);
        }

        const parseResult = artistCardPatchSchema.safeParse(req.body || {});
        if (!parseResult.success) {
            const details = parseResult.error.errors.map(e => ({ field: e.path.join('.'), message: e.message }));
            return res.status(400).json({ error: 'VALIDATION_ERROR', details });
        }

        const { bio, heroCoverPath, avatarCoverPath, bannerCoverPath } = parseResult.data;
        const payload = {};
        if (bio !== undefined) payload.bio = bio;
        if (heroCoverPath !== undefined) payload.heroCoverPath = heroCoverPath;
        if (avatarCoverPath !== undefined) payload.avatarCoverPath = avatarCoverPath;
        if (bannerCoverPath !== undefined) payload.bannerCoverPath = bannerCoverPath;

        const updated = await patchArtistCard({ bearer, payload, timeoutMs: 5000 });
        return res.status(updated.status).json(updated.data);
    } catch {
        return res.status(502).json({ error: 'UPSTREAM_ERROR' });
    }
});

app.get('/api/artist-portal/dashboard', async (req, res) => {
    try {
        const bearer = getBearer(req);
        if (!bearer) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const me = await fetchArtistMe({ bearer, timeoutMs: 5000 });
        if (me.status !== 200) {
            return res.status(me.status).json(me.data);
        }

        if (!me.data || me.data.isArtist !== true || !me.data.artistName) {
            return res.status(403).json({ error: 'ARTIST_ACCESS_REQUIRED' });
        }

        const mfa = await fetchMfaStatus({ bearer, timeoutMs: 5000 });
        if (mfa.status !== 200) {
            return res.status(mfa.status).json(mfa.data);
        }
        if (mfa.data?.enabled !== true) {
            return res.status(403).json({ error: 'MFA_REQUIRED' });
        }

        const meta = await fetchArtistMeta({ artistName: me.data.artistName, timeoutMs: 5000 });
        if (meta.status !== 200) {
            return res.status(meta.status).json(meta.data);
        }

        const safeArtist = encodeURIComponent(String(me.data.artistName).trim());
        const dashboardMetricsUrl = `${ARTIST_SERVICE_URL}/internal/artists/${safeArtist}/dashboard-metrics`;

        const metricsResp = await axios.get(dashboardMetricsUrl, {
            timeout: 10000,
            headers: {
                'X-Internal-Token': process.env.INTERNAL_SERVICE_TOKEN || '',
            },
            validateStatus: () => true,
        });

        if (metricsResp.status < 200 || metricsResp.status >= 300) {
            return res.status(metricsResp.status >= 400 ? metricsResp.status : 502).json({
                error: 'DASHBOARD_METRICS_ERROR',
                me: me.data,
                meta: meta.data,
                mfa: mfa.data,
            });
        }

        const mergedMeta = {
            ...meta.data,
            ...(metricsResp.data && typeof metricsResp.data === 'object' ? metricsResp.data : {}),
        };

        return res.json({
            me: me.data,
            meta: mergedMeta,
            mfa: mfa.data,
        });
    } catch {
        return res.status(502).json({ error: 'UPSTREAM_ERROR' });
    }
});

app.get('/api/artist-portal/analytics', async (req, res) => {
    try {
        const bearer = getBearer(req);
        if (!bearer) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const me = await fetchArtistMe({ bearer, timeoutMs: 5000 });
        if (me.status !== 200) {
            return res.status(me.status).json(me.data);
        }

        if (!me.data || me.data.isArtist !== true || !me.data.artistName) {
            return res.status(403).json({ error: 'ARTIST_ACCESS_REQUIRED' });
        }

        const mfa = await fetchMfaStatus({ bearer, timeoutMs: 5000 });
        if (mfa.status !== 200) {
            return res.status(mfa.status).json(mfa.data);
        }
        if (mfa.data?.enabled !== true) {
            return res.status(403).json({ error: 'MFA_REQUIRED' });
        }

        const safeArtist = encodeURIComponent(String(me.data.artistName).trim());
        const days = Math.min(Math.max(parseInt(String(req.query.days || '30'), 10) || 30, 1), 90);
        const topTracks = Math.min(Math.max(parseInt(String(req.query.topTracks || '20'), 10) || 20, 1), 50);
        const analyticsUrl = `${ARTIST_SERVICE_URL}/internal/artists/${safeArtist}/analytics?days=${days}&topTracks=${topTracks}`;

        const resp = await axios.get(analyticsUrl, {
            timeout: 15000,
            headers: {
                'X-Internal-Token': process.env.INTERNAL_SERVICE_TOKEN || '',
            },
            validateStatus: () => true,
        });

        if (resp.status < 200 || resp.status >= 300) {
            return res.status(resp.status >= 400 ? resp.status : 502).json(
                resp.data && typeof resp.data === 'object' ? resp.data : { error: 'ANALYTICS_ERROR' }
            );
        }

        return res.json(resp.data);
    } catch {
        return res.status(502).json({ error: 'UPSTREAM_ERROR' });
    }
});

app.listen(PORT, () => { });
