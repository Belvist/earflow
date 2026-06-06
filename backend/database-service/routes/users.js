const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { mergeListenerUi, normalizeListenerUi } = require('../lib/listenerUiPrefs');

function isAuthService(req) {
  return (req && req.service && req.service.name) === 'auth-service';
}

/**
 * GET /api/users/telegram/:telegramId
 * Получение пользователя по telegram_id
 */
router.get('/telegram/:telegramId', async (req, res) => {
  try {
    const raw = req.params.telegramId;
    const telegramId = Number(raw);
    if (!Number.isSafeInteger(telegramId) || telegramId <= 0) {
      return res.status(400).json({ error: 'Некорректный telegram_id' });
    }

    if (!isAuthService(req)) {
      return res.status(403).json({ error: 'Сервис не авторизован для этого действия', code: 'SERVICE_FORBIDDEN' });
    }

    const result = await db.query(
      'SELECT id, email, email_hash, username, first_name, last_name, photo_url, password_hash, salt, email_encrypted, metadata, created_at, last_login, is_admin, telegram_id, mfa_enabled, mfa_secret_encrypted, mfa_recovery_codes, mfa_enabled_at FROM users WHERE telegram_id = $1',
      [telegramId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка получения пользователя' });
  }
});

/**
 * GET /api/users/:id
 * Получение пользователя по ID
 */
router.get('/:id(\\d+)', async (req, res) => {
  try {
    const { id } = req.params;

    const serviceName = req && req.service ? req.service.name : null;
    if (serviceName !== 'auth-service' && serviceName !== 'api-gateway') {
      return res.status(403).json({ error: 'Сервис не авторизован для этого действия', code: 'SERVICE_FORBIDDEN' });
    }

    const select = serviceName === 'auth-service'
      ? 'SELECT id, email, email_hash, username, first_name, last_name, photo_url, password_hash, salt, email_encrypted, metadata, created_at, last_login, is_admin, telegram_id, mfa_enabled, mfa_secret_encrypted, mfa_recovery_codes, mfa_enabled_at FROM users WHERE id = $1'
      : 'SELECT id, email, username, first_name, last_name, photo_url, created_at, last_login, is_admin, telegram_id, mfa_enabled, mfa_enabled_at FROM users WHERE id = $1';

    const result = await db.query(select, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Ошибка получения пользователя:', error);
    res.status(500).json({ error: 'Ошибка получения пользователя' });
  }
});

/**
 * GET /api/users/email/:email
 * Получение пользователя по email
 */
router.get('/email/:email', async (req, res) => {
  try {
    const { email } = req.params;

    if (!isAuthService(req)) {
      return res.status(403).json({ error: 'Сервис не авторизован для этого действия', code: 'SERVICE_FORBIDDEN' });
    }

    const raw = String(email || '').trim();
    const isHash = /^[a-f0-9]{64}$/i.test(raw);

    const result = await db.query(
      isHash
        ? 'SELECT id, email, email_hash, username, first_name, last_name, photo_url, password_hash, salt, email_encrypted, metadata, created_at, last_login, is_admin, telegram_id, mfa_enabled, mfa_secret_encrypted, mfa_recovery_codes, mfa_enabled_at FROM users WHERE email_hash = $1 OR email = $1'
        : 'SELECT id, email, email_hash, username, first_name, last_name, photo_url, password_hash, salt, email_encrypted, metadata, created_at, last_login, is_admin, telegram_id, mfa_enabled, mfa_secret_encrypted, mfa_recovery_codes, mfa_enabled_at FROM users WHERE lower(email) = lower($1)',
      [raw]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Ошибка получения пользователя:', error);
    res.status(500).json({ error: 'Ошибка получения пользователя' });
  }
});

/**
 * POST /api/users
 * Создание нового пользователя
 */
router.post('/', async (req, res) => {
  try {
    if (!isAuthService(req)) {
      return res.status(403).json({ error: 'Сервис не авторизован для этого действия', code: 'SERVICE_FORBIDDEN' });
    }

    const {
      email, password_hash, username, first_name, last_name, photo_url,
      email_encrypted, email_hash, salt, metadata, telegram_id
    } = req.body;

    const result = await db.query(
      `INSERT INTO users (email, email_hash, password_hash, username, first_name, last_name, photo_url, email_encrypted, salt, metadata, telegram_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, email_hash, username, photo_url, created_at, is_admin, telegram_id`,
      [email, email_hash, password_hash, username, first_name, last_name, photo_url, email_encrypted, salt, metadata, telegram_id]
    );

    const row = result.rows[0];
    res.status(201).json(row);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Пользователь уже существует' });
    }
    res.status(500).json({ error: 'Ошибка создания пользователя' });
  }
});

/**
 * PUT /api/users/:id
 * Обновление пользователя
 */
router.put('/:id(\\d+)', async (req, res) => {
  try {
    if (!isAuthService(req)) {
      return res.status(403).json({ error: 'Сервис не авторизован для этого действия', code: 'SERVICE_FORBIDDEN' });
    }

    const { id } = req.params;
    const { username, first_name, last_name, photo_url, last_login, password_hash, metadata, telegram_id, mfa_enabled, mfa_secret_encrypted, mfa_recovery_codes, mfa_enabled_at, email, email_hash, email_encrypted } = req.body;

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (username !== undefined) {
      updates.push(`username = $${paramCount++}`);
      values.push(username);
    }
    if (first_name !== undefined) {
      updates.push(`first_name = $${paramCount++}`);
      values.push(first_name);
    }
    if (last_name !== undefined) {
      updates.push(`last_name = $${paramCount++}`);
      values.push(last_name);
    }
    if (photo_url !== undefined) {
      updates.push(`photo_url = $${paramCount++}`);
      values.push(photo_url);
    }
    if (last_login !== undefined) {
      updates.push(`last_login = $${paramCount++}`);
      values.push(last_login);
    }
    if (password_hash !== undefined) {
      updates.push(`password_hash = $${paramCount++}`);
      values.push(password_hash);
    }
    if (metadata !== undefined) {
      updates.push(`metadata = $${paramCount++}`);
      values.push(metadata);
    }

    if (email !== undefined) {
      updates.push(`email = $${paramCount++}`);
      values.push(email);
    }

    if (email_hash !== undefined) {
      updates.push(`email_hash = $${paramCount++}`);
      values.push(email_hash);
    }

    if (email_encrypted !== undefined) {
      updates.push(`email_encrypted = $${paramCount++}`);
      values.push(email_encrypted);
    }

    if (telegram_id !== undefined) {
      updates.push(`telegram_id = $${paramCount++}`);
      values.push(telegram_id);
    }

    if (mfa_enabled !== undefined) {
      updates.push(`mfa_enabled = $${paramCount++}`);
      values.push(mfa_enabled);
    }
    if (mfa_secret_encrypted !== undefined) {
      updates.push(`mfa_secret_encrypted = $${paramCount++}`);
      values.push(mfa_secret_encrypted);
    }
    if (mfa_recovery_codes !== undefined) {
      updates.push(`mfa_recovery_codes = $${paramCount++}`);
      values.push(mfa_recovery_codes);
    }
    if (mfa_enabled_at !== undefined) {
      updates.push(`mfa_enabled_at = $${paramCount++}`);
      values.push(mfa_enabled_at);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Нет данных для обновления' });
    }

    values.push(id);

    const result = await db.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount}
       RETURNING id, email_hash, username, photo_url, created_at, last_login, is_admin, telegram_id, mfa_enabled, mfa_enabled_at`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка обновления пользователя' });
  }
});

/**
 * DELETE /api/users/:id
 * Удаление пользователя
 */
router.delete('/:id(\\d+)', async (req, res) => {
  try {
    if (!isAuthService(req)) {
      return res.status(403).json({ error: 'Сервис не авторизован для этого действия', code: 'SERVICE_FORBIDDEN' });
    }

    const { id } = req.params;

    const result = await db.query(
      'DELETE FROM users WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    res.json({ message: 'Пользователь удален', id: result.rows[0].id });
  } catch (error) {
    console.error('❌ Ошибка удаления пользователя:', error);
    res.status(500).json({ error: 'Ошибка удаления пользователя' });
  }
});

// ============================================================================
// USER SETTINGS ENDPOINTS
// ============================================================================

/**
 * GET /api/users/:id/settings
 * Получение настроек пользователя
 */
router.get('/:id(\\d+)/settings', async (req, res) => {
  try {
    const serviceName = req && req.service ? req.service.name : null;
    if (serviceName !== 'api-gateway') {
      return res.status(403).json({ error: 'Сервис не авторизован для этого действия', code: 'SERVICE_FORBIDDEN' });
    }

    const { id } = req.params;

    // Проверяем существование пользователя
    const userCheck = await db.query('SELECT id FROM users WHERE id = $1', [id]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    // Получаем настройки (или создаём дефолтные)
    let result = await db.query(
      'SELECT * FROM user_settings WHERE user_id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      // Создаём дефолтные настройки
      result = await db.query(
        `INSERT INTO user_settings (user_id) VALUES ($1)
         RETURNING *`,
        [id]
      );
    }

    const row = result.rows[0];
    if (row && row.listener_ui) {
      row.listener_ui = normalizeListenerUi(row.listener_ui);
    }

    res.json(row);
  } catch (error) {
    console.error('❌ Ошибка получения настроек:', error);
    res.status(500).json({ error: 'Ошибка получения настроек' });
  }
});

/**
 * PUT /api/users/:id/settings
 * Обновление настроек пользователя
 */
router.put('/:id(\\d+)/settings', async (req, res) => {
  try {
    const serviceName = req && req.service ? req.service.name : null;
    if (serviceName !== 'api-gateway') {
      return res.status(403).json({ error: 'Сервис не авторизован для этого действия', code: 'SERVICE_FORBIDDEN' });
    }

    const { id } = req.params;
    const {
      display_name,
      audio_quality,
      autoplay_enabled,
      crossfade_seconds,
      normalize_volume,
      theme,
      show_lyrics,
      listening_history_enabled,
      show_activity,
      notifications_enabled,
      listener_ui: listenerUiPatch,
    } = req.body;

    // Валидация audio_quality
    const validQualities = ['auto', 'low', 'medium', 'high', 'lossless'];
    if (audio_quality && !validQualities.includes(audio_quality)) {
      return res.status(400).json({ error: 'Недопустимое значение audio_quality' });
    }

    // Валидация theme
    const validThemes = ['dark', 'light', 'system'];
    if (theme && !validThemes.includes(theme)) {
      return res.status(400).json({ error: 'Недопустимое значение theme' });
    }

    // Валидация crossfade_seconds
    if (crossfade_seconds !== undefined && (crossfade_seconds < 0 || crossfade_seconds > 12)) {
      return res.status(400).json({ error: 'crossfade_seconds должен быть от 0 до 12' });
    }

    // Валидация display_name
    if (display_name !== undefined && display_name.length > 255) {
      return res.status(400).json({ error: 'display_name слишком длинный' });
    }

    // Upsert настроек
    const result = await db.query(
      `INSERT INTO user_settings (
        user_id, display_name, audio_quality, autoplay_enabled, crossfade_seconds,
        normalize_volume, theme, show_lyrics, listening_history_enabled,
        show_activity, notifications_enabled, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id) DO UPDATE SET
        display_name = COALESCE($2, user_settings.display_name),
        audio_quality = COALESCE($3, user_settings.audio_quality),
        autoplay_enabled = COALESCE($4, user_settings.autoplay_enabled),
        crossfade_seconds = COALESCE($5, user_settings.crossfade_seconds),
        normalize_volume = COALESCE($6, user_settings.normalize_volume),
        theme = COALESCE($7, user_settings.theme),
        show_lyrics = COALESCE($8, user_settings.show_lyrics),
        listening_history_enabled = COALESCE($9, user_settings.listening_history_enabled),
        show_activity = COALESCE($10, user_settings.show_activity),
        notifications_enabled = COALESCE($11, user_settings.notifications_enabled),
        updated_at = CURRENT_TIMESTAMP
      RETURNING *`,
      [
        id, display_name, audio_quality, autoplay_enabled, crossfade_seconds,
        normalize_volume, theme, show_lyrics, listening_history_enabled,
        show_activity, notifications_enabled
      ]
    );

    let row = result.rows[0];

    if (listenerUiPatch !== undefined) {
      const mergedUi = mergeListenerUi(row?.listener_ui, listenerUiPatch);
      const uiResult = await db.query(
        `UPDATE user_settings
         SET listener_ui = $2::jsonb, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1
         RETURNING *`,
        [id, JSON.stringify(mergedUi)],
      );
      row = uiResult.rows[0];
    }

    if (row && row.listener_ui) {
      row.listener_ui = normalizeListenerUi(row.listener_ui);
    }

    console.log(`✅ Настройки обновлены для пользователя ${id}`);
    res.json(row);
  } catch (error) {
    console.error('❌ Ошибка обновления настроек:', error);
    res.status(500).json({ error: 'Ошибка обновления настроек' });
  }
});

/**
 * GET /api/users/:id/stats
 * Статистика пользователя
 */
router.get('/:id/stats', async (req, res) => {
  try {
    const serviceName = req && req.service ? req.service.name : null;
    if (serviceName !== 'api-gateway') {
      return res.status(403).json({ error: 'Сервис не авторизован для этого действия', code: 'SERVICE_FORBIDDEN' });
    }

    const { id } = req.params;

    // Количество загруженных треков
    const songsResult = await db.query(
      'SELECT COUNT(*) as count FROM songs WHERE uploader_id = $1',
      [id]
    );

    // Количество лайков
    const likesResult = await db.query(
      'SELECT COUNT(*) as count FROM likes WHERE user_id = $1',
      [id]
    );

    // Количество дизлайков
    const dislikesResult = await db.query(
      'SELECT COUNT(*) as count FROM dislikes WHERE user_id = $1',
      [id]
    );

    // Общее время прослушивания (из user_history)
    const listeningResult = await db.query(
      'SELECT COALESCE(SUM(total_play_time), 0) as total_time FROM user_history WHERE user_id = $1',
      [id]
    );

    // Количество прослушанных треков
    const tracksListenedResult = await db.query(
      'SELECT COUNT(DISTINCT song_id) as count FROM user_history WHERE user_id = $1',
      [id]
    );

    // Дата регистрации
    const userResult = await db.query(
      'SELECT created_at FROM users WHERE id = $1',
      [id]
    );

    res.json({
      songs_uploaded: parseInt(songsResult.rows[0].count),
      likes_count: parseInt(likesResult.rows[0].count),
      dislikes_count: parseInt(dislikesResult.rows[0].count),
      total_listening_time: parseInt(listeningResult.rows[0].total_time),
      tracks_listened: parseInt(tracksListenedResult.rows[0].count),
      member_since: userResult.rows[0]?.created_at || null
    });
  } catch (error) {
    console.error('❌ Ошибка получения статистики:', error);
    res.status(500).json({ error: 'Ошибка получения статистики' });
  }
});

module.exports = router;
