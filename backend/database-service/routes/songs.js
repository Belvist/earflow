const express = require('express');
const router = express.Router();
const db = require('../database/db');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const path = require('path');
const { mapSongListCompactDto } = require('../lib/dto/songs');
const { resamplePeaks, parseStoredPeaks } = require('../lib/waveform');

let schemaCapabilitiesPromise = null;
let schemaCapabilitiesExpiresAt = 0;

function parseRateLimitMultiplier() {
  const raw = String(process.env.DATABASE_SERVICE_RATE_LIMIT_MULTIPLIER || process.env.LOAD_TEST_RATE_LIMIT_MULTIPLIER || '').trim();
  if (!raw) return String(process.env.LOAD_TEST_MODE || '').trim().toLowerCase() === 'true' ? 30 : 1;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 100);
}

const rateLimitMultiplier = parseRateLimitMultiplier();

function scaledRateLimit(base) {
  return Math.max(base, Math.min(base * rateLimitMultiplier, 100000));
}

function normalizeShortText(v, maxLen) {
  if (v === undefined || v === null) return null;
  const s = String(v).normalize('NFC').trim();
  if (!s) return null;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function normalizeRelativePosixPath(v, maxLen) {
  if (v === undefined || v === null) return null;
  const raw = String(v).replace(/\\/g, '/').trim();
  if (!raw || raw.length > maxLen) return null;
  if (raw.includes('\u0000')) return null;
  const normalized = path.posix.normalize(raw);
  if (!normalized || normalized === '.' || normalized === '..') return null;
  if (path.posix.isAbsolute(normalized)) return null;
  if (normalized.startsWith('../') || normalized.includes('/../') || normalized.endsWith('/..')) return null;
  return normalized;
}

function normalizeOptionalNumber(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function requireService(allowed) {
  const allow = Array.isArray(allowed) ? allowed : [];
  return (req, res, next) => {
    const name = req && req.service ? req.service.name : null;
    if (!name) {
      return res.status(401).json({ error: 'Отсутствует аутентификация сервиса', code: 'NO_SERVICE_AUTH' });
    }
    if (!allow.includes(name)) {
      return res.status(403).json({ error: 'Сервис не авторизован для этого действия', code: 'SERVICE_FORBIDDEN' });
    }
    return next();
  };
}

function readBearerToken(req) {
  const raw = req && req.headers ? req.headers.authorization : null;
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(/^Bearer\s+(.+)$/i);
  const token = m && m[1] ? String(m[1]).trim() : '';
  return token ? token : null;
}

function safeEqualString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function requireAdminToken(req, res, next) {
  const expected = process.env.SONGS_ADMIN_TOKEN ? String(process.env.SONGS_ADMIN_TOKEN).trim() : '';
  if (!expected) {
    return res.status(503).json({ error: 'Admin token is not configured', code: 'ADMIN_TOKEN_MISSING' });
  }

  const headerTokenRaw = req && req.headers ? req.headers['x-admin-token'] : null;
  const headerToken = headerTokenRaw ? String(headerTokenRaw).trim() : null;
  const bearer = readBearerToken(req);
  const provided = headerToken || bearer;

  if (!provided || !safeEqualString(provided, expected)) {
    return res.status(401).json({ error: 'Unauthorized', code: 'ADMIN_UNAUTHORIZED' });
  }

  return next();
}

function isSensitiveAllowed(req) {
  const name = req && req.service ? req.service.name : null;
  return name === 'upload-service' || name === 'track-processor';
}

function stripSensitiveSongFields(song) {
  if (!song || typeof song !== 'object') return song;
  const {
    file_path,
    file_size,
    mime_type,
    file_hash,
    audioUrl,
    filePath,
    uploader_id,
    ...rest
  } = song;
  return rest;
}

async function getSchemaCapabilities() {
  const now = Date.now();
  if (!schemaCapabilitiesPromise || now >= schemaCapabilitiesExpiresAt) {
    schemaCapabilitiesPromise = (async () => {
      const result = await db.query(
        `SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'songs'`
      );
      const columns = new Set((result.rows || []).map((r) => r.column_name));
      schemaCapabilitiesExpiresAt = Date.now() + 5 * 60 * 1000;
      return {
        hasFileHash: columns.has('file_hash'),
        hasIsAvailable: columns.has('is_available'),
        hasEbapReadyFlag: columns.has('has_ebap'),
        hasEbapStatus: columns.has('ebap_status'),
        hasEbapError: columns.has('ebap_error'),
        hasHlsReadyFlag: columns.has('has_hls'),
        hasHlsStatus: columns.has('hls_status'),
        hasHlsError: columns.has('hls_error'),
        hasWaveformPeaks: columns.has('waveform_peaks'),
        hasWaveformBars: columns.has('waveform_bars'),
        hasWaveformStatus: columns.has('waveform_status'),
      };
    })().catch((error) => {
      schemaCapabilitiesPromise = null;
      schemaCapabilitiesExpiresAt = 0;
      console.error('❌ Ошибка чтения схемы songs из information_schema:', error);
      const e = new Error('Schema capabilities unavailable');
      e.code = 'SCHEMA_UNAVAILABLE';
      throw e;
    });
  }
  return schemaCapabilitiesPromise;
}

router.get('/', requireService(['api-gateway']), async (req, res) => {
  try {
    const { hasIsAvailable, hasEbapReadyFlag } = await getSchemaCapabilities();

    const view = (req.query.view ?? '').toString().trim().toLowerCase();
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '200'), 10) || 200, 1), 1000);
    const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
    const offset = (page - 1) * limit;

    const userIdHeaderRaw = req.headers['x-user-id'];
    const userIdQueryRaw = req.query.userId;
    const userIdCandidate = userIdHeaderRaw != null ? userIdHeaderRaw : userIdQueryRaw;
    const parsedUserId = userIdCandidate != null && String(userIdCandidate).trim() !== ''
      ? parseInt(String(userIdCandidate), 10)
      : null;
    const userId = Number.isFinite(parsedUserId) && parsedUserId > 0 ? parsedUserId : null;

    const includeUnavailable = String(req.query.includeUnavailable || 'false') === 'true';
    const availabilityClause = (hasIsAvailable && !includeUnavailable) ? ' AND is_available = true' : '';
    const availabilityField = hasIsAvailable ? 'is_available' : 'true as is_available';
    const ebapField = hasEbapReadyFlag ? 'has_ebap' : 'false as has_ebap';

    const rawSearch = (req.query.search ?? req.query.q ?? '').toString();
    const search = rawSearch.normalize('NFC').trim().toLowerCase().slice(0, 100);

    const params = [];
    let where = `WHERE 1=1${availabilityClause}`;

    if (userId) {
      params.push(userId);
      where += ` AND uploader_id = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      where += ` AND (LOWER(title) LIKE $${params.length} OR LOWER(artist) LIKE $${params.length} OR LOWER(album) LIKE $${params.length} OR LOWER(COALESCE(genre, '')) LIKE $${params.length})`;
    }

    params.push(limit);
    params.push(offset);

    const result = await db.query(
      `SELECT id, uploader_id as user_id, title, artist, album, duration, genre, year,
               cover_path, ${availabilityField}, ${ebapField}, created_at, updated_at
          FROM songs
          ${where}
          ORDER BY created_at DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const rows = result.rows || [];
    if (view === 'compact') {
      return res.json(mapSongListCompactDto(rows));
    }
    return res.json(rows.map(stripSensitiveSongFields));
  } catch (error) {
    console.error('❌ Ошибка получения списка песен:', error);
    if (error && error.code === 'SCHEMA_UNAVAILABLE') {
      return res.status(503).json({ error: 'Схема базы данных недоступна', code: 'SCHEMA_UNAVAILABLE' });
    }
    return res.status(500).json({ error: 'Ошибка получения песен' });
  }
});

/**
 * GET /api/songs/recommendations — DEPRECATED (2026-06-23)
 * Use POST /api/recommendations/init via recommendations-service.
 */
const recommendationsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: scaledRateLimit(60),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const user = req.headers['x-user-id'] || req.query.userId || '';
    return `${req.service ? req.service.name : 'unknown'}:${user}`;
  },
  message: { error: 'Too many requests', code: 'RATE_LIMITED' },
});

router.get('/recommendations', requireService(['api-gateway']), recommendationsLimiter, async (req, res) => {
  return res.status(410).json({
    error: 'Legacy recommendations endpoint removed',
    code: 'RECO_LEGACY_DEPRECATED',
    replacement: 'POST /api/recommendations/init',
  });
});

/**
 * GET /api/songs/search/:query
 * Улучшенный поиск песен с поддержкой:
 * - Поиска по первым буквам (prefix search)
 * - Поиска по артисту и названию
 * - Ранжирования результатов по релевантности
 */
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: scaledRateLimit(120),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const user = req.headers['x-user-id'] || req.query.userId || '';
    return `${req.service ? req.service.name : 'unknown'}:${user}`;
  },
  message: { error: 'Too many requests', code: 'RATE_LIMITED' },
});

router.get('/search/:query', requireService(['api-gateway']), searchLimiter, async (req, res) => {
  try {
    const rawQuery = req.params.query || '';
    const { userId, limit = 50 } = req.query;

    // Санитизация и нормализация запроса
    const query = rawQuery
      .trim()
      .toLowerCase()
      .replace(/[<>&"'\\]/g, '') // Удаляем опасные символы
      .substring(0, 100); // Ограничиваем длину

    if (!query || query.length === 0) {
      return res.json([]);
    }

    const safeLimit = Math.min(parseInt(limit, 10) || 50, 100);

    let parsedUserId = null;
    if (userId !== undefined && userId !== null && String(userId).trim() !== '') {
      const n = parseInt(String(userId), 10);
      if (!Number.isFinite(n) || n <= 0) {
        return res.status(400).json({ error: 'Некорректный userId' });
      }
      parsedUserId = n;
    }

    const { hasIsAvailable, hasEbapReadyFlag } = await getSchemaCapabilities();
    const view = (req.query.view ?? '').toString().trim().toLowerCase();
    const availabilityWhere = hasIsAvailable ? ' AND is_available = true' : '';
    const ebapSelect = hasEbapReadyFlag ? 'has_ebap' : 'false as has_ebap';

    // Улучшенный поиск с ранжированием:
    // 1. Точное совпадение в начале title/artist (prefix) - высший приоритет
    // 2. Совпадение где угодно - ниже приоритет
    const sql = `
      SELECT id, uploader_id as user_id, title, artist, album, duration, genre, year,
             cover_path, ${ebapSelect}, created_at, updated_at,
             CASE
               -- Точное совпадение в начале title
               WHEN LOWER(title) LIKE $1 || '%' THEN 100
               -- Точное совпадение в начале artist
               WHEN LOWER(artist) LIKE $1 || '%' THEN 90
               -- Title содержит слово начинающееся с запроса
               WHEN LOWER(title) LIKE '% ' || $1 || '%' THEN 80
               -- Artist содержит слово начинающееся с запроса
               WHEN LOWER(artist) LIKE '% ' || $1 || '%' THEN 70
               -- Содержит где-то в title
               WHEN LOWER(title) LIKE '%' || $1 || '%' THEN 60
               -- Содержит где-то в artist
               WHEN LOWER(artist) LIKE '%' || $1 || '%' THEN 50
               -- Содержит в album
               WHEN LOWER(album) LIKE '%' || $1 || '%' THEN 40
               ELSE 0
             END as relevance
      FROM songs 
      WHERE (
        LOWER(title) LIKE '%' || $1 || '%' 
        OR LOWER(artist) LIKE '%' || $1 || '%'
        OR LOWER(album) LIKE '%' || $1 || '%'
      )
      ${parsedUserId ? 'AND uploader_id = $2' : ''}${availabilityWhere}
      ORDER BY relevance DESC, created_at DESC
      LIMIT $${parsedUserId ? 3 : 2}
    `;

    const params = parsedUserId ? [query, parsedUserId, safeLimit] : [query, safeLimit];
    const result = await db.query(sql, params);

    const rows = result.rows || [];
    if (view === 'compact') {
      return res.json(mapSongListCompactDto(rows));
    }

    const songs = rows.map(({ relevance, ...song }) => song);
    return res.json(songs);
  } catch (error) {
    console.error('❌ Ошибка поиска песен:', error);
    if (error && error.code === 'SCHEMA_UNAVAILABLE') {
      return res.status(503).json({ error: 'Схема базы данных недоступна', code: 'SCHEMA_UNAVAILABLE' });
    }
    return res.status(500).json({ error: 'Ошибка поиска песен' });
  }
});

router.get('/lookup', requireService(['track-processor', 'upload-service']), async (req, res) => {
  try {
    const { title, artist, userId } = req.query;
    const normalizedTitle = normalizeShortText(title, 200);
    const normalizedArtist = normalizeShortText(artist, 200);
    if (!normalizedTitle || !normalizedArtist) {
      return res.status(400).json({ error: 'title и artist обязательны', code: 'MISSING_PARAMS' });
    }

    const parsedUserId = userId ? parseInt(String(userId), 10) : null;

    let sql = `
      SELECT id, uploader_id as user_id, title, artist, album, duration, genre, year,
             file_path, file_size, mime_type, cover_path, created_at, updated_at
      FROM songs
      WHERE LOWER(title) = $1 AND LOWER(artist) = $2
    `;
    const params = [normalizedTitle.toLowerCase(), normalizedArtist.toLowerCase()];

    if (parsedUserId && Number.isFinite(parsedUserId) && parsedUserId > 0) {
      params.push(parsedUserId);
      sql += ` AND uploader_id = $${params.length}`;
    }

    sql += ' LIMIT 1';

    const result = await db.query(sql, params);
    const rows = result.rows || [];
    return res.json(rows);
  } catch (error) {
    console.error('❌ Ошибка lookup песни:', error);
    return res.status(500).json({ error: 'Ошибка поиска песни' });
  }
});

router.post('/', requireService(['track-processor', 'upload-service']), async (req, res) => {
  try {
    const {
      title,
      artist,
      album,
      year,
      genre,
      duration,
      file_path,
      file_size,
      mime_type,
      user_id,
      cover_path,
      file_hash
    } = req.body;

    const normalizedTitle = normalizeShortText(title, 200);
    const normalizedArtist = normalizeShortText(artist, 200);
    const normalizedAlbum = normalizeShortText(album, 200);
    const normalizedGenre = normalizeShortText(genre, 64);
    const normalizedFilePath = normalizeRelativePosixPath(file_path, 512);
    const normalizedCoverPath = normalizeRelativePosixPath(cover_path, 512);
    const normalizedMimeType = normalizeShortText(mime_type, 96);

    if (!normalizedTitle || !normalizedArtist || !normalizedFilePath || !user_id) {
      return res.status(400).json({
        error: 'title, artist, file_path и user_id обязательны',
        code: 'MISSING_PARAMS'
      });
    }

    if (normalizedMimeType && !normalizedMimeType.includes('/')) {
      return res.status(400).json({ error: 'Некорректный mime_type', code: 'INVALID_MIME_TYPE' });
    }

    const parsedUserId = parseInt(String(user_id), 10);
    if (!Number.isFinite(parsedUserId) || parsedUserId <= 0) {
      return res.status(400).json({ error: 'Некорректный user_id', code: 'INVALID_USER_ID' });
    }

    const durationNumber = normalizeOptionalNumber(duration);
    const durationSeconds = durationNumber !== null ? Math.max(0, Math.min(durationNumber, 24 * 60 * 60)) : null;
    const yearNumber = normalizeOptionalNumber(year);
    const safeYear = yearNumber !== null ? Math.trunc(yearNumber) : null;
    if (safeYear !== null && (safeYear < 1800 || safeYear > 2200)) {
      return res.status(400).json({ error: 'Некорректный year', code: 'INVALID_YEAR' });
    }

    const fileSizeNumber = normalizeOptionalNumber(file_size);
    const safeFileSize = fileSizeNumber !== null ? Math.max(0, Math.trunc(fileSizeNumber)) : null;

    const { hasFileHash, hasIsAvailable, hasEbapReadyFlag, hasEbapStatus } = await getSchemaCapabilities();

    const columns = ['title', 'artist', 'uploader_id', 'file_path'];
    const values = [normalizedTitle, normalizedArtist, parsedUserId, normalizedFilePath];

    if (normalizedAlbum) {
      columns.push('album');
      values.push(normalizedAlbum);
    }
    if (safeYear !== null) {
      columns.push('year');
      values.push(safeYear);
    }
    if (normalizedGenre) {
      columns.push('genre');
      values.push(normalizedGenre);
    }
    if (durationSeconds !== null) {
      columns.push('duration');
      values.push(durationSeconds);
    }
    if (safeFileSize !== null) {
      columns.push('file_size');
      values.push(safeFileSize);
    }
    if (normalizedMimeType) {
      columns.push('mime_type');
      values.push(normalizedMimeType);
    }
    if (normalizedCoverPath) {
      columns.push('cover_path');
      values.push(normalizedCoverPath);
    }
    if (file_hash && hasFileHash) {
      const h = normalizeShortText(file_hash, 128);
      if (h) {
        columns.push('file_hash');
        values.push(h);
      }
    }
    if (hasIsAvailable) {
      columns.push('is_available');
      values.push(true);
    }
    if (hasEbapReadyFlag) {
      columns.push('has_ebap');
      values.push(false);
    }
    if (hasEbapStatus) {
      columns.push('ebap_status');
      values.push('pending');
    }

    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `
      INSERT INTO songs (${columns.join(', ')})
      VALUES (${placeholders})
      RETURNING id, uploader_id as user_id, title, artist, album, duration, genre, year,
                file_path, file_size, mime_type, cover_path, created_at, updated_at
    `;

    const result = await db.query(sql, values);
    if (result.rows && result.rows.length > 0) {
      return res.status(201).json(result.rows[0]);
    }
    return res.status(500).json({ error: 'Не удалось создать запись', code: 'INSERT_FAILED' });
  } catch (error) {
    console.error('❌ Ошибка создания песни:', error);
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Трек уже существует', code: 'DUPLICATE' });
    }
    return res.status(500).json({ error: 'Ошибка создания песни' });
  }
});

const radioLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: scaledRateLimit(30),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const user = req.headers['x-user-id'] || req.query.userId || '';
    return `${req.service ? req.service.name : 'unknown'}:radio:${user}`;
  },
  message: { error: 'Too many requests', code: 'RATE_LIMITED' },
});

router.get('/radio', requireService(['api-gateway']), radioLimiter, async (req, res) => {
  try {
    const artistRaw = normalizeShortText(req.query.artist, 255);
    if (!artistRaw) {
      return res.status(400).json({ error: 'artist is required', code: 'MISSING_ARTIST' });
    }
    const artistLower = artistRaw.toLowerCase();

    const userIdRaw = req.query.userId != null ? String(req.query.userId).trim() : '';
    let userId = null;
    if (userIdRaw) {
      const parsed = Number.parseInt(userIdRaw, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return res.status(400).json({ error: 'Invalid userId', code: 'INVALID_USER_ID' });
      }
      userId = parsed;
    }

    const limitRaw = Number.parseInt(String(req.query.limit ?? ''), 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 30;

    const excludeCsv = (req.query.exclude || '').toString();
    const excludeIds = excludeCsv
      .split(',')
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);

    const { hasIsAvailable } = await getSchemaCapabilities();
    const availClause = hasIsAvailable ? ' AND s.is_available = true' : '';

    const params = [artistLower];
    let excludeClause = '';
    if (excludeIds.length > 0) {
      const ph = excludeIds.map((_, i) => `$${params.length + i + 1}`).join(',');
      excludeClause = ` AND s.id NOT IN (${ph})`;
      params.push(...excludeIds);
    }

    let dislikeClause = '';
    if (userId) {
      params.push(userId);
      dislikeClause = ` AND s.id NOT IN (SELECT song_id FROM dislikes WHERE user_id = $${params.length})`;
    }

    params.push(limit);
    const limitIdx = params.length;

    const sql = `
      WITH artist_genres AS (
        SELECT DISTINCT LOWER(TRIM(genre)) AS g
        FROM songs
        WHERE LOWER(TRIM(artist)) = $1
          AND genre IS NOT NULL AND TRIM(genre) != ''
          ${hasIsAvailable ? 'AND is_available = true' : ''}
        LIMIT 5
      )
      SELECT s.id, s.uploader_id AS user_id, s.title, s.artist, s.album,
             s.duration, s.genre, s.year, s.cover_path, s.created_at, s.updated_at
      FROM songs s
      INNER JOIN artist_genres ag ON LOWER(TRIM(s.genre)) = ag.g
      WHERE LOWER(TRIM(s.artist)) != $1
        ${availClause}
        ${excludeClause}
        ${dislikeClause}
      ORDER BY (ln(GREATEST(COALESCE(s.popularity, 0), 1)) + random() * 4) DESC
      LIMIT $${limitIdx}
    `;

    const result = await db.query(sql, params);
    const rows = (result.rows || []).map(stripSensitiveSongFields);
    return res.json(rows);
  } catch (error) {
    console.error('❌ Radio endpoint error:', error);
    if (error?.code === 'SCHEMA_UNAVAILABLE') {
      return res.status(503).json({ error: 'Schema unavailable', code: 'SCHEMA_UNAVAILABLE' });
    }
    return res.status(500).json({ error: 'Radio error' });
  }
});

router.get('/:id/waveform', requireService(['api-gateway']), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'Некорректный id', code: 'INVALID_ID' });
    }

    const caps = await getSchemaCapabilities();
    if (!caps.hasWaveformPeaks || !caps.hasWaveformStatus) {
      return res.status(503).json({ error: 'Waveform schema unavailable', code: 'SCHEMA_UNAVAILABLE' });
    }

    const barsRaw = parseInt(String(req.query.bars ?? '128'), 10);
    const bars = Math.min(512, Math.max(32, Number.isFinite(barsRaw) ? barsRaw : 128));

    const { hasIsAvailable } = caps;
    const includeUnavailable = String(req.query.includeUnavailable || 'false') === 'true';
    const availabilityClause = (hasIsAvailable && !includeUnavailable) ? ' AND is_available = true' : '';

    const result = await db.query(
      `SELECT waveform_peaks, waveform_bars, waveform_status
         FROM songs
        WHERE id = $1${availabilityClause}
        LIMIT 1`,
      [id],
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Трек не найден', code: 'NOT_FOUND' });
    }

    const row = result.rows[0];
    const status = String(row.waveform_status || 'none');
    const stored = parseStoredPeaks(row.waveform_peaks);

    if (!stored || !stored.length) {
      return res.json({
        songId: id,
        status: status === 'done' ? 'none' : status,
        bars,
        peaks: null,
      });
    }

    const peaks = resamplePeaks(stored, bars);
    return res.json({
      songId: id,
      status: 'ready',
      bars: peaks.length,
      storedBars: Number(row.waveform_bars) || stored.length,
      peaks,
    });
  } catch (error) {
    console.error('❌ Ошибка waveform:', error);
    if (error && error.code === 'SCHEMA_UNAVAILABLE') {
      return res.status(503).json({ error: 'Schema unavailable', code: 'SCHEMA_UNAVAILABLE' });
    }
    return res.status(500).json({ error: 'Waveform error' });
  }
});

// DECISIONS 2026-08-11 Step 2: Public-ID based song resolver. Accepts either
// raw numeric id (legacy path) OR a 16-char hex public_id (new opaque format).
// This lets prerender / share urls reference songs without exposing the
// serial id to the outside world.
router.get('/by-public-id/:publicId', requireService(['api-gateway']), async (req, res) => {
  try {
    const publicId = String(req.params.publicId || '').trim().toLowerCase();
    // Public IDs are 16-char hex string, generated by the DB default.
    if (!/^[0-9a-f]{16}$/.test(publicId)) {
      return res.status(400).json({ error: 'Invalid public id format', code: 'INVALID_ID' });
    }
    const { hasIsAvailable } = await getSchemaCapabilities();
    const includeUnavailable = String(req.query.includeUnavailable || 'false') === 'true';
    const availabilityClause = (hasIsAvailable && !includeUnavailable) ? ' AND is_available = true' : '';
    const availabilityField = hasIsAvailable ? 'is_available' : 'true as is_available';
    const ebapField = hasEbapReadyFlag ? 'has_ebap' : 'false as has_ebap';
    const result = await db.query(
      `SELECT id, uploader_id as user_id, title, artist, album, duration, genre, year,
              cover_path, ${availabilityField}, ${ebapField}, created_at, updated_at
         FROM songs
        WHERE public_id = $1${availabilityClause}
        LIMIT 1`,
      [publicId],
    );
    const rows = result.rows || [];
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Трек не найден', code: 'NOT_FOUND' });
    }
    return res.json(rows[0]);
  } catch (error) {
    console.error('❌ Ошибка публичного резолва по public_id:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', requireService(['api-gateway']), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'Некорректный id', code: 'INVALID_ID' });
    }

    const { hasIsAvailable, hasEbapReadyFlag } = await getSchemaCapabilities();
    const includeUnavailable = String(req.query.includeUnavailable || 'false') === 'true';
    const availabilityClause = (hasIsAvailable && !includeUnavailable) ? ' AND is_available = true' : '';
    const availabilityField = hasIsAvailable ? 'is_available' : 'true as is_available';
    const ebapField = hasEbapReadyFlag ? 'has_ebap' : 'false as has_ebap';

    const result = await db.query(
      `SELECT id, uploader_id as user_id, title, artist, album, duration, genre, year,
              cover_path, ${availabilityField}, ${ebapField}, created_at, updated_at
         FROM songs
        WHERE id = $1${availabilityClause}
        LIMIT 1`,
      [id]
    );

    const rows = result.rows || [];
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Трек не найден', code: 'NOT_FOUND' });
    }

    return res.json(stripSensitiveSongFields(rows[0]));
  } catch (error) {
    console.error('❌ Ошибка получения песни по id:', error);
    if (error && error.code === 'SCHEMA_UNAVAILABLE') {
      return res.status(503).json({ error: 'Схема базы данных недоступна', code: 'SCHEMA_UNAVAILABLE' });
    }
    return res.status(500).json({ error: 'Ошибка получения песни' });
  }
});

router.put('/:id', requireService(['track-processor', 'upload-service']), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'Некорректный id', code: 'INVALID_ID' });
    }

    const parsedUserId = req.body && req.body.user_id ? parseInt(String(req.body.user_id), 10) : null;
    if (!parsedUserId || !Number.isFinite(parsedUserId) || parsedUserId <= 0) {
      return res.status(400).json({ error: 'Некорректный user_id', code: 'INVALID_USER_ID' });
    }

    const { hasFileHash } = await getSchemaCapabilities();

    const fields = [];
    const values = [id, parsedUserId];
    const push = (column, value) => {
      values.push(value);
      fields.push(`${column} = $${values.length}`);
    };

    const t = normalizeShortText(req.body.title, 200);
    const a = normalizeShortText(req.body.artist, 200);
    const al = normalizeShortText(req.body.album, 200);
    const g = normalizeShortText(req.body.genre, 64);
    const mt = normalizeShortText(req.body.mime_type, 96);
    const fp = normalizeRelativePosixPath(req.body.file_path, 512);
    const cp = normalizeRelativePosixPath(req.body.cover_path, 512);
    const durN = normalizeOptionalNumber(req.body.duration);
    const dur = durN !== null ? Math.max(0, Math.min(durN, 24 * 60 * 60)) : null;
    const yN = normalizeOptionalNumber(req.body.year);
    const y = yN !== null ? Math.trunc(yN) : null;
    const fsN = normalizeOptionalNumber(req.body.file_size);
    const fsSafe = fsN !== null ? Math.max(0, Math.trunc(fsN)) : null;

    if (t) push('title', t);
    if (a) push('artist', a);
    if (al !== null) push('album', al);
    if (g !== null) push('genre', g);
    if (dur !== null) push('duration', dur);
    if (fsSafe !== null) push('file_size', fsSafe);
    if (mt !== null) {
      if (mt && !mt.includes('/')) {
        return res.status(400).json({ error: 'Некорректный mime_type', code: 'INVALID_MIME_TYPE' });
      }
      push('mime_type', mt);
    }
    if (fp) push('file_path', fp);
    if (cp !== null) push('cover_path', cp);
    if (y !== null) {
      if (y < 1800 || y > 2200) {
        return res.status(400).json({ error: 'Некорректный year', code: 'INVALID_YEAR' });
      }
      push('year', y);
    }
    if (hasFileHash && req.body.file_hash) {
      const h = normalizeShortText(req.body.file_hash, 128);
      if (h) push('file_hash', h);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'Нет полей для обновления', code: 'NO_FIELDS' });
    }

    const sql = `
      UPDATE songs
         SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $1 AND uploader_id = $2
   RETURNING id, uploader_id as user_id, title, artist, album, duration, genre, year,
             file_path, file_size, mime_type, cover_path, created_at, updated_at
    `;
    const result = await db.query(sql, values);
    const rows = result.rows || [];
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Трек не найден', code: 'NOT_FOUND' });
    }
    return res.json(rows[0]);
  } catch (error) {
    console.error('❌ Ошибка обновления песни:', error);
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Трек уже существует', code: 'DUPLICATE' });
    }
    return res.status(500).json({ error: 'Ошибка обновления песни' });
  }
});

module.exports = router;
