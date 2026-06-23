const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const db = require('../database/db');

const listenLimiter = rateLimit({
  windowMs: 30 * 1000,
  max: 10,
  keyGenerator: (req) => {
    const userId = req.body?.user_id;
    const songId = req.body?.song_id;
    return `${userId}:${songId}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many listen events for this track' },
});

/**
 * POST /api/listens
 * Записать факт прослушивания
 */
router.post('/', listenLimiter, async (req, res) => {
  try {
    const { user_id, song_id } = req.body;

    if (!user_id || !song_id) {
      return res.status(400).json({ error: 'Обязательные поля: user_id, song_id' });
    }

    const result = await db.query(
      `INSERT INTO listens (user_id, song_id)
       VALUES ($1, $2)
       RETURNING id, user_id, song_id, listened_at`,
      [user_id, song_id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('❌ Ошибка записи прослушивания:', error);
    res.status(500).json({ error: 'Ошибка записи прослушивания' });
  }
});

/**
 * GET /api/listens
 * Получить последние прослушивания пользователя
 * Query: userId, limit?
 */
router.get('/', async (req, res) => {
  try {
    const userId = parseInt(req.query.userId, 10);
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

    if (!Number.isFinite(userId)) {
      return res.status(400).json({ error: 'Некорректный userId' });
    }

    const result = await db.query(
      `SELECT song_id, listened_at
       FROM listens
       WHERE user_id = $1
       ORDER BY listened_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('❌ Ошибка получения прослушиваний:', error);
    res.status(500).json({ error: 'Ошибка получения прослушиваний' });
  }
});

module.exports = router;
