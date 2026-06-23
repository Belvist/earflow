const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../database/db');
const {
  decodeFeedCursor,
  encodeFeedCursor,
  mapSocialPostRow,
  mapSocialReaction,
  parseFeedLimit,
  parsePositiveBigIntString,
  parsePositiveInt,
  POST_STATUS,
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
  message: { error: 'Too many social posts', code: 'SOCIAL_RATE_LIMITED' },
});

const reactionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: scaledLimit(120),
  keyGenerator: userRateKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many social actions', code: 'SOCIAL_RATE_LIMITED' },
});

function requireGatewayService(req, res, next) {
  const serviceName = req && req.service ? req.service.name : null;
  if (serviceName !== 'api-gateway') {
    return res.status(403).json({ error: 'Service is not allowed for social API', code: 'SERVICE_FORBIDDEN' });
  }
  return next();
}

function readViewerId(req, res) {
  const viewerId = parsePositiveInt(req.headers['x-user-id']);
  if (!viewerId) {
    res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
    return null;
  }
  return viewerId;
}

function parseCacheTtlMs() {
  const raw = String(process.env.SOCIAL_FEED_CACHE_TTL_MS || '').trim();
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 10000;
  return Math.min(n, 60000);
}

const feedCacheTtlMs = parseCacheTtlMs();
const feedPageCache = new Map();
const maxFeedCacheEntries = 100;

function cloneRows(rows) {
  return Array.isArray(rows) ? rows.map((row) => ({ ...row })) : [];
}

function getFeedCache(key) {
  if (!feedCacheTtlMs || !key) return null;
  const entry = feedPageCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    feedPageCache.delete(key);
    return null;
  }
  feedPageCache.delete(key);
  feedPageCache.set(key, entry);
  return {
    rows: cloneRows(entry.rows),
    nextCursor: entry.nextCursor || null,
  };
}

function setFeedCache(key, value) {
  if (!feedCacheTtlMs || !key || !value) return;
  feedPageCache.set(key, {
    rows: cloneRows(value.rows),
    nextCursor: value.nextCursor || null,
    expiresAt: Date.now() + feedCacheTtlMs,
  });
  while (feedPageCache.size > maxFeedCacheEntries) {
    const firstKey = feedPageCache.keys().next().value;
    if (firstKey === undefined) break;
    feedPageCache.delete(firstKey);
  }
}

function clearFeedCache() {
  feedPageCache.clear();
}

function patchCachedLikes(postId, likesCount) {
  const id = String(postId || '');
  if (!id) return;
  const likes = Number.isFinite(Number(likesCount)) && Number(likesCount) >= 0 ? Math.floor(Number(likesCount)) : 0;
  for (const entry of feedPageCache.values()) {
    for (const row of entry.rows || []) {
      if (String(row.id) === id) {
        row.likes_count = likes;
      }
    }
  }
}

const PUBLIC_POST_SELECT = `
  SELECT
    p.id::text AS id,
    p.user_id,
    p.title,
    p.body,
    p.kind,
    p.created_at,
    COALESCE(
      NULLIF(us.display_name, ''),
      NULLIF(concat_ws(' ', NULLIF(u.first_name, ''), NULLIF(u.last_name, '')), ''),
      NULLIF(u.username, ''),
      'Listener'
    ) AS author_display_name,
    COALESCE(NULLIF(u.photo_url, ''), NULLIF(u.avatar_url, '')) AS avatar_url,
    p.likes_count
  FROM social_posts p
  JOIN users u ON u.id = p.user_id
  LEFT JOIN user_settings us ON us.user_id = u.id
`;

async function attachViewerState(rows, viewerId) {
  const baseRows = cloneRows(rows);
  const ids = baseRows.map((row) => parsePositiveBigIntString(row.id)).filter(Boolean);
  const liked = new Set();

  if (ids.length > 0) {
    const result = await db.query(
      `SELECT post_id::text AS post_id
       FROM social_post_likes
       WHERE user_id = $1
         AND post_id = ANY($2::bigint[])`,
      [viewerId, ids],
    );
    for (const row of result.rows) {
      liked.add(String(row.post_id));
    }
  }

  return baseRows.map((row) => ({
    ...row,
    liked_by_me: liked.has(String(row.id)),
    can_manage: Number(row.user_id) === Number(viewerId),
  }));
}

async function getPostView(postId, viewerId) {
  const result = await db.query(
    `${PUBLIC_POST_SELECT}
     WHERE p.id = $1::bigint
       AND p.status = 'active'`,
    [postId],
  );
  const row = result.rows[0] || null;
  if (!row) return null;
  const rows = await attachViewerState([row], viewerId);
  return rows.length > 0 ? mapSocialPostRow(rows[0]) : null;
}

async function readPublicFeedPage({ limit, cursor, afterId }) {
  const cacheKey = afterId
    ? `after:${afterId}:limit:${limit}`
    : `cursor:${cursor ? `${cursor.createdAt}:${cursor.id}` : 'root'}:limit:${limit}`;
  const cached = getFeedCache(cacheKey);
  if (cached) {
    return { ...cached, cacheHit: true };
  }

  const params = [limit + 1];
  const where = ["p.status = 'active'", "p.visibility = 'public'"];
  let extraWhere = '';

  if (cursor && !afterId) {
    params.push(cursor.createdAt, cursor.id);
    extraWhere = `AND (p.created_at, p.id) < ($${params.length - 1}::timestamptz, $${params.length}::bigint)`;
  }

  if (afterId) {
    params.push(afterId);
    extraWhere = `AND p.id > $${params.length}::bigint`;
  }

  const result = await db.query(
    `${PUBLIC_POST_SELECT}
     WHERE ${where.join(' AND ')}
       ${extraWhere}
     ORDER BY p.created_at DESC, p.id DESC
     LIMIT $1::int`,
    params,
  );

  const rows = result.rows.slice(0, limit);
  const nextCursor = !afterId && result.rows.length > limit && rows.length > 0
    ? encodeFeedCursor(rows[rows.length - 1])
    : null;
  const page = { rows, nextCursor };
  setFeedCache(cacheKey, page);
  return { ...page, cacheHit: false };
}

async function setPostReaction(postId, viewerId, liked) {
  const result = liked
    ? await db.query(
      `WITH target AS (
         SELECT id FROM social_posts WHERE id = $1::bigint AND status = 'active'
       ),
       ins AS (
         INSERT INTO social_post_likes (post_id, user_id)
         SELECT id, $2 FROM target
         ON CONFLICT (post_id, user_id) DO NOTHING
         RETURNING post_id
       ),
       upd AS (
         UPDATE social_posts
         SET likes_count = likes_count + 1
         WHERE id = $1::bigint AND EXISTS (SELECT 1 FROM ins)
         RETURNING likes_count
       )
       SELECT
         EXISTS (SELECT 1 FROM target) AS exists,
         COALESCE((SELECT likes_count FROM upd), (SELECT likes_count FROM social_posts WHERE id = $1::bigint), 0) AS likes_count`,
      [postId, viewerId],
    )
    : await db.query(
      `WITH target AS (
         SELECT id FROM social_posts WHERE id = $1::bigint AND status = 'active'
       ),
       del AS (
         DELETE FROM social_post_likes
         WHERE post_id = $1::bigint
           AND user_id = $2
           AND EXISTS (SELECT 1 FROM target)
         RETURNING post_id
       ),
       upd AS (
         UPDATE social_posts
         SET likes_count = GREATEST(0, likes_count - 1)
         WHERE id = $1::bigint AND EXISTS (SELECT 1 FROM del)
         RETURNING likes_count
       )
       SELECT
         EXISTS (SELECT 1 FROM target) AS exists,
         COALESCE((SELECT likes_count FROM upd), (SELECT likes_count FROM social_posts WHERE id = $1::bigint), 0) AS likes_count`,
      [postId, viewerId],
    );

  const row = result.rows[0] || {};
  if (row.exists !== true && row.exists !== 't') return null;
  patchCachedLikes(postId, row.likes_count);
  return mapSocialReaction(postId, row, liked);
}

router.use(requireGatewayService);

router.get('/feed', async (req, res) => {
  try {
    const viewerId = readViewerId(req, res);
    if (!viewerId) return;

    const limit = parseFeedLimit(req.query.limit);
    const cursor = decodeFeedCursor(req.query.cursor);
    const afterRaw = req.query.after;
    const afterId = parsePositiveBigIntString(afterRaw);
    if (afterRaw !== undefined && afterRaw !== null && String(afterRaw).trim() !== '' && !afterId) {
      return res.status(400).json({ error: 'Invalid feed update cursor', code: 'SOCIAL_AFTER_INVALID' });
    }

    const page = await readPublicFeedPage({ limit, cursor, afterId });
    const visibleRows = await attachViewerState(page.rows, viewerId);

    res.set('Cache-Control', 'private, max-age=8, stale-while-revalidate=15');
    res.set('X-Social-Feed-Cache', page.cacheHit ? 'HIT' : 'MISS');
    res.json({
      posts: visibleRows.map(mapSocialPostRow),
      page: {
        nextCursor: page.nextCursor,
        hasMore: Boolean(page.nextCursor),
      },
    });
  } catch (error) {
    console.error('Social feed read error:', error);
    res.status(500).json({ error: 'Social feed failed', code: 'SOCIAL_FEED_ERROR' });
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

    clearFeedCache();
    const post = await getPostView(created.rows[0].id, viewerId);
    res.status(201).json({ post });
  } catch (error) {
    console.error('Social post create error:', error);
    res.status(500).json({ error: 'Social post create failed', code: 'SOCIAL_CREATE_ERROR' });
  }
});

router.post('/posts/:id/like', reactionLimiter, async (req, res) => {
  try {
    const viewerId = readViewerId(req, res);
    if (!viewerId) return;

    const postId = parsePositiveBigIntString(req.params.id);
    if (!postId) {
      return res.status(400).json({ error: 'Invalid post id', code: 'SOCIAL_POST_ID_INVALID' });
    }

    const reaction = await setPostReaction(postId, viewerId, true);
    if (!reaction) {
      return res.status(404).json({ error: 'Post not found', code: 'SOCIAL_POST_NOT_FOUND' });
    }

    res.json({ reaction });
  } catch (error) {
    console.error('Social post like error:', error);
    res.status(500).json({ error: 'Social like failed', code: 'SOCIAL_LIKE_ERROR' });
  }
});

router.delete('/posts/:id/like', reactionLimiter, async (req, res) => {
  try {
    const viewerId = readViewerId(req, res);
    if (!viewerId) return;

    const postId = parsePositiveBigIntString(req.params.id);
    if (!postId) {
      return res.status(400).json({ error: 'Invalid post id', code: 'SOCIAL_POST_ID_INVALID' });
    }

    const reaction = await setPostReaction(postId, viewerId, false);
    if (!reaction) {
      return res.status(404).json({ error: 'Post not found', code: 'SOCIAL_POST_NOT_FOUND' });
    }

    res.json({ reaction });
  } catch (error) {
    console.error('Social post unlike error:', error);
    res.status(500).json({ error: 'Social unlike failed', code: 'SOCIAL_UNLIKE_ERROR' });
  }
});

router.delete('/posts/:id', async (req, res) => {
  try {
    const viewerId = readViewerId(req, res);
    if (!viewerId) return;

    const postId = parsePositiveBigIntString(req.params.id);
    if (!postId) {
      return res.status(400).json({ error: 'Invalid post id', code: 'SOCIAL_POST_ID_INVALID' });
    }

    const result = await db.query(
      `UPDATE social_posts
       SET status = $3,
           deleted_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1::bigint
         AND user_id = $2
         AND status = $4
       RETURNING id::text`,
      [postId, viewerId, POST_STATUS.DELETED, POST_STATUS.ACTIVE],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found', code: 'SOCIAL_POST_NOT_FOUND' });
    }

    clearFeedCache();
    res.json({ deleted: true, id: result.rows[0].id });
  } catch (error) {
    console.error('Social post delete error:', error);
    res.status(500).json({ error: 'Social delete failed', code: 'SOCIAL_DELETE_ERROR' });
  }
});

module.exports = router;
