const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const redis = require('redis');
const { mountMfaRoutes } = require('./lib/mfa/httpRoutes');
// NOTE: security endpoints (password, telegram unlink, sessions, 2fa recovery regen)
// are handled by the Go security-service (backend/security-service) — hot path moved
// off the Node event loop to handle production concurrency (>100k DAU).
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
const silenceLogs = isProduction && String(process.env.LOG_SILENT || 'true').trim().toLowerCase() !== 'false';

// ============================================================================
// CONFIGURATION VALIDATION (Fail-fast for critical secrets)
// ============================================================================
const PORT = process.env.PORT || 3001;
const DB_SERVICE_URL = process.env.DB_SERVICE_URL;
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ISSUER = (process.env.JWT_ISSUER || 'earflow-auth').trim();
const JWT_AUDIENCE = (process.env.JWT_AUDIENCE || 'earflow-api').trim();
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '365d';
const ACCESS_JWT_EXPIRES_IN = process.env.ACCESS_JWT_EXPIRES_IN || '15m';
const REFRESH_JWT_EXPIRES_IN = process.env.REFRESH_JWT_EXPIRES_IN || '365d';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SERVICE_KEY_AUTH_SERVICE = process.env.SERVICE_KEY_AUTH_SERVICE;
const PBKDF2_ITERATIONS_LEGACY = 100000;
const PBKDF2_ITERATIONS = 600000;
const REDIS_HOST = process.env.REDIS_HOST || 'redis';
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6379;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || '';
const PROFILE_CACHE_TTL = Number(process.env.PROFILE_CACHE_TTL_SECONDS || 600);
const ADMIN_FLAG_CACHE_TTL = Number(process.env.ADMIN_FLAG_CACHE_TTL_SECONDS || 30);

// Validate critical configuration
if (!DB_SERVICE_URL) {
  console.error('FATAL: DB_SERVICE_URL environment variable must be set');
  process.exit(1);
}

if (!SERVICE_KEY_AUTH_SERVICE || SERVICE_KEY_AUTH_SERVICE.length < 32) {
  console.error('FATAL: SERVICE_KEY_AUTH_SERVICE must be set and at least 32 characters');
  process.exit(1);
}

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET must be set and at least 32 characters long');
  console.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
  process.exit(1);
}

if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) {
  console.error('FATAL: ENCRYPTION_KEY must be set and at least 32 characters long');
  console.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

// Convert hex string to Buffer for encryption
const encryptionKeyBuffer = Buffer.from(ENCRYPTION_KEY, 'hex');
if (encryptionKeyBuffer.length !== 32) {
  console.error('FATAL: ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)');
  process.exit(1);
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

// ============================================================================
// EXPRESS APP SETUP
// ============================================================================
const app = express();

app.set('trust proxy', 1);

// Security headers with proper CSP
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
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
  dnsPrefetchControl: { allow: false },
  frameguard: { action: 'deny' },
  hidePoweredBy: true,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  ieNoOpen: true,
  noSniff: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xssFilter: true
}));

app.use(express.json({ limit: '16kb' }));

// Request logging (skip health checks)
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

// ============================================================================
// RATE LIMITING (Production-ready values with internal service bypass)
// ============================================================================

// Список внутренних IP которые не ограничиваются (Docker network)
const isInternalService = (req) => {
  const ip = req.socket?.remoteAddress || req.connection?.remoteAddress || '';

  // Внутренние Docker сети и localhost
  const internalPatterns = [
    /^172\.1[6-9]\./,
    /^172\.2[0-9]\./,
    /^172\.3[0-1]\./,
    /^10\./,
    /^192\.168\./,
    /^127\./,
    /^::1$/,
    /^::ffff:127\./,
    /^::ffff:172\./,
    /^::ffff:10\./,
    /^::ffff:192\.168\./
  ];

  // Проверяем IP
  for (const pattern of internalPatterns) {
    if (pattern.test(ip)) return true;
  }

  return false;
};

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300, // 300 requests per minute per IP (увеличено для development)
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
  skipSuccessfulRequests: false,
  skip: isInternalService // Пропускаем внутренние сервисы
});

app.use(globalLimiter);

// Auth endpoints must never bypass rate-limit via trust-proxy: req.socket.remoteAddress
// would always be the api-gateway IP (docker internal network), which would disable
// brute-force protection for every end-user request coming through the gateway.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per 15 minutes (per client IP via trust proxy)
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful logins
  message: { error: 'Слишком много попыток входа. Попробуйте через 15 минут' },
});

let dbServiceToken = null;

const getDbServiceToken = async () => {
  if (dbServiceToken) {
    try {
      const decoded = jwt.decode(dbServiceToken);
      if (decoded.exp * 1000 > Date.now()) return dbServiceToken;
    } catch (err) {
      console.error('auth-service: failed to decode cached DB service token, refreshing token:', err.message || err);
    }
  }

  const response = await axios.post(`${DB_SERVICE_URL}/auth/service-token`, {
    serviceName: 'auth-service',
    serviceKey: SERVICE_KEY_AUTH_SERVICE
  });

  dbServiceToken = response.data.token;
  return dbServiceToken;
};

const dbRequest = async (method, endpoint, data = null) => {
  const token = await getDbServiceToken();
  const config = {
    method,
    url: `${DB_SERVICE_URL}${endpoint}`,
    headers: {
      'Content-Type': 'application/json',
      'X-Service-Token': token
    },
    timeout: 5000
  };

  if (data) config.data = data;

  try {
    const response = await axios(config);
    return response.data;
  } catch (error) {
    if (error.response?.status === 404) return null;
    throw error;
  }
};

const getCachedIsAdmin = async (userId) => {
  if (!redisReady || !redisClient) {
    return null;
  }

  try {
    const key = `auth:is_admin:${userId}`;
    const raw = await redisClient.get(key);
    if (!raw) return null;
    if (raw === '1') return true;
    if (raw === '0') return false;
    return null;
  } catch {
    return null;
  }
};

const setCachedIsAdmin = async (userId, isAdmin) => {
  if (!redisReady || !redisClient) {
    return;
  }

  try {
    const key = `auth:is_admin:${userId}`;
    await redisClient.setEx(key, ADMIN_FLAG_CACHE_TTL, isAdmin === true ? '1' : '0');
  } catch {
  }
};

async function resolveIsAdminFromDb(userId, fallback = false) {
  const uid = Number.parseInt(String(userId || ''), 10);
  if (!Number.isFinite(uid) || uid <= 0) return fallback === true;

  const cached = await getCachedIsAdmin(uid);
  if (cached === true || cached === false) return cached;

  try {
    const user = await dbRequest('GET', `/api/users/${uid}`);
    const isAdmin = user && user.is_admin === true;
    await setCachedIsAdmin(uid, isAdmin);
    return isAdmin;
  } catch {
    return fallback === true;
  }
}

function issueAccessToken({ userId, sid, isAdmin = false }) {
  const payload = {
    type: 'access',
    userId,
    sid,
    ts: Date.now(),
    isAdmin: isAdmin === true,
  };

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: ACCESS_JWT_EXPIRES_IN,
    algorithm: 'HS256',
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

function issueRefreshToken({ userId, sid, jti }) {
  return jwt.sign(
    {
      type: 'refresh',
      userId,
      sid,
      jti,
      ts: Date.now(),
    },
    JWT_SECRET,
    {
      expiresIn: REFRESH_JWT_EXPIRES_IN,
      algorithm: 'HS256',
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }
  );
}

function normalizeTelegramAuthPayload(raw) {
  const body = raw && typeof raw === 'object' ? raw : null;
  if (!body) return null;

  const id = Number(body.id);
  const authDate = Number(body.auth_date);
  const hash = typeof body.hash === 'string' ? body.hash.trim() : '';

  const firstName = typeof body.first_name === 'string' ? body.first_name : null;
  const lastName = typeof body.last_name === 'string' ? body.last_name : null;
  const username = typeof body.username === 'string' ? body.username : null;
  const photoUrl = typeof body.photo_url === 'string' ? body.photo_url : null;

  if (!Number.isSafeInteger(id) || id <= 0) return null;
  if (!Number.isFinite(authDate) || authDate <= 0) return null;
  if (!hash || hash.length < 20 || hash.length > 256) return null;

  return {
    id,
    auth_date: authDate,
    hash,
    first_name: firstName,
    last_name: lastName,
    username,
    photo_url: photoUrl,
  };
}

function buildTelegramDataCheckString(payload) {
  const pairs = [];
  for (const [k, v] of Object.entries(payload)) {
    if (k === 'hash') continue;
    if (v === null || v === undefined) continue;
    pairs.push([k, String(v)]);
  }
  pairs.sort((a, b) => a[0].localeCompare(b[0]));
  return pairs.map(([k, v]) => `${k}=${v}`).join('\n');
}

function verifyTelegramAuth(payload, botToken) {
  const token = (() => {
    const raw = typeof botToken === 'string' ? botToken.trim() : '';
    if (raw.length >= 2) {
      const q = raw[0];
      if ((q === '"' || q === "'") && raw[raw.length - 1] === q) {
        return raw.slice(1, -1).trim();
      }
    }
    return raw;
  })();
  if (!token) return false;

  const nowSec = Math.floor(Date.now() / 1000);
  const authDate = Number(payload.auth_date);
  if (!Number.isFinite(authDate)) return false;
  if (authDate > nowSec + 5 * 60) return false;
  if (nowSec - authDate > 24 * 60 * 60) return false;

  const dataCheckString = buildTelegramDataCheckString(payload);
  const secretKey = crypto.createHash('sha256').update(token).digest();
  const expected = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  const got = String(payload.hash || '').trim().toLowerCase();

  const expectedBuf = Buffer.from(expected, 'utf8');
  const gotBuf = Buffer.from(got, 'utf8');
  if (expectedBuf.length !== gotBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, gotBuf);
}

function extractSessionMetadata(req) {
  if (!req || typeof req !== 'object') return { ip: '', ua: '' };

  const headers = req.headers || {};
  const xff = typeof headers['x-forwarded-for'] === 'string'
    ? headers['x-forwarded-for'].split(',')[0].trim()
    : '';
  const realIp = typeof headers['x-real-ip'] === 'string' ? headers['x-real-ip'].trim() : '';
  const reqIp = typeof req.ip === 'string' ? req.ip.trim() : '';
  const ipRaw = xff || realIp || reqIp || '';
  const ip = ipRaw.length > 60 ? '' : ipRaw;

  const uaRaw = typeof headers['user-agent'] === 'string' ? headers['user-agent'].trim() : '';
  const ua = uaRaw.length > 512 ? uaRaw.slice(0, 512) : uaRaw;

  return { ip, ua };
}

function buildSessionMetaKey(sid) {
  return `auth:session:meta:${sid}`;
}

function buildUserSidsKey(userId) {
  return `auth:user_sids:${userId}`;
}

async function writeSessionMeta({ sid, userId, ttlSeconds, ip, ua, createdAt }) {
  if (!redisReady || !redisClient) return;
  const metaKey = buildSessionMetaKey(sid);
  const userSidsKey = buildUserSidsKey(userId);
  const payload = {
    userId: Number(userId) || 0,
    createdAt: createdAt || new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    ip: String(ip || ''),
    ua: String(ua || ''),
  };
  await redisClient.setEx(metaKey, Math.max(1, ttlSeconds), JSON.stringify(payload));
  try {
    await redisClient.sAdd(userSidsKey, String(sid));
    await redisClient.expire(userSidsKey, Math.max(1, ttlSeconds + 86400));
  } catch {
    // sAdd may not be available in some clients; fail silently — session itself is still stored
  }
}

async function touchSessionMeta({ sid, ttlSeconds, ip, ua }) {
  if (!redisReady || !redisClient) return;
  const metaKey = buildSessionMetaKey(sid);
  try {
    const raw = await redisClient.get(metaKey);
    if (!raw) return;
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
    if (!parsed || typeof parsed !== 'object') return;

    const next = {
      ...parsed,
      lastSeenAt: new Date().toISOString(),
      ip: ip || parsed.ip || '',
      ua: ua || parsed.ua || '',
    };
    await redisClient.setEx(metaKey, Math.max(1, ttlSeconds), JSON.stringify(next));
  } catch {
    // ignore — metadata refresh is best-effort
  }
}

async function removeSessionMeta({ sid, userId }) {
  if (!redisReady || !redisClient) return;
  try {
    await redisClient.del(buildSessionMetaKey(sid));
  } catch {
    // ignore
  }
  if (userId !== undefined && userId !== null) {
    try {
      await redisClient.sRem(buildUserSidsKey(userId), String(sid));
    } catch {
      // ignore
    }
  }
}

async function storeRefreshSession({ sid, jti, userId, isAdmin = false, expMs, req = null, createdAt = null }) {
  if (!redisReady || !redisClient) {
    return false;
  }

  const ttlSeconds = Math.max(1, Math.floor((expMs - Date.now()) / 1000));
  const refreshKey = `auth:refresh:${jti}`;
  const sidKey = `auth:sid:${sid}`;

  await redisClient.setEx(refreshKey, ttlSeconds, JSON.stringify({ userId, sid, isAdmin: isAdmin === true }));
  await redisClient.setEx(sidKey, ttlSeconds, jti);

  const meta = extractSessionMetadata(req);
  await writeSessionMeta({
    sid,
    userId,
    ttlSeconds,
    ip: meta.ip,
    ua: meta.ua,
    createdAt: createdAt || new Date().toISOString(),
  });

  return true;
}

async function revokeRefreshSession({ sid, jti, userId = null }) {
  if (!redisReady || !redisClient) {
    return false;
  }
  const refreshKey = `auth:refresh:${jti}`;
  const sidKey = `auth:sid:${sid}`;
  const gatewaySessPrefix = String(process.env.SESSION_KEY_PREFIX || 'mp:sess:').trim() || 'mp:sess:';
  const gatewaySessKey = `${gatewaySessPrefix}${sid}`;
  const stepUpKey = `auth:mfa_stepup:${sid}`;
  const graceKey = jti ? `auth:grace:${jti}` : '';

  await redisClient.del(refreshKey);
  await redisClient.del(sidKey);
  await redisClient.del(gatewaySessKey);
  await redisClient.del(stepUpKey);
  if (graceKey) {
    await redisClient.del(graceKey);
  }
  await removeSessionMeta({ sid, userId });

  try {
    const sidDevicesKey = `auth:sid_devices:${sid}`;
    const deviceIds = await redisClient.sMembers(sidDevicesKey);
    for (const authDeviceId of deviceIds || []) {
      const id = String(authDeviceId || '').trim();
      if (!id) continue;
      await redisClient.del(`auth:device:${id}`);
      if (userId !== undefined && userId !== null) {
        await redisClient.sRem(`auth:user_auth_devices:${userId}`, id);
      }
    }
    await redisClient.del(sidDevicesKey);
  } catch {
    // best-effort — PoP device index may be absent
  }

  return true;
}

async function rotateRefreshSession({ refreshToken, req = null }) {
  if (!redisReady || !redisClient) {
    const err = new Error('AUTH_TEMPORARILY_UNAVAILABLE');
    err.status = 503;
    throw err;
  }

  const decoded = jwt.verify(refreshToken, JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
  if (!decoded || decoded.type !== 'refresh' || !decoded.userId || !decoded.sid || !decoded.jti) {
    const err = new Error('INVALID_REFRESH');
    err.status = 401;
    throw err;
  }

  const sidKey = `auth:sid:${decoded.sid}`;
  const refreshKey = `auth:refresh:${decoded.jti}`;
  const graceKey = `auth:grace:${decoded.jti}`;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await redisClient.watch(sidKey);

    const currentJti = await redisClient.get(sidKey);
    if (!currentJti) {
      await redisClient.unwatch();
      const err = new Error('INVALID_REFRESH');
      err.status = 401;
      throw err;
    }
    if (currentJti !== decoded.jti) {
      await redisClient.unwatch();

      const graceKey = `auth:grace:${decoded.jti}`;
      const graceRaw = await redisClient.get(graceKey);

      if (graceRaw) {
        try {
          const parsed = JSON.parse(graceRaw);
          if (parsed && parsed.accessToken && parsed.refreshToken) {
            return parsed;
          }
        } catch (e) {
          console.error('[AUTH] Failed to parse grace data', e);
        }
      }

      // Если grace нет или ошибка — это реально старый токен
      console.error('[AUTH] Security: Refresh Token Reuse detected');
      await redisClient.del(refreshKey);
      const err = new Error('INVALID_REFRESH');
      err.status = 401;
      throw err;
    }

    const sessionRaw = await redisClient.get(refreshKey);
    if (!sessionRaw) {
      await redisClient.unwatch();
      const err = new Error('INVALID_REFRESH');
      err.status = 401;
      throw err;
    }

    let session = null;
    try {
      session = JSON.parse(sessionRaw);
    } catch {
      session = null;
    }
    const isAdmin = await resolveIsAdminFromDb(decoded.userId, !!session?.isAdmin);

    const newJti = crypto.randomBytes(16).toString('hex');
    const newRefreshToken = issueRefreshToken({ userId: decoded.userId, sid: decoded.sid, jti: newJti });
    const newRefreshDecoded = jwt.decode(newRefreshToken);
    const newRefreshExpMs = newRefreshDecoded && newRefreshDecoded.exp
      ? newRefreshDecoded.exp * 1000
      : Date.now() + 30 * 24 * 60 * 60 * 1000;
    const ttlSeconds = Math.max(1, Math.floor((newRefreshExpMs - Date.now()) / 1000));

    const accessToken = issueAccessToken({ userId: decoded.userId, sid: decoded.sid, isAdmin });
    const gracePayload = JSON.stringify({ accessToken, refreshToken: newRefreshToken });
    const newRefreshKey = `auth:refresh:${newJti}`;

    const tx = redisClient.multi();
    tx.setEx(newRefreshKey, ttlSeconds, JSON.stringify({ userId: decoded.userId, sid: decoded.sid, isAdmin }));
    tx.setEx(sidKey, ttlSeconds, newJti);
    tx.del(refreshKey);
    tx.setEx(graceKey, 30 * 60, gracePayload);

    const execResult = await tx.exec();
    if (execResult === null) {
      continue;
    }

    const metaReq = extractSessionMetadata(req);
    await touchSessionMeta({ sid: decoded.sid, ttlSeconds, ip: metaReq.ip, ua: metaReq.ua });
    try {
      await redisClient.sAdd(buildUserSidsKey(decoded.userId), String(decoded.sid));
      await redisClient.expire(buildUserSidsKey(decoded.userId), Math.max(1, ttlSeconds + 86400));
    } catch {
      // best-effort index maintenance
    }

    return { accessToken, refreshToken: newRefreshToken };
  }

  const err = new Error('AUTH_TEMPORARILY_UNAVAILABLE');
  err.status = 503;
  throw err;
}

// ============================================================================
// ACCOUNT LOCKOUT (per-email brute-force protection, Redis-backed)
// ============================================================================
const LOGIN_FAIL_MAX = 5;
const LOGIN_FAIL_WINDOW_SECONDS = 15 * 60;
const LOGIN_LOCK_SECONDS = 15 * 60;

async function loginLockoutStatus(emailHash) {
  if (!redisReady || !redisClient || !emailHash) return { locked: false, retryAfter: 0 };
  try {
    const ttl = await redisClient.ttl(`auth:login_lock:${emailHash}`);
    if (ttl > 0) return { locked: true, retryAfter: ttl };
  } catch {
  }
  return { locked: false, retryAfter: 0 };
}

async function recordLoginFailure(emailHash) {
  if (!redisReady || !redisClient || !emailHash) return;
  try {
    const counterKey = `auth:login_fail:${emailHash}`;
    const count = await redisClient.incr(counterKey);
    if (count === 1) {
      await redisClient.expire(counterKey, LOGIN_FAIL_WINDOW_SECONDS);
    }
    if (count >= LOGIN_FAIL_MAX) {
      await redisClient.setEx(`auth:login_lock:${emailHash}`, LOGIN_LOCK_SECONDS, '1');
      await redisClient.del(counterKey);
    }
  } catch {
  }
}

async function clearLoginFailures(emailHash) {
  if (!redisReady || !redisClient || !emailHash) return;
  try {
    await redisClient.del(`auth:login_fail:${emailHash}`);
    await redisClient.del(`auth:login_lock:${emailHash}`);
  } catch {
  }
}

const DECOY_PASSWORD_SALT = crypto.randomBytes(32).toString('hex');

async function burnDecoyHash(password) {
  try {
    const pw = typeof password === 'string' && password.length > 0 ? password : 'decoy';
    await hashPassword(pw, DECOY_PASSWORD_SALT);
  } catch {
  }
}

function passwordHashEquals(candidateHex, storedHex) {
  if (typeof candidateHex !== 'string' || typeof storedHex !== 'string') return false;
  let a;
  let b;
  try {
    a = Buffer.from(candidateHex, 'hex');
    b = Buffer.from(storedHex, 'hex');
  } catch {
    return false;
  }
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ============================================================================
// REDIS CONNECTION WITH AUTO-RECONNECT
// ============================================================================
let redisClient = null;
let redisReady = false;
let redisReconnectTimer = null;

async function initRedis() {
  try {
    if (redisClient) {
      try {
        await redisClient.quit();
      } catch (e) {
        // Ignore quit errors
      }
      redisClient = null;
    }

    const redisOpts = {
      socket: {
        host: REDIS_HOST,
        port: Number(REDIS_PORT) || 6379,
        reconnectStrategy: (retries) => {
          const delay = Math.min(retries * 500, 30000);
          return delay;
        }
      }
    };
    if (REDIS_PASSWORD) {
      redisOpts.password = REDIS_PASSWORD;
    }

    redisClient = redis.createClient(redisOpts);

    redisClient.on('error', (err) => {
      console.error('Redis error:', err.message);
      redisReady = false;
    });

    redisClient.on('connect', () => {
      redisReady = true;
      if (redisReconnectTimer) {
        clearTimeout(redisReconnectTimer);
        redisReconnectTimer = null;
      }
    });

    redisClient.on('end', () => {
      redisReady = false;
    });

    await redisClient.connect();
  } catch (err) {
    console.error('Failed to connect to Redis:', err.message);
    redisReady = false;

    // Retry connection after 5 seconds
    if (!redisReconnectTimer) {
      redisReconnectTimer = setTimeout(() => {
        initRedis().catch(() => null);
      }, 5000);
    }
  }
}

initRedis();

const getCachedUserProfile = async (userId) => {
  if (!redisReady || !redisClient) {
    return null;
  }

  try {
    const key = `auth:profile:${userId}`;
    const raw = await redisClient.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error('Redis GET error:', err.message);
    redisReady = false;
    return null;
  }
};

const setCachedUserProfile = async (userId, profile) => {
  if (!redisReady || !redisClient) {
    return;
  }

  try {
    const key = `auth:profile:${userId}`;
    await redisClient.setEx(key, PROFILE_CACHE_TTL, JSON.stringify(profile));
  } catch (err) {
    console.error('Redis SET error:', err.message);
    redisReady = false;
  }
};

const sanitizeProfileField = (value, maxLen = 64) => {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, maxLen);
  return trimmed.replace(/[<>\r\n]/g, '');
};

const sanitizeUsername = (value) => {
  if (!value || typeof value !== 'string') return null;
  const normalized = value.trim().replace(/^@+/, '').replace(/\s+/g, '').slice(0, 32);
  const safe = normalized.replace(/[<>\r\n]/g, '');
  return /^[A-Za-zА-Яа-яЁё0-9._-]{3,32}$/.test(safe) ? safe : null;
};

const encryptData = (data, userSalt) => {
  const key = crypto.pbkdf2Sync(encryptionKeyBuffer, userSalt, PBKDF2_ITERATIONS, 32, 'sha512');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return {
    v: 2,
    encrypted: encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  };
};

const isHexString = (value) => {
  return typeof value === 'string' && value.length > 0 && value.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(value);
};

const isHexBytes = (value, bytes) => {
  return typeof value === 'string' && value.length === bytes * 2 && /^[0-9a-fA-F]+$/.test(value);
};

const validateEncryptedPayload = (encryptedData) => {
  if (!encryptedData || typeof encryptedData !== 'object' || Array.isArray(encryptedData)) {
    throw new Error('Invalid encrypted data payload');
  }
  const version = Number(encryptedData.v || 1);
  if (version !== 1 && version !== 2) {
    throw new Error('Unsupported encrypted data version');
  }
  if (!isHexBytes(encryptedData.iv, 16)) {
    throw new Error('Invalid encrypted data iv');
  }
  if (!isHexBytes(encryptedData.authTag, 16)) {
    throw new Error('Invalid encrypted data auth tag');
  }
  if (!isHexString(encryptedData.encrypted)) {
    throw new Error('Invalid encrypted data ciphertext');
  }
  return version;
};

const decryptData = (encryptedData, userSalt) => {
  const version = validateEncryptedPayload(encryptedData);
  const iterations = version === 2 ? PBKDF2_ITERATIONS : PBKDF2_ITERATIONS_LEGACY;
  const key = crypto.pbkdf2Sync(encryptionKeyBuffer, userSalt, iterations, 32, 'sha512');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(encryptedData.iv, 'hex')
  );

  decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));

  let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return JSON.parse(decrypted);
};

const hashPassword = async (password, salt, iterations = PBKDF2_ITERATIONS) => {
  const hash = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512');
  return hash.toString('hex');
};

// Health check с проверкой зависимостей
app.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    service: 'auth-service',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    redis: redisReady ? 'connected' : 'disconnected'
  };

  // Детальная проверка
  if (req.query.detailed === 'true') {
    try {
      await dbRequest('GET', '/health');
      health.database = 'connected';
    } catch {
      health.database = 'disconnected';
      health.status = 'degraded';
    }

    health.memory = process.memoryUsage();
  }

  res.json(health);
});

// Metrics endpoint
app.get('/metrics', (req, res) => {
  res.json({
    uptime_seconds: process.uptime(),
    memory_heap_used_bytes: process.memoryUsage().heapUsed,
    memory_rss_bytes: process.memoryUsage().rss,
    redis_connected: redisReady ? 1 : 0,
    node_version: process.version
  });
});

mountMfaRoutes(app, {
  jwt,
  jwtSecret: JWT_SECRET,
  jwtIssuer: JWT_ISSUER,
  jwtAudience: JWT_AUDIENCE,
  dbRequest,
  encryptData,
  decryptData,
  getRedisState: () => ({ ready: redisReady, client: redisClient }),
  getCachedUserProfile,
  setCachedUserProfile,
});

async function handleEmailRegister(req, res) {
  try {
    const { email, password, firstName, username } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email и пароль обязательны' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Неверный формат email' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Пароль должен быть минимум 8 символов' });
    }

    // Проверка сложности пароля
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      return res.status(400).json({ error: 'Пароль должен содержать буквы и цифры' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const emailHash = crypto.createHash('sha256').update(normalizedEmail).digest('hex');

    const existingUser = await dbRequest('GET', `/api/users/email/${emailHash}`);

    if (existingUser) {
      return res.status(400).json({ error: 'Email уже зарегистрирован' });
    }

    const userSalt = crypto.randomBytes(32).toString('hex');
    const passwordHash = await hashPassword(password, userSalt);

    const safeFirstName = sanitizeProfileField(firstName);
    const safeUsername = sanitizeUsername(username);

    if (username && !safeUsername) {
      return res.status(400).json({ error: 'Неверный username' });
    }

    const encryptedName = safeFirstName
      ? encryptData({ firstName: safeFirstName, lastName: null }, userSalt)
      : null;

    const user = await dbRequest('POST', '/api/users', {
      email: normalizedEmail,
      email_hash: emailHash,
      email_encrypted: null,
      password_hash: passwordHash,
      salt: userSalt,
      username: safeUsername || crypto.createHash('sha256').update(normalizedEmail).digest('hex').substring(0, 16),
      metadata: encryptedName ? JSON.stringify(encryptedName) : null
    });

    if (!redisReady || !redisClient) {
      return res.status(503).json({ error: 'Сервис временно недоступен' });
    }

    const sid = crypto.randomBytes(16).toString('hex');
    const jti = crypto.randomBytes(16).toString('hex');
    const refreshToken = issueRefreshToken({ userId: user.id, sid, jti });
    const refreshDecoded = jwt.decode(refreshToken);
    const refreshExpMs = refreshDecoded && refreshDecoded.exp ? refreshDecoded.exp * 1000 : Date.now() + 30 * 24 * 60 * 60 * 1000;
    await storeRefreshSession({ sid, jti, userId: user.id, isAdmin: user.is_admin === true, expMs: refreshExpMs, req });

    const token = issueAccessToken({ userId: user.id, sid, isAdmin: user.is_admin === true });

    res.status(201).json({
      token,
      refreshToken,
      user: {
        id: user.id,
        username: user.username
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка регистрации' });
  }
}

app.post('/api/auth/email/register', authLimiter, handleEmailRegister);

app.post('/api/auth/email/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email и пароль обязательны' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const emailHash = crypto.createHash('sha256').update(normalizedEmail).digest('hex');

    const lockStatus = await loginLockoutStatus(emailHash);
    if (lockStatus.locked) {
      res.setHeader('Retry-After', String(lockStatus.retryAfter));
      return res.status(429).json({ error: 'Слишком много неудачных попыток. Попробуйте позже.' });
    }

    const user = await dbRequest('GET', `/api/users/email/${emailHash}`);

    if (!user || !user.password_hash) {
      await burnDecoyHash(password);
      await recordLoginFailure(emailHash);
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }

    const computedHash = await hashPassword(password, user.salt);
    let passwordMatch = passwordHashEquals(computedHash, user.password_hash);
    let needsRehash = false;

    if (!passwordMatch) {
      const legacyHash = await hashPassword(password, user.salt, PBKDF2_ITERATIONS_LEGACY);
      if (!passwordHashEquals(legacyHash, user.password_hash)) {
        await recordLoginFailure(emailHash);
        return res.status(401).json({ error: 'Неверный email или пароль' });
      }
      needsRehash = true;
    }

    await clearLoginFailures(emailHash);

    const loginUpdate = { last_login: new Date().toISOString() };
    if (needsRehash) {
      loginUpdate.password_hash = await hashPassword(password, user.salt);
    }
    await dbRequest('PUT', `/api/users/${user.id}`, loginUpdate);

    if (!redisReady || !redisClient) {
      return res.status(503).json({ error: 'Сервис временно недоступен' });
    }

    const sid = crypto.randomBytes(16).toString('hex');
    const jti = crypto.randomBytes(16).toString('hex');
    const refreshToken = issueRefreshToken({ userId: user.id, sid, jti });
    const refreshDecoded = jwt.decode(refreshToken);
    const refreshExpMs = refreshDecoded && refreshDecoded.exp ? refreshDecoded.exp * 1000 : Date.now() + 30 * 24 * 60 * 60 * 1000;
    const isAdmin = user.is_admin === true;
    await storeRefreshSession({ sid, jti, userId: user.id, isAdmin, expMs: refreshExpMs, req });

    const token = issueAccessToken({ userId: user.id, sid, isAdmin });

    let userData = {
      id: user.id,
      username: user.username,
      photoUrl: user.photo_url,
      isAdmin,
      mfaEnabled: user.mfa_enabled === true,
      mfaEnabledAt: user.mfa_enabled_at || null,
      hasPassword: typeof user.password_hash === 'string' && user.password_hash.trim().length > 0,
      hasTelegram: (() => {
        const v = user.telegram_id;
        if (v === null || v === undefined) return false;
        if (typeof v === 'number' && Number.isFinite(v) && v !== 0) return true;
        if (typeof v === 'string' && v.trim() !== '' && v.trim() !== '0') return true;
        return false;
      })(),
    };

    if (user.metadata) {
      try {
        const decrypted = decryptData(JSON.parse(user.metadata), user.salt);
        const safeFirstName = sanitizeProfileField(decrypted.firstName);
        const safeLastName = sanitizeProfileField(decrypted.lastName);
        userData = { ...userData };
        if (safeFirstName) userData.firstName = safeFirstName;
        if (safeLastName) userData.lastName = safeLastName;
      } catch (err) {
        console.error('auth-service: failed to decrypt user metadata on login:', err.message || err);
      }
    }

    await setCachedUserProfile(user.id, userData);

    res.json({
      token,
      refreshToken,
      user: userData
    });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка входа' });
  }
});

app.post('/api/auth/telegram/login', authLimiter, async (req, res) => {
  try {
    if (!TELEGRAM_BOT_TOKEN || String(TELEGRAM_BOT_TOKEN).trim() === '') {
      return res.status(503).json({ error: 'Сервис временно недоступен' });
    }
    if (!redisReady || !redisClient) {
      return res.status(503).json({ error: 'Сервис временно недоступен' });
    }

    const payload = normalizeTelegramAuthPayload(req.body);
    if (!payload) {
      return res.status(400).json({ error: 'Некорректные данные Telegram' });
    }
    if (!verifyTelegramAuth(payload, TELEGRAM_BOT_TOKEN)) {
      return res.status(401).json({ error: 'Недействительная подпись Telegram' });
    }

    let user = await dbRequest('GET', `/api/users/telegram/${payload.id}`);
    const safeFirstName = sanitizeProfileField(payload.first_name);
    const safeLastName = sanitizeProfileField(payload.last_name);
    const normalizedUsername = typeof payload.username === 'string' ? payload.username.trim() : '';
    const safeUsername = normalizedUsername ? normalizedUsername.slice(0, 64).replace(/[<>\r\n]/g, '') : '';

    if (!user) {
      const userSalt = crypto.randomBytes(32).toString('hex');
      const namePayload = safeFirstName || safeLastName ? encryptData({ firstName: safeFirstName, lastName: safeLastName }, userSalt) : null;
      const usernameSeed = safeUsername || `tg_${payload.id}`;
      const username = crypto.createHash('sha256').update(usernameSeed).digest('hex').substring(0, 16);

      user = await dbRequest('POST', '/api/users', {
        email: null,
        email_encrypted: null,
        password_hash: null,
        salt: userSalt,
        username,
        metadata: namePayload ? JSON.stringify(namePayload) : null,
        telegram_id: payload.id,
      });
    } else {
      const updates = { last_login: new Date().toISOString() };
      if (!user.telegram_id) {
        updates.telegram_id = payload.id;
      }

      if (user.salt) {
        const namePayload = safeFirstName || safeLastName ? encryptData({ firstName: safeFirstName, lastName: safeLastName }, user.salt) : null;
        if (namePayload) {
          updates.metadata = JSON.stringify(namePayload);
        }
      }

      await dbRequest('PUT', `/api/users/${user.id}`, updates);
    }

    const sid = crypto.randomBytes(16).toString('hex');
    const jti = crypto.randomBytes(16).toString('hex');
    const refreshToken = issueRefreshToken({ userId: user.id, sid, jti });
    const refreshDecoded = jwt.decode(refreshToken);
    const refreshExpMs = refreshDecoded && refreshDecoded.exp ? refreshDecoded.exp * 1000 : Date.now() + 30 * 24 * 60 * 60 * 1000;
    const isAdmin = user.is_admin === true;
    await storeRefreshSession({ sid, jti, userId: user.id, isAdmin, expMs: refreshExpMs, req });
    const token = issueAccessToken({ userId: user.id, sid, isAdmin });

    let userData = {
      id: user.id,
      username: user.username,
      photoUrl: user.photo_url,
      isAdmin,
      telegramId: payload.id,
      mfaEnabled: user.mfa_enabled === true,
      mfaEnabledAt: user.mfa_enabled_at || null,
      hasPassword: typeof user.password_hash === 'string' && user.password_hash.trim().length > 0,
      hasTelegram: true,
    };

    if (user.metadata) {
      try {
        const decrypted = decryptData(JSON.parse(user.metadata), user.salt);
        const dFirstName = sanitizeProfileField(decrypted.firstName);
        const dLastName = sanitizeProfileField(decrypted.lastName);
        userData = { ...userData };
        if (dFirstName) userData.firstName = dFirstName;
        if (dLastName) userData.lastName = dLastName;
      } catch {
      }
    }

    await setCachedUserProfile(user.id, userData);

    return res.json({ token, refreshToken, user: userData });
  } catch {
    return res.status(500).json({ error: 'Ошибка входа' });
  }
});

app.post('/api/auth/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body || {};
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token обязателен' });
    }

    if (typeof refreshToken !== 'string' || refreshToken.length < 40 || refreshToken.length > 4096) {
      return res.status(400).json({ error: 'Некорректный refresh token' });
    }

    const rotated = await rotateRefreshSession({ refreshToken, req });
    if (!rotated || !rotated.accessToken || !rotated.refreshToken) {
      return res.status(503).json({ error: 'Сервис временно недоступен' });
    }

    return res.json({ accessToken: rotated.accessToken, refreshToken: rotated.refreshToken });
  } catch (error) {
    const st = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0;
    if (st === 401) {
      return res.status(401).json({ error: 'Недействительный refresh token' });
    }
    if (st === 503) {
      return res.status(503).json({ error: 'Сервис временно недоступен' });
    }
    return res.status(503).json({ error: 'Сервис временно недоступен' });
  }
});

app.post('/api/verify', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Токен отсутствует' });
    }

    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    if (decoded && decoded.type && decoded.type !== 'access') {
      return res.status(401).json({ error: 'Недействительный токен' });
    }

    const cachedProfile = await getCachedUserProfile(decoded.userId);
    if (cachedProfile) {
      const isAdmin = await resolveIsAdminFromDb(decoded.userId, cachedProfile.isAdmin === true);
      if (cachedProfile.isAdmin !== isAdmin) {
        const patched = { ...cachedProfile, isAdmin };
        await setCachedUserProfile(decoded.userId, patched);
        return res.json({ valid: true, user: patched });
      }
      return res.json({ valid: true, user: cachedProfile });
    }

    const user = await dbRequest('GET', `/api/users/${decoded.userId}`);

    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const effectiveIsAdmin = await resolveIsAdminFromDb(user.id, user.is_admin === true);

    let userData = {
      id: user.id,
      username: user.username,
      photoUrl: user.photo_url,
      isAdmin: effectiveIsAdmin,
      mfaEnabled: user.mfa_enabled === true,
      mfaEnabledAt: user.mfa_enabled_at || null,
      hasPassword: typeof user.password_hash === 'string' && user.password_hash.trim().length > 0,
      hasTelegram: (() => {
        const v = user.telegram_id;
        if (v === null || v === undefined) return false;
        if (typeof v === 'number' && Number.isFinite(v) && v !== 0) return true;
        if (typeof v === 'string' && v.trim() !== '' && v.trim() !== '0') return true;
        return false;
      })(),
    };

    if (user.salt && user.metadata) {
      try {
        const decrypted = decryptData(JSON.parse(user.metadata), user.salt);
        const safeFirstName = sanitizeProfileField(decrypted.firstName);
        const safeLastName = sanitizeProfileField(decrypted.lastName);
        if (safeFirstName) userData.firstName = safeFirstName;
        if (safeLastName) userData.lastName = safeLastName;
      } catch (err) {
        console.error('auth-service: failed to decrypt user metadata during token verification:', err.message || err);
      }
    }

    await setCachedUserProfile(user.id, userData);

    res.json({
      valid: true,
      user: userData
    });
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Недействительный токен' });
    }
    res.status(500).json({ error: 'Ошибка проверки токена' });
  }
});

app.get('/api/profile', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'Токен отсутствует' });
    }

    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    if (!decoded || decoded.type !== 'access') {
      return res.status(401).json({ error: 'Недействительный токен' });
    }

    const bustCache = String(req.query?.bustCache || '').trim();
    const shouldBustCache = bustCache === '1' || bustCache.toLowerCase() === 'true';

    const cachedProfile = shouldBustCache ? null : await getCachedUserProfile(decoded.userId);
    const cacheHasSecurityFields = cachedProfile
      && Object.prototype.hasOwnProperty.call(cachedProfile, 'hasPassword')
      && Object.prototype.hasOwnProperty.call(cachedProfile, 'hasTelegram');
    if (cachedProfile && cacheHasSecurityFields) {
      const isAdmin = await resolveIsAdminFromDb(decoded.userId, cachedProfile.isAdmin === true);
      if (cachedProfile.isAdmin !== isAdmin) {
        const patched = { ...cachedProfile, isAdmin };
        await setCachedUserProfile(decoded.userId, patched);
        return res.json(patched);
      }
      return res.json(cachedProfile);
    }

    const user = await dbRequest('GET', `/api/users/${decoded.userId}`);

    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const effectiveIsAdmin = await resolveIsAdminFromDb(user.id, user.is_admin === true);

    let userData = {
      id: user.id,
      username: user.username,
      createdAt: user.created_at,
      lastLogin: user.last_login,
      photoUrl: user.photo_url,
      isAdmin: effectiveIsAdmin,
      mfaEnabled: user.mfa_enabled === true,
      mfaEnabledAt: user.mfa_enabled_at || null,
      hasPassword: typeof user.password_hash === 'string' && user.password_hash.trim().length > 0,
      hasTelegram: (() => {
        const v = user.telegram_id;
        if (v === null || v === undefined) return false;
        if (typeof v === 'number' && Number.isFinite(v) && v !== 0) return true;
        if (typeof v === 'string' && v.trim() !== '' && v.trim() !== '0') return true;
        return false;
      })(),
    };

    const emailRaw = typeof user.email === 'string' ? user.email.trim() : '';
    if (emailRaw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
      userData.email = emailRaw;
    }

    if (user.salt && user.metadata) {
      try {
        const decrypted = decryptData(JSON.parse(user.metadata), user.salt);
        userData = { ...userData, ...decrypted };
      } catch (err) {
        console.error('auth-service: failed to decrypt user metadata for profile:', err.message || err);
      }
    }

    if (!userData.email && user.salt && user.email_encrypted) {
      try {
        const decrypted = decryptData(JSON.parse(user.email_encrypted), user.salt);
        const email = typeof decrypted?.value === 'string' ? decrypted.value.trim() : '';
        if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          userData.email = email;

          const looksHashed = /^[a-f0-9]{64}$/i.test(emailRaw);
          const hasHash = typeof user.email_hash === 'string' && user.email_hash.trim();
          if (looksHashed || !hasHash) {
            try {
              const emailHash = crypto.createHash('sha256').update(email.toLowerCase()).digest('hex');
              await dbRequest('PUT', `/api/users/${user.id}`, {
                email,
                email_hash: emailHash,
                email_encrypted: null,
              });
            } catch {
            }
          }
        }
      } catch (err) {
        console.error('auth-service: failed to decrypt user email for profile:', err.message || err);
      }
    }

    await setCachedUserProfile(user.id, userData);

    res.json(userData);
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Недействительный токен' });
    }
    res.status(500).json({ error: 'Ошибка получения профиля' });
  }
});

// Error handler (безопасный для продакшена)
app.use((err, req, res, next) => {
  // Логируем безопасно (без чувствительных данных)
  console.error('Auth error:', {
    message: err.message,
    code: err.code,
    path: req.path,
    method: req.method,
    stack: isProduction ? undefined : err.stack
  });

  // Не раскрываем детали в продакшене
  res.status(500).json({
    error: isProduction ? 'Внутренняя ошибка сервера' : err.message,
    code: 'INTERNAL_ERROR'
  });
});

// ============================================================================
// SERVER STARTUP WITH GRACEFUL SHUTDOWN
// ============================================================================
const server = app.listen(PORT, () => {
  console.log(`🔐 Auth Service running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔒 Security: JWT expiry ${JWT_EXPIRES_IN}, Profile cache ${PROFILE_CACHE_TTL}s`);
});

let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`\n${signal} received, starting graceful shutdown...`);

  // Stop accepting new connections
  server.close(async () => {
    console.log('HTTP server closed');

    try {
      // Close Redis connection
      if (redisClient) {
        await redisClient.quit();
        console.log('Redis connection closed');
      }

      // Clear reconnect timer
      if (redisReconnectTimer) {
        clearTimeout(redisReconnectTimer);
      }

      console.log('✅ Graceful shutdown completed');
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown:', err);
      process.exit(1);
    }
  });

  // Force shutdown after 30 seconds
  setTimeout(() => {
    console.error('⚠️ Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
