/**
 * Database module for Playlist Service
 * Handles PostgreSQL connection pool and queries
 */

const { Pool } = require('pg');
const crypto = require('node:crypto');

// ============================================================================
// CONNECTION POOL
// ============================================================================

function parseIntEnv(name, fallback, { min = 1, max = 200 } = {}) {
  const raw = process.env[name];
  const value = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseIntEnv('DB_MAX_CONNECTIONS', 20),
  min: parseIntEnv('DB_MIN_CONNECTIONS', 0, { min: 0, max: 50 }),
  idleTimeoutMillis: parseIntEnv('DB_IDLE_TIMEOUT_MS', 30000, { min: 1000, max: 300000 }),
  connectionTimeoutMillis: parseIntEnv('DB_CONNECTION_TIMEOUT_MS', 10000, { min: 500, max: 60000 }),
  // No SSL in Docker internal network
  ssl: false
});

pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err.message);
});

pool.on('connect', () => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('New database connection established');
  }
});

// ============================================================================
// INITIALIZATION - CREATE TABLES IF NOT EXIST
// ============================================================================

const INIT_LOCK_KEY = 4982137448123;

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function acquireAdvisoryLock(client, key, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const r = await client.query('SELECT pg_try_advisory_lock($1::bigint) AS ok', [key]);
    if (r?.rows?.[0]?.ok === true) return true;
    await sleepMs(500);
  }
  return false;
}

async function releaseAdvisoryLock(client, key) {
  try {
    await client.query('SELECT pg_advisory_unlock($1::bigint)', [key]);
  } catch {
  }
}

async function initializePlaylistsSchema(client) {
  await client.query(`
      CREATE TABLE IF NOT EXISTS playlists (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        cover_path VARCHAR(500),
        is_public BOOLEAN DEFAULT false,
        share_slug VARCHAR(64) UNIQUE,
        is_smart BOOLEAN DEFAULT false,
        smart_rules JSONB,
        track_count INTEGER DEFAULT 0,
        total_duration INTEGER DEFAULT 0,
        play_count INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

  await client.query(`
      ALTER TABLE playlists
        ADD COLUMN IF NOT EXISTS user_id INTEGER,
        ADD COLUMN IF NOT EXISTS description TEXT,
        ADD COLUMN IF NOT EXISTS cover_path TEXT,
        ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS share_slug VARCHAR(64) UNIQUE,
        ADD COLUMN IF NOT EXISTS is_smart BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS smart_rules JSONB,
        ADD COLUMN IF NOT EXISTS track_count INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS total_duration INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS play_count INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    `);

  await client.query(`
      ALTER TABLE playlists
      ALTER COLUMN share_slug TYPE VARCHAR(64)
    `);

  await client.query(`
      ALTER TABLE playlists
      ALTER COLUMN is_public SET DEFAULT false
    `);

  await client.query(`
      UPDATE playlists
      SET is_public = COALESCE(is_public, false)
      WHERE is_public IS NULL
    `);

  const playlistsToFix = await client.query(
    `SELECT id
       FROM playlists
       WHERE is_public = true
         AND (share_slug IS NULL OR length(share_slug) <> 32)`
  );

  for (const row of playlistsToFix.rows) {
    const playlistId = row.id;
    if (!playlistId) continue;

    let updated = false;
    for (let attempt = 1; attempt <= 10; attempt++) {
      const newSlug = generateShareSlug();
      let r = null;
      try {
        r = await client.query(
          `UPDATE playlists
             SET share_slug = $1
           WHERE id = $2
           RETURNING id`,
          [newSlug, playlistId]
        );
      } catch (e) {
        if (isUniqueViolation(e)) {
          r = null;
        } else {
          throw e;
        }
      }

      if (r && r.rowCount > 0) {
        updated = true;
        break;
      }
    }

    if (!updated) {
      throw new Error(`Failed to migrate share_slug for playlist ${playlistId}`);
    }
  }

  await client.query(`
      CREATE INDEX IF NOT EXISTS idx_playlists_share_slug ON playlists(share_slug) WHERE share_slug IS NOT NULL
    `);

  await client.query(`
      CREATE INDEX IF NOT EXISTS idx_playlists_user_id ON playlists(user_id)
    `);
}

async function initializePlaylistTracksSchema(client) {
  await client.query(`
      CREATE TABLE IF NOT EXISTS playlist_tracks (
        id SERIAL PRIMARY KEY,
        playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        added_by INTEGER,
        UNIQUE(playlist_id, song_id)
      )
    `);

  const orphanTracks = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM playlist_tracks pt
      WHERE NOT EXISTS (
        SELECT 1
        FROM songs s
        WHERE s.id = pt.song_id
      )
    `);
  const orphanCount = orphanTracks.rows[0]?.count || 0;
  if (orphanCount > 0) {
    throw new Error(
      `playlist_tracks contains ${orphanCount} rows with missing songs; run scripts/fix-runtime-consistency-known-issues.sql before starting playlist-service`
    );
  }

  await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'playlist_tracks_song_id_fkey'
            AND conrelid = 'playlist_tracks'::regclass
        ) THEN
          ALTER TABLE playlist_tracks
            ADD CONSTRAINT playlist_tracks_song_id_fkey
            FOREIGN KEY (song_id)
            REFERENCES songs(id)
            ON DELETE CASCADE;
        END IF;
      END
      $$
    `);

  await client.query(`
      CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist_id ON playlist_tracks(playlist_id)
    `);
  await client.query(`
      CREATE INDEX IF NOT EXISTS idx_playlist_tracks_song_id ON playlist_tracks(song_id)
    `);
}

async function initializeQueueSchema(client) {
  await client.query(`
      CREATE TABLE IF NOT EXISTS user_queue (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        song_id INTEGER NOT NULL,
        position INTEGER NOT NULL,
        source_type VARCHAR(50) DEFAULT 'manual',
        source_id INTEGER,
        added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, position)
      )
    `);

  await client.query(`
      CREATE TABLE IF NOT EXISTS queue_state (
        user_id INTEGER PRIMARY KEY,
        current_index INTEGER DEFAULT 0,
        shuffle_enabled BOOLEAN DEFAULT false,
        shuffle_order JSONB,
        repeat_mode VARCHAR(10) DEFAULT 'off',
        source_type VARCHAR(50),
        source_id INTEGER,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

  await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_queue_user_id ON user_queue(user_id)
    `);
}

async function initialize() {
  const client = await pool.connect();
  let lockAcquired = false;
  let didBegin = false;

  try {
    lockAcquired = await acquireAdvisoryLock(client, INIT_LOCK_KEY);
    if (!lockAcquired) {
      throw new Error('Failed to obtain database init lock');
    }

    await client.query('BEGIN');
    didBegin = true;

    await initializePlaylistsSchema(client);
    await initializePlaylistTracksSchema(client);
    await initializeQueueSchema(client);

    await client.query('COMMIT');
    console.log('Database tables initialized');

  } catch (error) {
    if (didBegin) {
      try {
        await client.query('ROLLBACK');
      } catch {
      }
    }
    console.error('Database initialization failed:', error.message);
    throw error;
  } finally {
    if (lockAcquired) {
      await releaseAdvisoryLock(client, INIT_LOCK_KEY);
    }
    client.release();
  }
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Генерация уникального share_slug для публичных плейлистов
 * Формат: 32 символа base62 (буквы + цифры)
 */
function generateShareSlug() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let slug = '';
  for (let i = 0; i < 32; i++) {
    slug += chars[crypto.randomInt(chars.length)];
  }
  return slug;
}

function isUniqueViolation(error) {
  return error && typeof error === 'object' && error.code === '23505';
}

// ============================================================================
// PLAYLIST QUERIES
// ============================================================================

/**
 * Create a new playlist
 * Генерирует share_slug для публичных плейлистов
 */
async function createPlaylist(userId, data) {
  const { name, description, is_public, cover_path } = data;
  const isPublic = is_public === true;

  for (let attempt = 1; attempt <= 10; attempt++) {
    const shareSlug = isPublic ? generateShareSlug() : null;
    try {
      const result = await pool.query(`
        INSERT INTO playlists (user_id, name, description, is_public, cover_path, share_slug)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [userId, name, description || null, isPublic, cover_path || null, shareSlug]);
      return result.rows[0];
    } catch (e) {
      if (isPublic && isUniqueViolation(e)) continue;
      throw e;
    }
  }

  throw new Error('Failed to generate unique share slug');
}

/**
 * Get playlist by share_slug (для публичного доступа без авторизации)
 */
async function getPlaylistBySlug(slug) {
  if (!slug || typeof slug !== 'string' || slug.length !== 32) {
    return null;
  }

  const result = await pool.query(`
    SELECT p.*, u.username as owner_name
    FROM playlists p
    LEFT JOIN users u ON u.id = p.user_id
    WHERE p.share_slug = $1 AND p.is_public = true
  `, [slug]);

  return result.rows[0] || null;
}

/**
 * Regenerate share_slug (если нужно новую ссылку)
 */
async function regenerateShareSlug(playlistId, userId) {
  for (let attempt = 1; attempt <= 10; attempt++) {
    const newSlug = generateShareSlug();
    try {
      const result = await pool.query(`
        UPDATE playlists
        SET share_slug = $1, is_public = true, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND user_id = $3
        RETURNING *
      `, [newSlug, playlistId, userId]);

      return result.rows[0] || null;
    } catch (e) {
      if (isUniqueViolation(e)) continue;
      throw e;
    }
  }

  throw new Error('Failed to generate unique share slug');
}

/**
 * Get all playlists for a user
 */
async function getUserPlaylists(userId, options = {}) {
  const { limit = 50, offset = 0, includePublic = false } = options;

  const whereClause = includePublic ? 'p.user_id = $1 AND p.is_public = true' : 'p.user_id = $1';

  let query = `
    SELECT p.*, 
           COALESCE(
             (SELECT json_agg(json_build_object('id', s.id, 'cover_path', s.cover_path))
              FROM (
                SELECT s.id, s.cover_path
                FROM playlist_tracks pt
                JOIN songs s ON s.id = pt.song_id
                WHERE pt.playlist_id = p.id
                ORDER BY pt.position
                LIMIT 4
              ) s
             ), '[]'::json
           ) as preview_covers
    FROM playlists p
    WHERE ${whereClause}
  `;

  query += `
    ORDER BY p.updated_at DESC
    LIMIT $2 OFFSET $3
  `;

  const result = await pool.query(query, [userId, limit, offset]);
  return result.rows;
}

/**
 * Get playlists by ownerId (for profile pages)
 * If viewerId is the owner -> return all playlists
 * Otherwise -> only public playlists
 */
async function getPlaylistsByOwner(ownerId, viewerId, options = {}) {
  const { limit = 50, offset = 0 } = options;

  const isOwner = viewerId && Number(viewerId) === Number(ownerId);
  const result = await pool.query(`
    SELECT p.*, 
           COALESCE(
             (SELECT json_agg(json_build_object('id', s.id, 'cover_path', s.cover_path))
              FROM (
                SELECT s.id, s.cover_path
                FROM playlist_tracks pt
                JOIN songs s ON s.id = pt.song_id
                WHERE pt.playlist_id = p.id
                ORDER BY pt.position
                LIMIT 4
              ) s
             ), '[]'::json
           ) as preview_covers
    FROM playlists p
    WHERE p.user_id = $1
      AND ($2::boolean = true OR p.is_public = true)
    ORDER BY p.updated_at DESC
    LIMIT $3 OFFSET $4
  `, [ownerId, isOwner, limit, offset]);

  return result.rows;
}

/**
 * Get single playlist by ID
 */
async function getPlaylistById(playlistId, userId = null) {
  if (userId === null || userId === undefined) {
    const result = await pool.query(`
      SELECT p.*
      FROM playlists p
      WHERE p.id = $1
        AND p.is_public = true
    `, [playlistId]);

    return result.rows[0] || null;
  }

  const result = await pool.query(`
    SELECT p.*
    FROM playlists p
    WHERE p.id = $1
      AND (p.user_id = $2 OR p.is_public = true)
  `, [playlistId, userId]);

  return result.rows[0] || null;
}

/**
 * Update playlist metadata
 * Автоматически управляет share_slug при изменении is_public
 */
async function updatePlaylist(playlistId, userId, data) {
  // Сначала получаем текущее состояние плейлиста
  const current = await pool.query(
    'SELECT is_public, share_slug FROM playlists WHERE id = $1 AND user_id = $2',
    [playlistId, userId]
  );

  if (current.rows.length === 0) {
    return null;
  }

  const allowedFields = ['name', 'description', 'cover_path'];
  const updates = [];
  const values = [];
  let paramIndex = 1;

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      updates.push(`${field} = $${paramIndex}`);
      values.push(data[field]);
      paramIndex++;
    }
  }

  if (updates.length === 0) {
    return null;
  }

  updates.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(playlistId, userId);

  const result = await pool.query(`
    UPDATE playlists
    SET ${updates.join(', ')}
    WHERE id = $${paramIndex} AND user_id = $${paramIndex + 1}
    RETURNING *
  `, values);

  return result.rows[0] || null;
}

/**
 * Delete playlist
 */
async function deletePlaylist(playlistId, userId) {
  const result = await pool.query(`
    DELETE FROM playlists
    WHERE id = $1 AND user_id = $2
    RETURNING id
  `, [playlistId, userId]);

  return result.rowCount > 0;
}

// ============================================================================
// PLAYLIST TRACKS QUERIES
// ============================================================================

/**
 * Get tracks in a playlist
 */
async function getPlaylistTracks(playlistId, options = {}) {
  const { limit = 100, offset = 0 } = options;

  const result = await pool.query(`
    SELECT 
      pt.id as playlist_track_id,
      pt.position,
      pt.added_at,
      s.*
    FROM playlist_tracks pt
    JOIN songs s ON s.id = pt.song_id
    WHERE pt.playlist_id = $1
    ORDER BY pt.position
    LIMIT $2 OFFSET $3
  `, [playlistId, limit, offset]);

  return result.rows;
}

/**
 * Add track to playlist
 */
async function addTrackToPlaylist(playlistId, songId, userId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get next position
    const posResult = await client.query(`
      SELECT COALESCE(MAX(position), 0) + 1 as next_pos
      FROM playlist_tracks
      WHERE playlist_id = $1
    `, [playlistId]);

    const nextPosition = posResult.rows[0].next_pos;

    // Insert track
    const result = await client.query(`
      INSERT INTO playlist_tracks (playlist_id, song_id, position, added_by)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (playlist_id, song_id) DO NOTHING
      RETURNING *
    `, [playlistId, songId, nextPosition, userId]);

    if (result.rowCount > 0) {
      // Update playlist stats
      await client.query(`
        UPDATE playlists
        SET track_count = track_count + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [playlistId]);

      await client.query(`
        UPDATE playlists p
        SET cover_path = COALESCE(p.cover_path,
          (
            SELECT s.cover_path
            FROM playlist_tracks pt
            JOIN songs s ON s.id = pt.song_id
            WHERE pt.playlist_id = p.id
            ORDER BY pt.position
            LIMIT 1
          )
        ),
        updated_at = CURRENT_TIMESTAMP
        WHERE p.id = $1
      `, [playlistId]);
    }

    await client.query('COMMIT');
    return result.rows[0] || null;

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Add multiple tracks to playlist
 */
async function addTracksToPlaylist(playlistId, songIds, userId) {
  if (!songIds || songIds.length === 0) return [];

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query('SELECT 1 FROM playlists WHERE id = $1 FOR UPDATE', [playlistId]);

    const insertRes = await client.query(
      `WITH base AS (
         SELECT COALESCE(MAX(position), 0)::int AS max_pos
           FROM playlist_tracks
          WHERE playlist_id = $1
       ), input AS (
         SELECT song_id::int, ord::int
           FROM unnest($2::int[]) WITH ORDINALITY AS t(song_id, ord)
       ), to_insert AS (
         SELECT i.song_id,
                row_number() OVER (ORDER BY i.ord)::int AS rn
           FROM input i
           LEFT JOIN playlist_tracks pt
             ON pt.playlist_id = $1
            AND pt.song_id = i.song_id
          WHERE pt.song_id IS NULL
       ), ins AS (
         INSERT INTO playlist_tracks (playlist_id, song_id, position, added_by)
         SELECT $1, ti.song_id, b.max_pos + ti.rn, $3
           FROM to_insert ti
           CROSS JOIN base b
         RETURNING *
       )
       SELECT * FROM ins
       ORDER BY position`,
      [playlistId, songIds, userId]
    );

    const added = Array.isArray(insertRes?.rows) ? insertRes.rows : [];

    // Update playlist stats
    if (added.length > 0) {
      await client.query(`
        UPDATE playlists
        SET track_count = track_count + $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [added.length, playlistId]);

      await client.query(`
        UPDATE playlists p
        SET cover_path = COALESCE(p.cover_path,
          (
            SELECT s.cover_path
            FROM playlist_tracks pt
            JOIN songs s ON s.id = pt.song_id
            WHERE pt.playlist_id = p.id
            ORDER BY pt.position
            LIMIT 1
          )
        ),
        updated_at = CURRENT_TIMESTAMP
        WHERE p.id = $1
      `, [playlistId]);
    }

    await client.query('COMMIT');
    return added;

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Remove track from playlist
 */
async function removeTrackFromPlaylist(playlistId, songId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const coverState = await client.query(`
      SELECT p.cover_path AS playlist_cover, s.cover_path AS removed_cover
      FROM playlists p
      LEFT JOIN songs s ON s.id = $2
      WHERE p.id = $1
      FOR UPDATE
    `, [playlistId, songId]);

    const playlistCover = coverState.rows[0]?.playlist_cover || null;
    const removedCover = coverState.rows[0]?.removed_cover || null;

    // Get position of removed track
    const trackResult = await client.query(`
      DELETE FROM playlist_tracks
      WHERE playlist_id = $1 AND song_id = $2
      RETURNING position
    `, [playlistId, songId]);

    if (trackResult.rowCount > 0) {
      const removedPosition = trackResult.rows[0].position;

      // Update positions of tracks after removed one
      await client.query(`
        UPDATE playlist_tracks
        SET position = position - 1
        WHERE playlist_id = $1 AND position > $2
      `, [playlistId, removedPosition]);

      // Update playlist stats
      await client.query(`
        UPDATE playlists
        SET track_count = GREATEST(track_count - 1, 0),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [playlistId]);

      const remainingCountRes = await client.query(
        'SELECT COUNT(*)::int AS cnt FROM playlist_tracks WHERE playlist_id = $1',
        [playlistId]
      );
      const remaining = remainingCountRes.rows[0]?.cnt || 0;

      if (remaining <= 0) {
        await client.query(
          'UPDATE playlists SET cover_path = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
          [playlistId]
        );
      } else if (!playlistCover || (removedCover && String(playlistCover) === String(removedCover))) {
        await client.query(`
          UPDATE playlists p
          SET cover_path = (
            SELECT s.cover_path
            FROM playlist_tracks pt
            JOIN songs s ON s.id = pt.song_id
            WHERE pt.playlist_id = p.id
            ORDER BY pt.position
            LIMIT 1
          ),
          updated_at = CURRENT_TIMESTAMP
          WHERE p.id = $1
        `, [playlistId]);
      }
    }

    await client.query('COMMIT');
    return trackResult.rowCount > 0;

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Reorder track in playlist
 */
async function reorderPlaylistTrack(playlistId, songId, newPosition) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get current position
    const currentResult = await client.query(`
      SELECT position FROM playlist_tracks
      WHERE playlist_id = $1 AND song_id = $2
    `, [playlistId, songId]);

    if (currentResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return false;
    }

    const currentPosition = currentResult.rows[0].position;

    if (currentPosition === newPosition) {
      await client.query('ROLLBACK');
      return true;
    }

    if (newPosition > currentPosition) {
      // Moving down
      await client.query(`
        UPDATE playlist_tracks
        SET position = position - 1
        WHERE playlist_id = $1 
          AND position > $2 
          AND position <= $3
      `, [playlistId, currentPosition, newPosition]);
    } else {
      // Moving up
      await client.query(`
        UPDATE playlist_tracks
        SET position = position + 1
        WHERE playlist_id = $1 
          AND position >= $2 
          AND position < $3
      `, [playlistId, newPosition, currentPosition]);
    }

    // Set new position
    await client.query(`
      UPDATE playlist_tracks
      SET position = $1
      WHERE playlist_id = $2 AND song_id = $3
    `, [newPosition, playlistId, songId]);

    // Update playlist timestamp
    await client.query(`
      UPDATE playlists
      SET updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [playlistId]);

    await client.query('COMMIT');
    return true;

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ============================================================================
// QUEUE QUERIES
// ============================================================================

async function getSongsByIds(songIds) {
  const ids = Array.isArray(songIds)
    ? songIds.map((id) => Number.parseInt(id, 10)).filter((n) => Number.isFinite(n) && n > 0)
    : [];

  if (ids.length === 0) return [];

  const result = await pool.query(
    `SELECT *, COALESCE(has_ebap, false) as has_ebap FROM songs WHERE id = ANY($1::int[])`,
    [ids]
  );

  return result.rows;
}

/**
 * Get user's current queue
 */
async function getUserQueue(userId) {
  const result = await pool.query(`
    SELECT 
      uq.id,
      uq.position,
      uq.source_type,
      uq.source_id,
      uq.added_at,
      s.*,
      COALESCE(s.has_ebap, false) as has_ebap
    FROM user_queue uq
    JOIN songs s ON s.id = uq.song_id
    WHERE uq.user_id = $1
    ORDER BY uq.position
  `, [userId]);

  return result.rows;
}

/**
 * Get queue state
 */
async function getQueueState(userId) {
  const result = await pool.query(`
    SELECT * FROM queue_state WHERE user_id = $1
  `, [userId]);

  return result.rows[0] || {
    current_index: 0,
    shuffle_enabled: false,
    shuffle_order: null,
    repeat_mode: 'off'
  };
}

/**
 * Set queue from playlist or array of songs
 */
async function setQueue(userId, songIds, sourceType = 'manual', sourceId = null) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Clear existing queue
    await client.query(`DELETE FROM user_queue WHERE user_id = $1`, [userId]);

    // Insert new queue items
    for (let i = 0; i < songIds.length; i++) {
      await client.query(`
        INSERT INTO user_queue (user_id, song_id, position, source_type, source_id)
        VALUES ($1, $2, $3, $4, $5)
      `, [userId, songIds[i], i, sourceType, sourceId]);
    }

    // Reset queue state
    await client.query(`
      INSERT INTO queue_state (user_id, current_index, source_type, source_id, updated_at)
      VALUES ($1, 0, $2, $3, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id)
      DO UPDATE SET 
        current_index = 0,
        source_type = $2,
        source_id = $3,
        shuffle_order = NULL,
        updated_at = CURRENT_TIMESTAMP
    `, [userId, sourceType, sourceId]);

    await client.query('COMMIT');
    return true;

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Add song to queue
 */
async function addToQueue(userId, songId, position = null) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (position === null) {
      // Add to end
      const maxResult = await client.query(`
        SELECT COALESCE(MAX(position), -1) + 1 as next_pos
        FROM user_queue WHERE user_id = $1
      `, [userId]);
      position = maxResult.rows[0].next_pos;
    } else {
      // Shift existing items
      await client.query(`
        UPDATE user_queue
        SET position = position + 1
        WHERE user_id = $1 AND position >= $2
      `, [userId, position]);
    }

    await client.query(`
      INSERT INTO user_queue (user_id, song_id, position, source_type)
      VALUES ($1, $2, $3, 'manual')
    `, [userId, songId, position]);

    await client.query('COMMIT');
    return { position };

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Remove from queue
 */
async function removeFromQueue(userId, position) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(`
      DELETE FROM user_queue
      WHERE user_id = $1 AND position = $2
    `, [userId, position]);

    // Shift remaining items
    await client.query(`
      UPDATE user_queue
      SET position = position - 1
      WHERE user_id = $1 AND position > $2
    `, [userId, position]);

    await client.query('COMMIT');
    return true;

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Clear queue
 */
async function clearQueue(userId) {
  await pool.query(`DELETE FROM user_queue WHERE user_id = $1`, [userId]);
  await pool.query(`
    UPDATE queue_state
    SET current_index = 0, shuffle_order = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = $1
  `, [userId]);
  return true;
}

/**
 * Update queue state (shuffle, repeat, current index)
 */
async function updateQueueState(userId, updates) {
  const allowedFields = ['current_index', 'shuffle_enabled', 'shuffle_order', 'repeat_mode'];
  const setClauses = [];
  const values = [];
  let paramIndex = 1;

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      if (field === 'shuffle_order') {
        setClauses.push(`${field} = $${paramIndex}::jsonb`);
        values.push(JSON.stringify(updates[field]));
      } else {
        setClauses.push(`${field} = $${paramIndex}`);
        values.push(updates[field]);
      }
      paramIndex++;
    }
  }

  if (setClauses.length === 0) return null;

  setClauses.push('updated_at = CURRENT_TIMESTAMP');
  values.push(userId);

  await pool.query(`
    INSERT INTO queue_state (user_id, ${allowedFields.filter(f => updates[f] !== undefined).join(', ')}, updated_at)
    VALUES ($${paramIndex}, ${values.slice(0, -1).map((_, i) => `$${i + 1}`).join(', ')}, CURRENT_TIMESTAMP)
    ON CONFLICT (user_id)
    DO UPDATE SET ${setClauses.join(', ')}
  `, values);

  return true;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

async function healthCheck() {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

function getPoolStats() {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount
  };
}

async function close() {
  await pool.end();
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  pool,
  initialize,
  // Playlists
  createPlaylist,
  getUserPlaylists,
  getPlaylistsByOwner,
  getPlaylistById,
  getPlaylistBySlug,
  updatePlaylist,
  deletePlaylist,
  regenerateShareSlug,
  // Playlist tracks
  getPlaylistTracks,
  addTrackToPlaylist,
  addTracksToPlaylist,
  removeTrackFromPlaylist,
  reorderPlaylistTrack,
  // Queue
  getSongsByIds,
  getUserQueue,
  getQueueState,
  setQueue,
  addToQueue,
  removeFromQueue,
  clearQueue,
  updateQueueState,
  // Utils
  healthCheck,
  getPoolStats,
  close
};
