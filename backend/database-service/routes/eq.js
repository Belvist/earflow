const express = require('express');
const { authenticateService } = require('../middleware/auth');
const { pool } = require('../database/db');

const router = express.Router();

// Получить настройки эквалайзера пользователя
router.get('/', authenticateService, async (req, res) => {
  try {
    const userId = parseInt(req.query.userId, 10);
    if (!userId) {
      return res.status(401).json({ error: 'Требуется авторизация' });
    }

    const result = await pool.query(
      'SELECT enabled, gains FROM user_eq_settings WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      // Вернуть настройки по умолчанию
      return res.json({
        enabled: false,
        gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
      });
    }

    const gains = result.rows[0].gains;
    res.json({
      enabled: result.rows[0].enabled,
      gains: typeof gains === 'string' ? JSON.parse(gains) : gains
    });
  } catch (error) {
    console.error('Ошибка получения настроек EQ:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Сохранить настройки эквалайзера
router.post('/', authenticateService, async (req, res) => {
  try {
    const userId = parseInt(req.query.userId, 10);
    if (!userId) {
      return res.status(401).json({ error: 'Требуется авторизация' });
    }

    const { enabled, gains } = req.body;

    // Валидация
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled должен быть boolean' });
    }

    if (!Array.isArray(gains) || gains.length !== 10) {
      return res.status(400).json({ error: 'gains должен быть массивом из 10 чисел' });
    }

    // Проверяем каждое значение
    for (let i = 0; i < gains.length; i++) {
      const val = gains[i];
      if (typeof val !== 'number' || val < -12 || val > 12) {
        return res.status(400).json({ error: `gains[${i}] должен быть числом от -12 до 12` });
      }
    }

    // Вставка или обновление (UPSERT)
    await pool.query(
      `INSERT INTO user_eq_settings (user_id, enabled, gains, updated_at)
       VALUES ($1, $2, $3::jsonb, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id)
       DO UPDATE SET
         enabled = EXCLUDED.enabled,
         gains = EXCLUDED.gains,
         updated_at = CURRENT_TIMESTAMP`,
      [userId, enabled, JSON.stringify(gains)]
    );

    res.json({ success: true, enabled, gains });
  } catch (error) {
    console.error('Ошибка сохранения настроек EQ:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
