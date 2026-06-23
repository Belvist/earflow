const express = require('express');
const router = express.Router();
const db = require('../database/db');

router.get('/', async (req, res) => {
  try {
    const userId = parseInt(req.query.userId, 10);
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const result = await db.query(
      `SELECT s.id, s.uploader_id as user_id, s.title, s.artist, s.album, s.duration,
              s.file_path, s.file_size, s.mime_type, s.cover_path, s.created_at, s.updated_at
       FROM dislikes d
       JOIN songs s ON s.id = d.song_id
       WHERE d.user_id = $1
       ORDER BY d.created_at DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка получения дизлайков' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { user_id, song_id } = req.body;
    if (!user_id || !song_id) return res.status(400).json({ error: 'user_id and song_id required' });

    await db.query(
      `INSERT INTO dislikes (user_id, song_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, song_id) DO NOTHING`,
      [user_id, song_id]
    );

    res.json({ disliked: true });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка добавления в дизлайки' });
  }
});

router.delete('/:songId', async (req, res) => {
  try {
    const userId = parseInt(req.query.userId, 10);
    const songId = parseInt(req.params.songId, 10);
    if (!userId || !songId) return res.status(400).json({ error: 'userId and songId required' });

    await db.query(
      `DELETE FROM dislikes WHERE user_id = $1 AND song_id = $2`,
      [userId, songId]
    );

    res.json({ disliked: false });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка удаления из дизлайков' });
  }
});

module.exports = router;
