const express = require('express');
const router = express.Router();
const db = require('../database/db');

function parsePositiveInt(value) {
  const s = value === undefined || value === null ? '' : String(value).trim();
  if (!s || !/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * GET /api/playlists
 * Получение всех плейлистов текущего пользователя
 */
router.get('/', async (req, res) => {
  try {
    const userId = parsePositiveInt(req.headers['x-user-id']); // Gateway passes this
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const result = await db.query(
      `SELECT p.id, p.user_id, p.name, p.description, p.cover_path, p.is_public,
              p.created_at, p.updated_at, COUNT(ps.song_id)::int as track_count
       FROM playlists p
       LEFT JOIN playlist_tracks ps ON p.id = ps.playlist_id
       WHERE p.user_id = $1
       GROUP BY p.id
       ORDER BY p.created_at DESC`,
      [userId]
    );

    res.json({ playlists: result.rows });
  } catch (error) {
    console.error('❌ Ошибка получения плейлистов:', error);
    res.status(500).json({ error: 'Ошибка получения плейлистов' });
  }
});

/**
 * GET /api/playlists/:id
 * Получение плейлиста по ID с треками
 */
router.get('/:id', async (req, res) => {
  try {
    const playlistId = parsePositiveInt(req.params.id);
    const userId = parsePositiveInt(req.headers['x-user-id']);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!playlistId) return res.status(400).json({ error: 'Некорректный ID плейлиста' });

    const pResult = await db.query(
      `SELECT id, user_id, name, description, cover_path, is_public, created_at, updated_at
       FROM playlists WHERE id = $1 AND user_id = $2`,
      [playlistId, userId]
    );

    if (pResult.rows.length === 0) {
      return res.status(404).json({ error: 'Плейлист не найден' });
    }

    const playlist = pResult.rows[0];

    const tResult = await db.query(
      `SELECT s.id, s.title, s.artist, s.album, s.duration,
              s.cover_path, ps.position
       FROM playlist_tracks ps
       JOIN songs s ON ps.song_id = s.id
       WHERE ps.playlist_id = $1
       ORDER BY ps.position`,
      [playlistId]
    );

    playlist.tracks = tResult.rows;
    res.json(playlist);
  } catch (error) {
    console.error('❌ Ошибка получения плейлиста:', error);
    res.status(500).json({ error: 'Ошибка получения плейлиста' });
  }
});

/**
 * POST /api/playlists
 * Создание нового плейлиста
 */
router.post('/', async (req, res) => {
  try {
    const userId = parsePositiveInt(req.headers['x-user-id']);
    const { name, description, cover_path, is_public } = req.body;

    if (!userId || !name) {
      return res.status(400).json({ error: 'Название обязательно' });
    }

    const trimmedName = String(name || '').trim();
    if (!trimmedName) {
      return res.status(400).json({ error: 'Название обязательно' });
    }

    const result = await db.query(
      `INSERT INTO playlists (user_id, name, description, cover_path, is_public)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, name, description, cover_path, is_public, created_at, updated_at`,
      [userId, trimmedName, description || null, cover_path || null, is_public === true]
    );

    const created = result.rows[0];
    created.track_count = 0;
    res.status(201).json(created);
  } catch (error) {
    console.error('❌ Ошибка создания плейлиста:', error);
    res.status(500).json({ error: 'Ошибка создания плейлиста' });
  }
});

/**
 * POST /api/playlists/:id/tracks
 * Добавление песни в плейлист
 */
router.post('/:id/tracks', async (req, res) => {
  try {
    const userId = parsePositiveInt(req.headers['x-user-id']);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const playlistId = parsePositiveInt(req.params.id);
    if (!playlistId) return res.status(400).json({ error: 'Некорректный ID плейлиста' });

    const { song_id, song_ids } = req.body;

    if (!song_id && (!song_ids || !song_ids.length)) {
      return res.status(400).json({ error: 'song_id или song_ids обязательны' });
    }

    const ownerResult = await db.query(
      'SELECT user_id FROM playlists WHERE id = $1',
      [playlistId]
    );

    const ownerId = ownerResult.rows?.[0]?.user_id;
    if (!ownerId || Number(ownerId) !== Number(userId)) {
      return res.status(404).json({ error: 'Плейлист не найден' });
    }

    const list = Array.isArray(song_ids) ? song_ids : [song_id];
    const normalized = list
      .map((v) => parsePositiveInt(v))
      .filter((v) => v !== null);

    if (normalized.length < 1) {
      return res.status(400).json({ error: 'Нет валидных song_id' });
    }
    if (normalized.length > 100) {
      return res.status(400).json({ error: 'Максимум 100 треков за раз' });
    }

    const insertResult = await db.query(
      `WITH lock_playlist AS (
          SELECT 1
          FROM playlists
          WHERE id = $1
          FOR UPDATE
        ), input AS (
          SELECT u.song_id, u.ord::int AS ord
          FROM unnest($2::int[]) WITH ORDINALITY AS u(song_id, ord)
        ), maxpos AS (
          SELECT COALESCE(MAX(position), 0) AS max_pos
          FROM playlist_tracks
          WHERE playlist_id = $1
        ), ins AS (
          INSERT INTO playlist_tracks (playlist_id, song_id, position)
          SELECT $1, input.song_id, maxpos.max_pos + input.ord
          FROM input
          CROSS JOIN maxpos
          CROSS JOIN lock_playlist
          ON CONFLICT (playlist_id, song_id) DO NOTHING
          RETURNING 1
        )
        SELECT COUNT(*)::int AS added
        FROM ins`,
      [playlistId, normalized]
    );

    const addedCount = insertResult.rows?.[0]?.added ?? 0;
    res.json({ success: true, added: addedCount });
  } catch (error) {
    console.error('❌ Ошибка добавления в плейлист:', error);
    res.status(500).json({ error: 'Ошибка добавления в плейлист' });
  }
});

/**
 * DELETE /api/playlists/:id/tracks/:songId
 * Удаление песни из плейлиста
 */
router.delete('/:id/tracks/:songId', async (req, res) => {
  try {
    const userId = parsePositiveInt(req.headers['x-user-id']);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const playlistId = parsePositiveInt(req.params.id);
    const songId = parsePositiveInt(req.params.songId);
    if (!playlistId) return res.status(400).json({ error: 'Некорректный ID плейлиста' });
    if (!songId) return res.status(400).json({ error: 'Некорректный ID трека' });

    const ownerResult = await db.query(
      'SELECT user_id FROM playlists WHERE id = $1',
      [playlistId]
    );
    const ownerId = ownerResult.rows?.[0]?.user_id;
    if (!ownerId || Number(ownerId) !== Number(userId)) {
      return res.status(404).json({ error: 'Плейлист не найден' });
    }

    await db.query(
      'DELETE FROM playlist_tracks WHERE playlist_id = $1 AND song_id = $2',
      [playlistId, songId]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Ошибка удаления из плейлиста:', error);
    res.status(500).json({ error: 'Ошибка удаления из плейлиста' });
  }
});

module.exports = router;
