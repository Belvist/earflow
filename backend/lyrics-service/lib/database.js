'use strict';

const { Pool } = require('pg');
const pino = require('pino');

const logger = pino({ level: 'error' });

// ============================================================================
// DATABASE CONNECTION
// ============================================================================

function parseIntEnv(name, fallback, { min = 1, max = 200 } = {}) {
  const raw = process.env[name];
  const value = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

const pool = new Pool({
  host: process.env.DB_HOST || 'postgres',
  port: Number.parseInt(String(process.env.DB_PORT || ''), 10) || 5432,
  database: process.env.DB_NAME || 'music_platform',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: parseIntEnv('DB_MAX_CONNECTIONS', 20),
  min: parseIntEnv('DB_MIN_CONNECTIONS', 0, { min: 0, max: 50 }),
  idleTimeoutMillis: parseIntEnv('DB_IDLE_TIMEOUT_MS', 30000, { min: 1000, max: 300000 }),
  connectionTimeoutMillis: parseIntEnv('DB_CONNECTION_TIMEOUT_MS', 5000, { min: 500, max: 60000 })
});

function parsePositiveInt(value) {
  const n = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

pool.on('error', (err) => {
  logger.error({ err }, 'pg_pool_error');
});

// ============================================================================
// SCHEMA INITIALIZATION
// ============================================================================

async function initialize() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Таблица текстов песен
    await client.query(`
      CREATE TABLE IF NOT EXISTS lyrics (
        id SERIAL PRIMARY KEY,
        song_id INTEGER NOT NULL UNIQUE,
        language VARCHAR(5) DEFAULT 'ru',
        plain_text TEXT,
        synced_lines JSONB NOT NULL DEFAULT '[]',
        created_by INTEGER,
        updated_by INTEGER,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    await client.query(`
      ALTER TABLE lyrics
        ADD COLUMN IF NOT EXISTS source VARCHAR(32),
        ADD COLUMN IF NOT EXISTS external_provider VARCHAR(32),
        ADD COLUMN IF NOT EXISTS external_id TEXT,
        ADD COLUMN IF NOT EXISTS external_fetched_at TIMESTAMP WITH TIME ZONE
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS lyrics_external_cache (
        song_id INTEGER NOT NULL PRIMARY KEY,
        provider VARCHAR(32) NOT NULL,
        status VARCHAR(16) NOT NULL,
        last_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        retry_after_at TIMESTAMP WITH TIME ZONE,
        last_error TEXT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);

    // Индексы для быстрого поиска
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_lyrics_song_id ON lyrics(song_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_lyrics_plain_text 
      ON lyrics USING gin(to_tsvector('russian', plain_text))
    `);

    // Таблица жалоб на тексты
    await client.query(`
      CREATE TABLE IF NOT EXISTS lyrics_reports (
        id SERIAL PRIMARY KEY,
        song_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        reason TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        resolved_at TIMESTAMP WITH TIME ZONE,
        UNIQUE(song_id, user_id)
      )
    `);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getSongUploaderId(songId) {
  const id = parsePositiveInt(songId);
  if (!id) return null;
  const result = await pool.query('SELECT uploader_id FROM songs WHERE id = $1', [id]);
  const uploaderId = result.rows && result.rows[0] ? parsePositiveInt(result.rows[0].uploader_id) : null;
  return uploaderId;
}

async function getSongAccessInfo(songId) {
  const id = parsePositiveInt(songId);
  if (!id) return { exists: false, uploaderId: null };
  const result = await pool.query('SELECT uploader_id FROM songs WHERE id = $1', [id]);
  if (!result.rows || result.rows.length === 0) {
    return { exists: false, uploaderId: null };
  }
  const uploaderId = parsePositiveInt(result.rows[0].uploader_id);
  return { exists: true, uploaderId };
}

// ============================================================================
// LYRICS CRUD
// ============================================================================

/**
 * Получить текст песни по ID
 * @param {number} songId 
 * @returns {Object|null}
 */
async function getLyricsBySongId(songId) {
  const result = await pool.query(`
    SELECT 
      id,
      song_id as "songId",
      language,
      plain_text as "plainText",
      synced_lines as "lines",
      source,
      external_provider as "externalProvider",
      external_id as "externalId",
      external_fetched_at as "externalFetchedAt",
      created_at as "createdAt",
      updated_at as "updatedAt"
    FROM lyrics 
    WHERE song_id = $1
  `, [songId]);

  return result.rows[0] || null;
}

async function getSongMetadata(songId) {
  const result = await pool.query(`
    SELECT 
      id,
      title,
      artist,
      album,
      duration
    FROM songs
    WHERE id = $1
  `, [songId]);

  const row = result.rows && result.rows[0] ? result.rows[0] : null;
  if (!row) return null;
  return {
    id: row.id,
    title: typeof row.title === 'string' ? row.title : '',
    artist: typeof row.artist === 'string' ? row.artist : '',
    album: typeof row.album === 'string' ? row.album : '',
    duration: row.duration,
  };
}

async function findSongsByUploaderArtistTitle({ uploaderId, artist, title, limit = 10 }) {
  const uid = parsePositiveInt(uploaderId);
  if (!uid) return [];

  const a = typeof artist === 'string' ? artist.trim() : '';
  const t = typeof title === 'string' ? title.trim() : '';
  if (!a || !t) return [];

  const lim = Number.isFinite(Number(limit)) ? Math.min(25, Math.max(1, Math.floor(Number(limit)))) : 10;

  const result = await pool.query(`
    SELECT id, title, artist
    FROM songs
    WHERE uploader_id = $1
      AND lower(artist) = lower($2)
      AND lower(title) = lower($3)
    ORDER BY id ASC
    LIMIT $4
  `, [uid, a, t, lim]);

  const rows = Array.isArray(result.rows) ? result.rows : [];
  return rows
    .map((r) => ({
      id: parsePositiveInt(r?.id),
      title: typeof r?.title === 'string' ? r.title : '',
      artist: typeof r?.artist === 'string' ? r.artist : '',
    }))
    .filter((r) => r.id);
}

async function findSongsByArtistTitle({ artist, title, limit = 10 }) {
  const a = typeof artist === 'string' ? artist.trim() : '';
  const t = typeof title === 'string' ? title.trim() : '';
  if (!a || !t) return [];

  const lim = Number.isFinite(Number(limit)) ? Math.min(25, Math.max(1, Math.floor(Number(limit)))) : 10;

  const result = await pool.query(`
    SELECT id, title, artist
    FROM songs
    WHERE lower(artist) = lower($1)
      AND lower(title) = lower($2)
    ORDER BY id ASC
    LIMIT $3
  `, [a, t, lim]);

  const rows = Array.isArray(result.rows) ? result.rows : [];
  return rows
    .map((r) => ({
      id: parsePositiveInt(r?.id),
      title: typeof r?.title === 'string' ? r.title : '',
      artist: typeof r?.artist === 'string' ? r.artist : '',
    }))
    .filter((r) => r.id);
}

async function findSongsByTitle({ title, limit = 10 }) {
  const t = typeof title === 'string' ? title.trim() : '';
  if (!t) return [];

  const lim = Number.isFinite(Number(limit)) ? Math.min(25, Math.max(1, Math.floor(Number(limit)))) : 10;

  const result = await pool.query(`
    SELECT id, title, artist
    FROM songs
    WHERE lower(title) = lower($1)
    ORDER BY id ASC
    LIMIT $2
  `, [t, lim]);

  const rows = Array.isArray(result.rows) ? result.rows : [];
  return rows
    .map((r) => ({
      id: parsePositiveInt(r?.id),
      title: typeof r?.title === 'string' ? r.title : '',
      artist: typeof r?.artist === 'string' ? r.artist : '',
    }))
    .filter((r) => r.id);
}

async function findSongsByUploaderTitle({ uploaderId, title, limit = 10 }) {
  const uid = parsePositiveInt(uploaderId);
  if (!uid) return [];

  const t = typeof title === 'string' ? title.trim() : '';
  if (!t) return [];

  const lim = Number.isFinite(Number(limit)) ? Math.min(25, Math.max(1, Math.floor(Number(limit)))) : 10;

  const result = await pool.query(`
    SELECT id, title, artist
    FROM songs
    WHERE uploader_id = $1
      AND lower(title) = lower($2)
    ORDER BY id ASC
    LIMIT $3
  `, [uid, t, lim]);

  const rows = Array.isArray(result.rows) ? result.rows : [];
  return rows
    .map((r) => ({
      id: parsePositiveInt(r?.id),
      title: typeof r?.title === 'string' ? r.title : '',
      artist: typeof r?.artist === 'string' ? r.artist : '',
    }))
    .filter((r) => r.id);
}

async function getLyricsExternalCache(songId) {
  const result = await pool.query(`
    SELECT
      song_id as "songId",
      provider,
      status,
      last_attempt_at as "lastAttemptAt",
      retry_after_at as "retryAfterAt",
      last_error as "lastError",
      updated_at as "updatedAt"
    FROM lyrics_external_cache
    WHERE song_id = $1
  `, [songId]);
  const row = result.rows && result.rows[0] ? result.rows[0] : null;
  if (!row) return null;
  const toDate = (v) => {
    if (!v) return null;
    if (v instanceof Date) return v;
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
  };
  return {
    ...row,
    lastAttemptAt: toDate(row.lastAttemptAt),
    retryAfterAt: toDate(row.retryAfterAt),
    updatedAt: toDate(row.updatedAt),
  };
}

async function upsertLyricsExternalCache({ songId, provider, status, retryAfterAt, lastError }) {
  await pool.query(`
    INSERT INTO lyrics_external_cache (song_id, provider, status, last_attempt_at, retry_after_at, last_error)
    VALUES ($1, $2, $3, NOW(), $4, $5)
    ON CONFLICT (song_id) DO UPDATE SET
      provider = EXCLUDED.provider,
      status = EXCLUDED.status,
      last_attempt_at = NOW(),
      retry_after_at = EXCLUDED.retry_after_at,
      last_error = EXCLUDED.last_error,
      updated_at = NOW()
  `, [songId, provider, status, retryAfterAt || null, lastError || null]);
}

/**
 * Создать текст песни
 * @param {Object} data 
 * @returns {Object}
 */
async function createLyrics({
  songId,
  lines,
  language,
  createdBy,
  source = null,
  externalProvider = null,
  externalId = null,
  externalFetchedAt = null,
}) {
  // Генерируем plain_text из lines для полнотекстового поиска
  const plainText = lines.map(line => line.text).join('\n');

  const result = await pool.query(`
    INSERT INTO lyrics (song_id, language, plain_text, synced_lines, created_by, source, external_provider, external_id, external_fetched_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (song_id) DO UPDATE SET
      language = EXCLUDED.language,
      plain_text = EXCLUDED.plain_text,
      synced_lines = EXCLUDED.synced_lines,
      updated_by = COALESCE(EXCLUDED.created_by, lyrics.updated_by),
      source = COALESCE(EXCLUDED.source, lyrics.source),
      external_provider = COALESCE(EXCLUDED.external_provider, lyrics.external_provider),
      external_id = COALESCE(EXCLUDED.external_id, lyrics.external_id),
      external_fetched_at = COALESCE(EXCLUDED.external_fetched_at, lyrics.external_fetched_at),
      updated_at = NOW()
    RETURNING 
      id,
      song_id as "songId",
      language,
      plain_text as "plainText",
      synced_lines as "lines",
      source,
      external_provider as "externalProvider",
      external_id as "externalId",
      external_fetched_at as "externalFetchedAt",
      created_at as "createdAt",
      updated_at as "updatedAt"
  `, [songId, language, plainText, JSON.stringify(lines), createdBy, source, externalProvider, externalId, externalFetchedAt]);

  return result.rows[0];
}

/**
 * Обновить текст песни
 * @param {number} songId 
 * @param {Object} data 
 * @returns {Object|null}
 */
async function updateLyrics(songId, { lines, language, updatedBy, source = null }) {
  const plainText = lines.map(line => line.text).join('\n');

  const result = await pool.query(`
    UPDATE lyrics SET
      synced_lines = $2,
      plain_text = $3,
      language = COALESCE($4, language),
      updated_by = $5,
      source = COALESCE($6, source),
      updated_at = NOW()
    WHERE song_id = $1
    RETURNING 
      id,
      song_id as "songId",
      language,
      plain_text as "plainText",
      synced_lines as "lines",
      source,
      external_provider as "externalProvider",
      external_id as "externalId",
      external_fetched_at as "externalFetchedAt",
      created_at as "createdAt",
      updated_at as "updatedAt"
  `, [songId, JSON.stringify(lines), plainText, language, updatedBy, source]);

  return result.rows[0] || null;
}

/**
 * Удалить текст песни
 * @param {number} songId 
 * @returns {boolean}
 */
async function deleteLyrics(songId) {
  const result = await pool.query(`
    DELETE FROM lyrics WHERE song_id = $1 RETURNING id
  `, [songId]);

  return result.rowCount > 0;
}

/**
 * Поиск по тексту песен
 * @param {string} query 
 * @param {Object} options 
 * @returns {Array}
 */
async function searchLyrics(query, { limit = 20, offset = 0 }) {
  const result = await pool.query(`
    SELECT 
      l.song_id as "songId",
      l.language,
      ts_headline('russian', l.plain_text, plainto_tsquery('russian', $1), 
        'StartSel=<mark>, StopSel=</mark>, MaxWords=50, MinWords=20') as snippet,
      ts_rank(to_tsvector('russian', l.plain_text), plainto_tsquery('russian', $1)) as rank
    FROM lyrics l
    WHERE to_tsvector('russian', l.plain_text) @@ plainto_tsquery('russian', $1)
    ORDER BY rank DESC
    LIMIT $2 OFFSET $3
  `, [query, limit, offset]);

  return result.rows;
}

async function searchLyricsByUploaderIds(query, uploaderIds, { limit = 20, offset = 0 }) {
  const ids = Array.isArray(uploaderIds) ? uploaderIds.map(parsePositiveInt).filter(Boolean) : [];
  if (ids.length === 0) return [];

  const result = await pool.query(`
    SELECT 
      l.song_id as "songId",
      l.language,
      ts_headline('russian', l.plain_text, plainto_tsquery('russian', $1), 
        'StartSel=<mark>, StopSel=</mark>, MaxWords=50, MinWords=20') as snippet,
      ts_rank(to_tsvector('russian', l.plain_text), plainto_tsquery('russian', $1)) as rank
    FROM lyrics l
    JOIN songs s ON s.id = l.song_id
    WHERE s.uploader_id = ANY($2::int[])
      AND to_tsvector('russian', l.plain_text) @@ plainto_tsquery('russian', $1)
    ORDER BY rank DESC
    LIMIT $3 OFFSET $4
  `, [query, ids, limit, offset]);

  return result.rows;
}

/**
 * Проверить права на редактирование
 * @param {number} userId 
 * @param {number} songId 
 * @returns {boolean}
 */
async function canUserEditLyrics(userId, songId) {
  const uid = parsePositiveInt(userId);
  const sid = parsePositiveInt(songId);
  if (!uid || !sid) return false;

  const result = await pool.query('SELECT 1 FROM songs WHERE id = $1 AND uploader_id = $2', [sid, uid]);
  return result.rowCount > 0;
}

async function canUserEditLyricsRbac({ requestUserId, requestIsAdmin = false, songId }) {
  const uid = parsePositiveInt(requestUserId);
  const sid = parsePositiveInt(songId);
  if (!uid || !sid) return false;
  if (requestIsAdmin === true) return true;
  const result = await pool.query('SELECT 1 FROM songs WHERE id = $1 AND uploader_id = $2', [sid, uid]);
  return result.rowCount > 0;
}

/**
 * Отправить жалобу на текст
 * @param {number} songId 
 * @param {number} userId 
 * @param {string} reason 
 */
async function reportLyrics(songId, userId, reason) {
  await pool.query(`
    INSERT INTO lyrics_reports (song_id, user_id, reason)
    VALUES ($1, $2, $3)
    ON CONFLICT (song_id, user_id) DO UPDATE SET
      reason = EXCLUDED.reason,
      status = 'pending',
      created_at = NOW()
  `, [songId, userId, reason]);
}

/**
 * Health check
 * @returns {boolean}
 */
async function healthCheck() {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Закрыть соединения
 */
async function close() {
  await pool.end();
}

module.exports = {
  initialize,
  getLyricsBySongId,
  getSongMetadata,
  getLyricsExternalCache,
  upsertLyricsExternalCache,
  getSongUploaderId,
  getSongAccessInfo,
  findSongsByUploaderArtistTitle,
  findSongsByUploaderTitle,
  findSongsByArtistTitle,
  findSongsByTitle,
  createLyrics,
  updateLyrics,
  deleteLyrics,
  searchLyrics,
  searchLyricsByUploaderIds,
  canUserEditLyrics,
  canUserEditLyricsRbac,
  reportLyrics,
  healthCheck,
  close
};
