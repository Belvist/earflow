const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../database/db');
const {
  decodeFeedCursor,
  encodeFeedCursor,
  mapSocialPostRow,
  parseFeedLimit,
  parsePositiveBigIntString,
  parsePositiveInt,
  validatePostInput,
} = require('../lib/socialPosts');

const router = express.Router();

function parseRateLimitMultiplier() {
  const raw = String(process.env.DATABASE_SERVICE_RATE_LIMIT_MULTIPLIER || process.env.LOAD_TEST_RATE_LIMIT_MULTIPLIER || '').trim();
  if (!raw) return String(process.env.LOAD_TEST_MODE || '').trim().toLowerCase() === 'true' ? 30 : 1;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 100);
}

function scaledLimit(base) {
  return Math.max(base, Math.min(base * parseRateLimitMultiplier(), 100000));
}

function userRateKey(req) {
  return String(req.headers['x-user-id'] || 'anonymous');
}

const createPostLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: scaledLimit(12),
  keyGenerator: userRateKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много публикаций', code: 'SOCIAL_RATE_LIMITED' },
});

const reactionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: scaledLimit(120),
  keyGenerator: userRateKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много действий', code: 'SOCIAL_RATE_LIMITED' },
});

function requireGatewayService(req, res, next) {
  const serviceName = req && req.service ? req.service.name : null;
  if (serviceName !== 'api-gateway') {
    return res.status(403).json({ error: 'Сервис не авторизован для social API', code: 'SERVICE_FORBIDDEN' });
  }
  return next();
}

function readViewerId(req, res) {
  const viewerId = parsePositiveInt(req.headers['x-user-id']);
  if (!viewerId) {
    res.status(401).json({ error: 'Требуется авторизация', code: 'AUTH_REQUIRED' });
    return null;
  }
  return viewerId;
}

const POST_SELECT = `
  SELECT
    p.id::text AS id,
    p.user_id,
    p.title,
    p.body,
    p.kind,
    p.created_at,
    p.updated_at,
    COALESCE(
      NULLIF(us.display_name, ''),
      NULLIF(concat_ws(' ', NULLIF(u.first_name, ''), NULLIF(u.last_name, '')), ''),
      NULLIF(u.username, ''),
      'Слушатель'
    ) AS author_display_name,
    NULLIF(u.username, '') AS author_username,
    COALESCE(NULLIF(u.photo_url, ''), NULLIF(u.avatar_url, '')) AS avatar_url,
    (
      SELECT COUNT(*)::int
      FROM social_post_likes spl
      WHERE spl.post_id = p.id
    ) AS likes_count,
    EXISTS (
      SELECT 1
      FROM social_post_likes mine
      WHERE mine.post_id = p.id AND mine.user_id = $1
    ) AS liked_by_me,
    (p.user_id = $1) AS can_delete
  FROM social_posts p
  JOIN users u ON u.id = p.user_id
  LEFT JOIN user_settings us ON us.user_id = u.id
`;

async function getPostView(postId, viewerId) {
  const result = await db.query(
    `${POST_SELECT}
     WHERE p.id = $2::bigint
       AND p.status = 'active'`,
    [viewerId, postId],
  );
  const row = result.rows[0] || null;
  return row ? mapSocialPostRow(row) : null;
}

router.use(requireGatewayService);

router.get('/feed', async (req, res) => {
  try {
    const viewerId = readViewerId(req, res);
    if (!viewerId) return;

    const limit = parseFeedLimit(req.query.limit);
    const cursor = decodeFeedCursor(req.query.cursor);
    const params = [viewerId, limit + 1];
    let cursorWhere = '';
    if (cursor) {
      params.push(cursor.createdAt, cursor.id);
      cursorWhere = 'AND (p.created_at, p.id) < ($3::timestamptz, $4::bigint)';
    }

    const result = await db.query(
      `${POST_SELECT}
       WHERE p.status = 'active'
         AND p.visibility = 'public'
         ${cursorWhere}
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT $2::int`,
      params,
    );

    const visibleRows = result.rows.slice(0, limit);
    const nextCursor = result.rows.length > limit && visibleRows.length > 0
      ? encodeFeedCursor(visibleRows[visibleRows.length - 1])
      : null;

    res.json({
      posts: visibleRows.map(mapSocialPostRow),
      page: {
        nextCursor,
        hasMore: Boolean(nextCursor),
      },
    });
  } catch (error) {
    console.error('❌ Ошибка получения social feed:', error);
    res.status(500).json({ error: 'Ошибка получения ленты', code: 'SOCIAL_FEED_ERROR' });
  }
});

router.post('/posts', createPostLimiter, async (req, res) => {
  try {
    const viewerId = readViewerId(req, res);
    if (!viewerId) return;

    const input = validatePostInput(req.body);
    if (!input.ok) {
      return res.status(input.status).json({ error: input.error, code: input.code });
    }

    const created = await db.query(
      `INSERT INTO social_posts (user_id, title, body, kind, visibility)
       VALUES ($1, $2, $3, 'text', 'public')
       RETURNING id::text`,
      [viewerId, input.title || null, input.body],
    );

    const post = await getPostView(created.rows[0].id, viewerId);
    res.status(201).json({ post });
  } catch (error) {
    console.error('❌ Ошибка создания social post:', error);
    res.status(500).json({ error: 'Ошибка публикации поста', code: 'SOCIAL_CREATE_ERROR' });
  }
});

router.post('/posts/:id/like', reactionLimiter, async (req, res) => {
  try {
    const viewerId = readViewerId(req, res);
    if (!viewerId) return;

    const postId = parsePositiveBigIntString(req.params.id);
    if (!postId) {
      return res.status(400).json({ error: 'Некорректный ID поста', code: 'SOCIAL_POST_ID_INVALID' });
    }

    const exists = await db.query(
      `SELECT id
       FROM social_posts
       WHERE id = $1::bigint AND status = 'active'`,
      [postId],
    );
    if (exists.rows.length === 0) {
      return res.status(404).json({ error: 'Пост не найден', code: 'SOCIAL_POST_NOT_FOUND' });
    }

    await db.query(
      `INSERT INTO social_post_likes (post_id, user_id)
       VALUES ($1::bigint, $2)
       ON CONFLICT (post_id, user_id) DO NOTHING`,
      [postId, viewerId],
    );

    const post = await getPostView(postId, viewerId);
    res.json({ post });
  } catch (error) {
    console.error('❌ Ошибка лайка social post:', error);
    res.status(500).json({ error: 'Ошибка лайка', code: 'SOCIAL_LIKE_ERROR' });
  }
});

router.delete('/posts/:id/like', reactionLimiter, async (req, res) => {
  try {
    const viewerId = readViewerId(req, res);
    if (!viewerId) return;

    const postId = parsePositiveBigIntString(req.params.id);
    if (!postId) {
      return res.status(400).json({ error: 'Некорректный ID поста', code: 'SOCIAL_POST_ID_INVALID' });
    }

    await db.query(
      'DELETE FROM social_post_likes WHERE post_id = $1::bigint AND user_id = $2',
      [postId, viewerId],
    );

    const post = await getPostView(postId, viewerId);
    if (!post) {
      return res.status(404).json({ error: 'Пост не найден', code: 'SOCIAL_POST_NOT_FOUND' });
    }

    res.json({ post });
  } catch (error) {
    console.error('❌ Ошибка снятия лайка social post:', error);
    res.status(500).json({ error: 'Ошибка снятия лайка', code: 'SOCIAL_UNLIKE_ERROR' });
  }
});

router.delete('/posts/:id', async (req, res) => {
  try {
    const viewerId = readViewerId(req, res);
    if (!viewerId) return;

    const postId = parsePositiveBigIntString(req.params.id);
    if (!postId) {
      return res.status(400).json({ error: 'Некорректный ID поста', code: 'SOCIAL_POST_ID_INVALID' });
    }

    const result = await db.query(
      `UPDATE social_posts
       SET status = 'deleted',
           deleted_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1::bigint
         AND user_id = $2
         AND status = 'active'
       RETURNING id::text`,
      [postId, viewerId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Пост не найден', code: 'SOCIAL_POST_NOT_FOUND' });
    }

    res.json({ deleted: true, id: result.rows[0].id });
  } catch (error) {
    console.error('❌ Ошибка удаления social post:', error);
    res.status(500).json({ error: 'Ошибка удаления поста', code: 'SOCIAL_DELETE_ERROR' });
  }
});

module.exports = router;
