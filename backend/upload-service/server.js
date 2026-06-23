const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const http = require('http');
const https = require('https');
const jwt = require('jsonwebtoken');
const { getCookieValue } = require('./lib/http/cookies');
const createAuthenticateUser = require('./middleware/authenticateUser');
const { applyCsrfProtection } = require('./middleware/csrfProtection');
const crypto = require('crypto');
const { execFile } = require('child_process');
const util = require('util');
const execFilePromise = util.promisify(execFile);

let iconv = null;
try {
  iconv = require('iconv-lite');
} catch {
  iconv = null;
}
require('dotenv').config();

const UPLOAD_CONTEXT_HEADER = 'x-earflow-upload-context';
const UPLOAD_CONTEXT_ARTIST_PORTAL = 'artist-portal';

function hasArtistPortalUploadContext(req) {
  const raw = req && req.headers ? req.headers[UPLOAD_CONTEXT_HEADER] : null;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return String(value || '').trim().toLowerCase() === UPLOAD_CONTEXT_ARTIST_PORTAL;
}

async function ffprobeReadFormat(filePath) {
  try {
    const { stdout } = await execFilePromise('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      filePath
    ], { timeout: 15000, maxBuffer: 1024 * 1024 });
    const data = JSON.parse(stdout);
    const tags = data && data.format && data.format.tags ? data.format.tags : {};
    const duration = data && data.format && data.format.duration ? parseFloat(data.format.duration) : null;
    return {
      tags,
      duration: Number.isFinite(duration) ? duration : null
    };
  } catch {
    return { tags: {}, duration: null };
  }
}

async function ffmpegExtractCoverBuffer(filePath) {
  const tmp = path.join(UPLOAD_DIR, `tmp_cover_${uuidv4()}.jpg`);
  try {
    // Добавлен таймаут 30с для предотвращения DoS
    await execFilePromise('ffmpeg', ['-y', '-i', filePath, '-an', '-vcodec', 'copy', tmp], { timeout: 30000 });
    if (await fs.pathExists(tmp)) {
      const stat = await fs.stat(tmp);
      if (stat.size > 0) {
        return await fs.readFile(tmp);
      }
    }
  } catch (error) {
    console.error(`ffmpegExtractCoverBuffer error for ${filePath}:`, error.message);
  } finally {
    if (await fs.pathExists(tmp)) {
      await fs.remove(tmp).catch(() => { });
    }
  }
  return null;
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelayMs(attempt) {
  const base = 300;
  const cap = 5000;
  const exp = Math.min(cap, base * Math.pow(2, attempt - 1));
  const jitter = exp * 0.25 * (Math.random() * 2 - 1);
  return Math.max(0, Math.floor(exp + jitter));
}

function isIdempotentHttpMethod(method) {
  const m = String(method || '').toUpperCase();
  return m === 'GET' || m === 'HEAD' || m === 'OPTIONS' || m === 'PUT' || m === 'DELETE';
}

function isRetryableDbError(error) {
  if (!error) return false;

  const code = error.code;
  if (code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'EPIPE' || code === 'ENOTFOUND') {
    return true;
  }

  const status = error.response?.status;
  if (status === 502 || status === 503 || status === 504) {
    return true;
  }

  return false;
}

function createServiceUnavailableError(cause) {
  const err = new Error('Database service unavailable');
  err.code = 'DB_SERVICE_UNAVAILABLE';
  err.status = 503;
  err.cause = cause;
  return err;
}

function normalizeCoverPathForClient(rawCoverPath) {
  const coverPath = (rawCoverPath || '').toString().trim();
  if (!coverPath) return null;
  if (coverPath.startsWith('http://') || coverPath.startsWith('https://')) {
    return coverPath;
  }
  const normalized = coverPath.replace(/^\/+/, '');
  const filename = path.basename(normalized);
  if (!filename) return null;
  return `/covers/${filename}`;
}

function normalizeSongForClient(song) {
  if (!song || typeof song !== 'object') return song;
  const normalizedCover = normalizeCoverPathForClient(song.cover_path || song.coverPath);

  // КРИТИЧЕСКИЙ МЕТОД: оставляем ТОЛЬКО поля для UI и движка EBAP.
  // Все системные пути, ID загрузчиков и хеши СТРОГО удаляются.
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album,
    duration: song.duration || song.durationSeconds || song.duration_seconds,
    genre: song.genre,
    year: song.year,
    cover_path: normalizedCover || song.cover_path || song.coverPath,
    has_ebap: !!(song.has_ebap || song.hasEbap),
    ebap_status: typeof song.ebap_status === 'string' ? song.ebap_status : (typeof song.ebapStatus === 'string' ? song.ebapStatus : undefined),
    has_hls: song.has_hls === true || song.hasHls === true,
    hls_status: typeof song.hls_status === 'string' ? song.hls_status : (typeof song.hlsStatus === 'string' ? song.hlsStatus : undefined),
    is_available: song.is_available === true,
    created_at: song.created_at || song.createdAt,
    updated_at: song.updated_at || song.updatedAt,
  };
}

const isProduction = process.env.NODE_ENV === 'production';
const silenceLogs = isProduction && String(process.env.LOG_SILENT || 'true').trim().toLowerCase() !== 'false';

function parseRateLimitMultiplier() {
  const raw = String(process.env.UPLOAD_RATE_LIMIT_MULTIPLIER || process.env.LOAD_TEST_RATE_LIMIT_MULTIPLIER || '').trim();
  if (!raw) return String(process.env.LOAD_TEST_MODE || '').trim().toLowerCase() === 'true' ? 30 : 1;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 100);
}

const rateLimitMultiplier = parseRateLimitMultiplier();

function scaledRateLimit(base) {
  return Math.max(base, Math.min(base * rateLimitMultiplier, 100000));
}

if (silenceLogs) {
  const noop = () => { };
  try {
    console.log = noop;
    console.info = noop;
    console.debug = noop;
  } catch {
  }
}

// Storage module for MinIO/S3 integration
const storageModule = require('./lib/storage');
// File validation module for security
const fileValidator = require('./lib/fileValidator');
const accessControl = require('./lib/accessControl');
const db = require('./lib/db');
const createCoversRouter = require('./routes/covers');
const createDislikesRouter = require('./routes/dislikes');
const createArtistsRouter = require('./routes/artists');
const createUploadRouter = require('./routes/upload');
const createPublishingRouter = require('./routes/publishing');
const createSongCoverUploadRouter = require('./routes/songCoverUpload');
const createArtistAssetsRouter = require('./routes/artistAssets');
const createUserAvatarUploadRouter = require('./routes/userAvatarUpload');
const { normalizeTitle, normalizeArtist, normalizeAlbum } = require('./lib/normalizeText');

const app = express();
const PORT = process.env.PORT || 3002;

// ============================================================================
// SECURITY MIDDLEWARE
// ============================================================================
app.set('trust proxy', 1);

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      mediaSrc: ["'self'", "blob:"],
      connectSrc: ["'self'"],
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }, // Allow cross-origin for streaming
}));

// CORS configuration - SECURE
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
  : (() => {
    const cookieDomainRaw = String(process.env.COOKIE_DOMAIN || '').trim();
    const host = cookieDomainRaw.replace(/^\.+/, '').trim() || 'earflow.ru';
    return [`https://${host}`, `https://www.${host}`];
  })();

const strictCors = cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (internal services, mobile apps)
    if (!origin) return callback(null, true);

    // Check exact match
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Dev tunnels (only in development)
    if (!isProduction && /\.(ngrok-free\.app|ngrok\.io|loca\.lt)$/.test(origin)) {
      return callback(null, true);
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Service-Token', 'X-CSRF-Token', 'Range', 'If-Range'],
});

// Public static cover endpoints are served as cache-friendly, credential-less
// resources. CORS for them is set exclusively by the edge nginx layer
// (`Access-Control-Allow-Origin: *`). Applying the credentialed strictCors
// middleware here would produce duplicate ACAO headers and an invalid
// "ACAO: * + ACAC: true" pairing that browsers reject (Fetch spec §CORS check).
const isPublicCoverPath = (reqPath) => {
  if (typeof reqPath !== 'string' || reqPath.length === 0) return false;
  return reqPath.startsWith('/covers/')
    || reqPath === '/covers'
    || reqPath.startsWith('/api/songs/cover/')
    || reqPath === '/api/songs/cover';
};

app.use((req, res, next) => {
  if (isPublicCoverPath(req.path)) {
    return next();
  }
  return strictCors(req, res, next);
});

// Rate limiting (исключаем статику: covers, health, metrics)
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: scaledRateLimit(isProduction ? 200 : 1000),

  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health' || req.path === '/metrics' || req.path.startsWith('/covers'),
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: scaledRateLimit(10),

  message: { error: 'Слишком много загрузок, подождите минуту' },
});

app.use(globalLimiter);

// Request logging
const morganFormat = isProduction
  ? ':remote-addr - :method :url :status :response-time ms'
  : 'dev';
morgan.token('safe-url', (req) => sanitizeUrlForLogs(req.originalUrl || req.url));
const effectiveMorganFormat = isProduction
  ? ':remote-addr - :method :safe-url :status :response-time ms'
  : 'dev';
app.use(morgan(effectiveMorganFormat, {
  skip: (req) => req.path === '/health',
  ...(silenceLogs ? { stream: { write: () => { } } } : {})
}));

function withTimeout(promise, timeoutMs) {
  const ms = Number(timeoutMs);
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), ms);
    })
  ]);
}

app.get('/health', async (req, res) => {
  void req;
  const timeoutMs = 2500;

  const checks = {
    postgres: false,
    storage: false,
    uploadsWritable: false,
  };

  try {
    await withTimeout(db.pool.query('SELECT 1'), timeoutMs);
    checks.postgres = true;
  } catch {
    checks.postgres = false;
  }

  try {
    const uploadDir = path.join(__dirname, 'uploads');
    await withTimeout(fs.ensureDir(uploadDir), timeoutMs);
    await withTimeout(fs.access(uploadDir, fs.constants.W_OK), timeoutMs);
    checks.uploadsWritable = true;
  } catch {
    checks.uploadsWritable = false;
  }

  try {
    if (String(process.env.STORAGE_MODE || 'minio').toLowerCase() === 'minio') {
      checks.storage = storageModule.isMinioReady && storageModule.isMinioReady() === true;
    } else {
      checks.storage = true;
    }
  } catch {
    checks.storage = false;
  }

  const ok = checks.postgres && checks.storage && checks.uploadsWritable;
  return res.status(ok ? 200 : 503).json({ status: ok ? 'healthy' : 'unhealthy', checks });
});

// ============================================================================
// CONFIGURATION VALIDATION
// ============================================================================
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL;
const JWT_SECRET = process.env.JWT_SECRET;

const SERVICE_JWT_ISSUER = process.env.SERVICE_JWT_ISSUER || 'database-service';
const SERVICE_JWT_AUDIENCE_UPLOAD = process.env.SERVICE_JWT_AUDIENCE_UPLOAD || 'upload-service';

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

if (!AUTH_SERVICE_URL) {
  console.error('FATAL: AUTH_SERVICE_URL must be set');
  process.exit(1);
}

if (!process.env.SERVICE_JWT_PUBLIC_KEY && !process.env.SERVICE_JWT_PUBLIC_KEY_B64) {
  console.error('FATAL: SERVICE_JWT_PUBLIC_KEY(_B64) must be set for service token verification');
  process.exit(1);
}

applyCsrfProtection(app, {
  jwtSecret: JWT_SECRET,
  allowedOrigins,
  devOriginPatterns: [/\.(ngrok-free\.app|ngrok\.io|loca\.lt)$/],
  nodeEnv: process.env.NODE_ENV,
});

// Определение MIME типа по расширению файла для высокого качества аудио
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.mp3': 'audio/mpeg',
    '.flac': 'audio/flac',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.wma': 'audio/x-ms-wma'
  };
  return mimeTypes[ext] || 'audio/mpeg';
}

async function recoverSongRecordAfterCreateFailure({ userId, fileHash, title, artist, audioKey }) {
  if (fileHash) {
    try {
      const recovered = await db.songs.getSongByHash(fileHash, userId);
      if (recovered && recovered.id) {
        return recovered;
      }
    } catch {
    }
  }

  if (title && artist) {
    try {
      const list = await db.songs.lookupSongs({ title, artist, userId });
      const items = Array.isArray(list) ? list : [];
      const match = items.find((s) => s && s.file_path && audioKey && String(s.file_path) === String(audioKey));
      if (match && match.id) {
        return match;
      }
    } catch {
    }
  }

  return null;
}

const listenDedup = new Map();
const LISTEN_DEDUP_MS = 30_000;
const LISTEN_DEDUP_MAX_KEYS = 10_000;
let listenDedupLastPurgeAt = 0;

function purgeListenDedup(nowMs) {
  const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  if (now - listenDedupLastPurgeAt < 10_000) return;
  listenDedupLastPurgeAt = now;

  const cutoff = now - LISTEN_DEDUP_MS;
  for (const [k, at] of listenDedup.entries()) {
    if (!Number.isFinite(at) || at <= cutoff) {
      listenDedup.delete(k);
    }
  }
}

async function recordListenOnce({ userId, songId }) {
  const uid = parseInt(String(userId || ''), 10);
  const sid = parseInt(String(songId || ''), 10);
  if (!Number.isFinite(uid) || uid <= 0 || !Number.isFinite(sid) || sid <= 0) return;
  const key = `${uid}:${sid}`;
  const now = Date.now();
  if (listenDedup.size > LISTEN_DEDUP_MAX_KEYS) {
    purgeListenDedup(now);
  }
  const prev = listenDedup.get(key);
  if (prev && (now - prev) < LISTEN_DEDUP_MS) return;
  listenDedup.set(key, now);
  purgeListenDedup(now);
  try {
    await db.listens.createListen(uid, sid);
  } catch {
  }
}

async function rollbackUploadedObjects({ audioKey, coverKeys }) {
  if (!storageModule || typeof storageModule.deleteFile !== 'function') {
    return;
  }

  if (audioKey) {
    await storageModule.deleteFile(String(audioKey).replace(/^\/+/, ''), 'audio').catch(() => null);
  }

  const keys = Array.isArray(coverKeys) ? coverKeys : (coverKeys ? [coverKeys] : []);
  for (const k of keys) {
    if (!k) continue;
    await storageModule.deleteFile(String(k).replace(/^\/+/, ''), 'covers').catch(() => null);
  }
}

// Middleware для проверки JWT токена
const authenticateUser = createAuthenticateUser({
  authServiceUrl: AUTH_SERVICE_URL,
  jwtSecret: JWT_SECRET,
  axios,
  jwt,
  getCookieValue,
});

app.use(express.json());

// Создаем директорию для загрузок
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.ensureDirSync(UPLOAD_DIR);

app.use(createCoversRouter({ storageModule, localUploadDir: UPLOAD_DIR }));
app.use(createDislikesRouter({ authenticateUser, db }));
app.use(createArtistsRouter({ authenticateUser, db, normalizeSongForClient }));
app.use(createUploadRouter({
  authenticateUser,
  uploadLimiter,
  storageModule,
  fileValidator,
  db,
  accessControl,
  localUploadDir: UPLOAD_DIR,
}));
app.use(createPublishingRouter({ authenticateUser, db, accessControl }));
app.use(createSongCoverUploadRouter({ authenticateUser, storageModule, db, accessControl }));
app.use(createArtistAssetsRouter({ authenticateUser, uploadLimiter, storageModule, db, accessControl }));
app.use(createUserAvatarUploadRouter({ authenticateUser, uploadLimiter, storageModule, db, accessControl }));

// Конфигурация Multer для загрузки файлов
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    void req;
    void file;
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    void req;
    void file;
    const uniqueName = `${uuidv4()}${path.extname(file.originalname || '')}`;
    cb(null, uniqueName);
  },
});

app.get('/api/songs/user/:userId', authenticateUser, async (req, res) => {
  try {
    const requestUserId = accessControl.getRequestUserId(req);
    const requestIsAdmin = accessControl.getRequestIsAdmin(req);
    const targetUserId = parseInt(req.params.userId, 10);
    if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
      return res.status(400).json({ error: 'Некорректный userId' });
    }

    if (!accessControl.canAccessUserSongs({ requestUserId, targetUserId, requestIsAdmin })) {
      return accessControl.deny(res);
    }

    if (!requestIsAdmin) {
      const owned = await db.artistOwnerships.getOwnedArtistByUserId(targetUserId);
      if (!owned) {
        return res.status(403).json({ error: 'Доступ запрещен' });
      }
    }

    const songs = await db.songs.getSongsByUploader(targetUserId, { includeUnavailable: true });
    const items = Array.isArray(songs) ? songs : [];
    return res.json(items.map(normalizeSongForClient));
  } catch {
    return res.status(500).json({ error: 'Ошибка получения песен' });
  }
});

app.put('/api/songs/:id', authenticateUser, async (req, res) => {
  try {
    if (!hasArtistPortalUploadContext(req)) {
      return res.status(403).json({ error: 'Artist portal required', code: 'ARTIST_PORTAL_ONLY' });
    }

    const songId = parseInt(req.params.id, 10);
    if (!Number.isFinite(songId) || songId <= 0) {
      return res.status(400).json({ error: 'Недопустимый идентификатор трека' });
    }

    const song = await db.songs.getSongById(songId);
    if (!song) {
      return res.status(404).json({ error: 'Песня не найдена' });
    }

    const requestUserId = accessControl.getRequestUserId(req);
    const requestIsAdmin = accessControl.getRequestIsAdmin(req);
    if (!requestIsAdmin && song.user_id !== requestUserId) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }

    const title = normalizeTitle(req.body?.title);
    const artist = requestIsAdmin ? normalizeArtist(req.body?.artist) : null;
    const album = normalizeAlbum(req.body?.album);
    const genreRaw = req.body?.genre;
    const yearRaw = req.body?.year;
    const coverPathRaw = req.body?.cover_path;

    const patch = {
      ...(title !== null ? { title } : {}),
      ...(artist !== null ? { artist } : {}),
      ...(album !== null ? { album } : {}),
      ...(genreRaw !== undefined ? { genre: genreRaw } : {}),
      ...(yearRaw !== undefined ? { year: yearRaw } : {}),
      ...(coverPathRaw !== undefined ? { cover_path: coverPathRaw } : {}),
    };

    const updatedSong = await db.songs.updateSong(songId, patch);
    if (!updatedSong) {
      return res.status(404).json({ error: 'Песня не найдена' });
    }

    return res.json(normalizeSongForClient(updatedSong));
  } catch (error) {
    console.error('❌ Ошибка обновления песни:', error);
    return res.status(500).json({ error: 'Ошибка обновления песни' });
  }
});

app.delete('/api/songs/:id', authenticateUser, async (req, res) => {
  try {
    if (!hasArtistPortalUploadContext(req)) {
      return res.status(403).json({ error: 'Artist portal required', code: 'ARTIST_PORTAL_ONLY' });
    }

    const songId = parseInt(req.params.id, 10);
    if (!Number.isFinite(songId) || songId <= 0) {
      return res.status(400).json({ error: 'Недопустимый идентификатор трека' });
    }

    const song = await db.songs.getSongById(songId);
    if (!song) {
      return res.status(404).json({ error: 'Песня не найдена' });
    }

    const requestUserId = accessControl.getRequestUserId(req);
    const requestIsAdmin = accessControl.getRequestIsAdmin(req);
    if (!requestIsAdmin && song.user_id !== requestUserId) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }

    if (!requestIsAdmin) {
      const owned = await db.artistOwnerships.getOwnedArtistByUserId(requestUserId);
      if (!owned) {
        return res.status(403).json({ error: 'Доступ запрещен' });
      }
    }

    const deleted = await db.songs.deleteSong(songId);
    if (!deleted) {
      return res.status(404).json({ error: 'Песня не найдена' });
    }

    const audioKey = song.file_path;
    const coverKey = song.cover_path;
    if (audioKey) {
      await storageModule.deleteFile(String(audioKey).replace(/^\/+/, ''), 'audio').catch(() => null);
    }
    if (coverKey) {
      await storageModule.deleteFile(String(coverKey).replace(/^\/+/, ''), 'covers').catch(() => null);
    }

    return res.json({ id: deleted.id });
  } catch (error) {
    console.error('❌ Ошибка удаления песни:', error?.message || 'Unknown error');
    return res.status(500).json({ error: 'Ошибка удаления песни' });
  }
});

/**
 * Likes API — прокси к Database Service с аутентификацией пользователя
 */
app.get('/api/likes', authenticateUser, async (req, res) => {
  try {
    const liked = await db.likes.listLikes(req.user.id);
    res.json(Array.isArray(liked) ? liked : []);
  } catch (error) {
    console.error('❌ Ошибка получения лайков:', error.message);
    res.status(500).json({ error: 'Ошибка получения лайков' });
  }
});

app.post('/api/likes/:songId', authenticateUser, async (req, res) => {
  try {
    const songId = parseInt(req.params.songId, 10);
    if (!Number.isFinite(songId) || songId <= 0) {
      return res.status(400).json({ error: 'Недопустимый идентификатор трека' });
    }
    const result = await db.likes.addLike(req.user.id, songId);
    res.json(result);
  } catch (error) {
    const status = Number.isFinite(error?.status) ? error.status : 500;
    console.error('❌ Ошибка лайка:', error?.message || 'Unknown error');
    if (status === 400) return res.status(400).json({ error: 'Некорректный запрос' });
    if (status === 404) return res.status(404).json({ error: 'Трек не найден' });
    res.status(500).json({ error: 'Ошибка лайка' });
  }
});

app.delete('/api/likes/:songId', authenticateUser, async (req, res) => {
  try {
    const songId = parseInt(req.params.songId, 10);
    if (!Number.isFinite(songId) || songId <= 0) {
      return res.status(400).json({ error: 'Недопустимый идентификатор трека' });
    }
    const result = await db.likes.removeLike(req.user.id, songId);
    res.json(result);
  } catch (error) {
    const status = Number.isFinite(error?.status) ? error.status : 500;
    console.error('❌ Ошибка снятия лайка:', error?.message || 'Unknown error');
    if (status === 400) return res.status(400).json({ error: 'Некорректный запрос' });
    if (status === 404) return res.status(404).json({ error: 'Трек не найден' });
    res.status(500).json({ error: 'Ошибка снятия лайка' });
  }
});

// Эквалайзер
app.get('/api/eq', authenticateUser, async (req, res) => {
  try {
    const settings = await db.eq.getEqSettings(req.user.id);
    res.json(settings);
  } catch (error) {
    console.error('❌ Ошибка получения настроек EQ:', error.message);
    res.status(500).json({ error: 'Ошибка получения настроек эквалайзера' });
  }
});

app.post('/api/eq', authenticateUser, async (req, res) => {
  try {
    const result = await db.eq.saveEqSettings(req.user.id, req.body);
    res.json(result);
  } catch (error) {
    console.error('❌ Ошибка сохранения настроек EQ:', error.message);
    res.status(500).json({ error: 'Ошибка сохранения настроек эквалайзера' });
  }
});

// ============================================================================
// ERROR HANDLING
// ============================================================================
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err);

  // Multer errors
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Файл слишком большой (максимум 100MB)' });
    }
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }

  res.status(500).json({
    error: 'Внутренняя ошибка сервера'
  });
});

// ============================================================================
// SERVER STARTUP WITH GRACEFUL SHUTDOWN
// ============================================================================

let server;

async function startServer() {
  // Initialize storage (MinIO connection)
  try {
    await storageModule.initializeS3Client();
    const status = storageModule.getStorageStatus();
    void status;
  } catch (error) {
    console.error('❌ Storage initialization failed:', error.message);
    if (process.env.STORAGE_MODE === 'minio') {
      console.error('FATAL: MinIO required but unavailable');
      process.exit(1);
    }
  }

  server = app.listen(PORT, () => {
    void PORT;
    void UPLOAD_DIR;
    void AUTH_SERVICE_URL;
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  void signal;

  // Stop accepting new connections
  server.close(() => {
    process.exit(0);
  });

  // Force shutdown after 30 seconds
  setTimeout(() => {
    console.error('⚠️ Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
