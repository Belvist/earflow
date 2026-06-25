/**
 * Recommendations API Routes
 * @module routes/recommendations
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { createLogger, logEvent, logError } = require('../lib/logger');
const {
  ValidationError,
  validateInitPayload,
  validateNextPayload,
  validateInfinitePayload,
  validateFeedbackPayload,
  validateBatchFeedbackPayload,
  validatePlaybackRatePreferencePayload,
  validateSimilarPayload,
  validateRadioPayload,
  sanitizeSessionId,
} = require('../lib/validators');
const redis = require('../lib/redis');
const { applyCorsHeaders } = require('../lib/corsHeaders');
const { upsertUserGenrePlaybackRate, loadUserGenrePlaybackRates } = require('../lib/database');
const {
  recommendationsServed,
  sessionsCreated,
  recommendationImpressionsTotal,
  recommendationEmptyResponsesTotal,
  recommendationGenreDiversityRatio,
} = require('../metrics');

const engineV2 = require('../services/engineV2');
const { infiniteFeedV2 } = require('../services/engineV2/infinite');
const { explainInfiniteV2 } = require('../services/engineV2/explain');
const { applyFeedbackRealtime } = require('../services/sessionStateMachine');
const { query } = require('../lib/database');

const logger = createLogger('recommendations-routes');
const router = express.Router();

// ============================================
// Per-User Rate Limiting
// Каждый limiter требует отдельный RedisStore instance
// ============================================

/**
 * Фабрика для создания Redis store с уникальным prefix
 */
function createRedisStore(prefixSuffix) {
  if (!config.rateLimiting.useRedisStore) {
    return undefined; // Используем memory store
  }

  try {
    const RedisStore = require('rate-limit-redis').default;
    return new RedisStore({
      sendCommand: async (...args) => {
        const client = await redis.getClient();
        return client.sendCommand(args);
      },
      prefix: `${config.redisKeys.prefix}rl:${prefixSuffix}:`,
    });
  } catch (err) {
    logError(err, `rate-limit-store-${prefixSuffix}`);
    return undefined;
  }
}

async function recordRecommendationSideEffects(userId, sessionId, tracks, contextTag) {
  const list = Array.isArray(tracks) ? tracks : [];
  if (sessionId && list.length > 0) {
    try {
      await redis.addSessionImpressions(sessionId, list.map((t) => t.id));
    } catch (err) {
      logError(err, `session-impressions-${contextTag}`);
    }
  }

  if (list.length > 0) {
    try {
      await redis.addDailySeen(userId, list.map((t) => t.id));
    } catch (err) {
      logError(err, `daily-seen-${contextTag}`);
    }
  }
}

async function refreshV2(userId, preferences, limit, previousSessionId = null) {
  let migratedExcludeIds = [];
  if (previousSessionId && typeof previousSessionId === 'string') {
    try {
      const ok = await redis.touchEphemeralSession(userId, previousSessionId, config.engineV2.sessionTtlSeconds);
      if (ok) {
        migratedExcludeIds = await redis.loadSessionExcludeIds(previousSessionId);
      }
    } catch {
      migratedExcludeIds = [];
    }
  }

  const migrated = Array.isArray(migratedExcludeIds) ? migratedExcludeIds : [];

  const result = await engineV2.initSessionV2(userId, preferences, true, limit, migrated);
  const tracks = Array.isArray(result.tracks) ? result.tracks : [];

  sessionsCreated.inc();
  recommendationsServed.inc({ endpoint: 'refresh', source: 'session' });

  await recordRecommendationSideEffects(userId, result.sessionId, tracks, 'refresh');

  logEvent('recommendations-refreshed', {
    userId,
    sessionId: result.sessionId,
    tracksCount: tracks.length,
    excludesMigrated: 0,
  });

  return {
    ...result,
    refreshed: true,
  };
}

/**
 * Кастомный handler для добавления CORS headers к ответам rate limiter
 */
const createRateLimitHandler = (message) => (req, res) => {
  applyCorsHeaders(req, res);
  res.status(429).json({
    error: message,
    retryAfter: Math.ceil(config.rateLimiting.windowMs / 1000),
  });
};

/**
 * Per-user rate limiter для feedback endpoints
 * Ограничивает количество feedback событий на пользователя
 */
const feedbackLimiter = rateLimit({
  windowMs: config.rateLimiting.windowMs,
  max: config.rateLimiting.feedbackPerUser,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.user?.id || 'anon'}`,
  handler: createRateLimitHandler('Too many feedback requests, please slow down'),
  store: createRedisStore('feedback'),
  skip: (req) => !req.user?.id,
});

/**
 * Per-user rate limiter для API endpoints (init, next, infinite)
 * Защита от спама сессиями и запросами рекомендаций
 */
const apiLimiter = rateLimit({
  windowMs: config.rateLimiting.windowMs,
  max: config.rateLimiting.apiPerUser || 500, // Увеличен лимит
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.user?.id || 'anon'}`,
  handler: createRateLimitHandler('Too many requests, please slow down'),
  store: createRedisStore('api'),
  skip: (req) => !req.user?.id,
});

const refreshLimiter = rateLimit({
  windowMs: config.rateLimiting.windowMs,
  max: config.rateLimiting.refreshPerUser || Math.max((config.rateLimiting.apiPerUser || 500) * 4, 2000),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.user?.id || 'anon'}`,
  handler: createRateLimitHandler('Too many refresh requests, please slow down'),
  store: createRedisStore('refresh'),
  skip: (req) => !req.user?.id,
});

router.get('/playback-rate', apiLimiter, async (req, res, next) => {
  try {
    const userId = Number.parseInt(req.user?.id, 10);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(400).json({ error: 'Invalid userId' });
    }

    const genresRaw = req.query?.genres;
    let genres = [];
    if (Array.isArray(genresRaw)) {
      genres = genresRaw;
    } else if (typeof genresRaw === 'string' && genresRaw.length > 0) {
      genres = [genresRaw];
    }

    if (genres.length === 0) {
      return res.json({ rates: {} });
    }

    const limited = genres.slice(0, 50).map(String);
    const map = await loadUserGenrePlaybackRates(userId, limited);
    const rates = {};
    for (const [k, v] of map.entries()) {
      rates[k] = v;
    }

    return res.json({ rates });
  } catch (err) {
    next(err);
  }
});

router.post('/playback-rate', apiLimiter, async (req, res, next) => {
  try {
    const payload = validatePlaybackRatePreferencePayload(req.user.id, req.body || {});
    await upsertUserGenrePlaybackRate(payload.userId, payload.genre, payload.playbackRate);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/**
 * Stricter rate limiter для создания сессий
 * Защита от спама созданием сессий
 */
const sessionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: config.rateLimiting.sessionsPerUserPerHour || 50, // Увеличен лимит
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.user?.id || 'anon'}`,
  handler: (req, res) => {
    applyCorsHeaders(req, res);
    res.status(429).json({
      error: 'Too many sessions created, please wait',
      retryAfter: 3600,
    });
  },
  store: createRedisStore('session'),
  skip: (req) => !req.user?.id || req._recoSkipSessionLimit === true,
});

const attachActiveSessionForInit = async (req, res, next) => {
  try {
    if (!req.user?.id) return next();
    if (req.body && req.body.forceNew === true) return next();
    const activeSessionId = await redis.getActiveSessionId(req.user.id, { engine: config.engine });
    if (!activeSessionId) return next();
    const session = await redis.loadSession(activeSessionId);
    if (!session || typeof session !== 'object') return next();
    if (Number(session.userId) !== Number(req.user.id)) return next();

    req._recoExistingSessionId = activeSessionId;
    req._recoSkipSessionLimit = true;
    return next();
  } catch {
    return next();
  }
};

/**
 * POST /api/recommendations/init
 * Инициализация сессии рекомендаций
 * Rate limited: stricter limit для создания сессий
 */
router.post('/init', attachActiveSessionForInit, sessionLimiter, apiLimiter, async (req, res, next) => {
  try {
    const payload = validateInitPayload(req.user.id, req.body || {});

    const result = await engineV2.initSessionV2(
      payload.userId,
      payload.preferences,
      payload.forceNew,
      payload.limit,
      payload.excludeIds
    );

    sessionsCreated.inc();
    recommendationsServed.inc({ endpoint: 'init', source: 'session' });

    const tracks = Array.isArray(result.tracks) ? result.tracks : [];
    if (tracks.length === 0) {
      recommendationEmptyResponsesTotal.inc({ endpoint: 'init' });
      recommendationGenreDiversityRatio.set({ endpoint: 'init' }, 0);
    } else {
      recommendationImpressionsTotal.inc({ endpoint: 'init', source: 'session' }, tracks.length);
      const genreSet = new Set(tracks.map((t) => String(t?.genre || '').trim().toLowerCase()).filter(Boolean));
      recommendationGenreDiversityRatio.set({ endpoint: 'init' }, genreSet.size / tracks.length);
    }

    if (result.sessionId && tracks.length > 0) {
      try {
        await redis.addSessionImpressions(result.sessionId, tracks.map((t) => t.id));
      } catch (err) {
        logError(err, 'session-impressions-init');
      }
    }

    if (tracks.length > 0) {
      try {
        await redis.addDailySeen(payload.userId, tracks.map((t) => t.id));
      } catch (err) {
        logError(err, 'daily-seen-init');
      }
    }

    logEvent('session-created', {
      userId: payload.userId,
      sessionId: result.sessionId,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/recommendations/next
 * Получение следующего батча рекомендаций
 * Rate limited per-user
 */
router.post('/next', apiLimiter, async (req, res, next) => {
  try {
    const payload = validateNextPayload(req.user.id, req.body || {});

    const result = await engineV2.nextBatchV2(
      payload.userId,
      payload.sessionId,
      payload.count,
      payload.excludeIds
    );

    recommendationsServed.inc({ endpoint: 'next', source: 'batch' });

    const tracks = Array.isArray(result.tracks) ? result.tracks : [];
    if (tracks.length === 0) {
      recommendationEmptyResponsesTotal.inc({ endpoint: 'next' });
      recommendationGenreDiversityRatio.set({ endpoint: 'next' }, 0);
    } else {
      recommendationImpressionsTotal.inc({ endpoint: 'next', source: 'batch' }, tracks.length);
      const genreSet = new Set(tracks.map((t) => String(t?.genre || '').trim().toLowerCase()).filter(Boolean));
      recommendationGenreDiversityRatio.set({ endpoint: 'next' }, genreSet.size / tracks.length);
    }

    if (payload.sessionId && tracks.length > 0) {
      try {
        await redis.addSessionImpressions(payload.sessionId, tracks.map((t) => t.id));
      } catch (err) {
        logError(err, 'session-impressions-next');
      }
    }

    if (tracks.length > 0) {
      try {
        await redis.addDailySeen(payload.userId, tracks.map((t) => t.id));
      } catch (err) {
        logError(err, 'daily-seen-next');
      }
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/recommendations/infinite
 * Получение бесконечного фида рекомендаций
 * Rate limited per-user
 */
router.post('/infinite', apiLimiter, async (req, res, next) => {
  try {
    const payload = validateInfinitePayload(req.user.id, req.body || {});

    const result = await infiniteFeedV2(
      payload.userId,
      payload.sessionId,
      payload.offset,
      payload.limit,
      payload.excludeIds
    );

    recommendationsServed.inc({ endpoint: 'infinite', source: 'feed' });

    const tracks = Array.isArray(result.tracks) ? result.tracks : [];
    if (tracks.length === 0) {
      recommendationEmptyResponsesTotal.inc({ endpoint: 'infinite' });
      recommendationGenreDiversityRatio.set({ endpoint: 'infinite' }, 0);
    } else {
      recommendationImpressionsTotal.inc({ endpoint: 'infinite', source: 'feed' }, tracks.length);
      const genreSet = new Set(tracks.map((t) => String(t?.genre || '').trim().toLowerCase()).filter(Boolean));
      recommendationGenreDiversityRatio.set({ endpoint: 'infinite' }, genreSet.size / tracks.length);
    }

    if (payload.sessionId && tracks.length > 0) {
      try {
        await redis.addSessionImpressions(payload.sessionId, tracks.map((t) => t.id));
      } catch (err) {
        logError(err, 'session-impressions-infinite');
      }
    }

    if (tracks.length > 0) {
      try {
        await redis.addDailySeen(payload.userId, tracks.map((t) => t.id));
      } catch (err) {
        logError(err, 'daily-seen-infinite');
      }
    }

    res.json({
      ...result,
      sessionId: result.sessionId || payload.sessionId || null,
      nextOffset: typeof result.offset === 'number' ? result.offset : payload.offset,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/recommendations/feedback
 * Отправка фидбека об одном треке
 * Rate limited per-user
 */
router.post('/feedback', feedbackLimiter, async (req, res, next) => {
  try {
    const payload = validateFeedbackPayload(req.user.id, req.body || {});

    let ack = { sessionState: null, clientActions: { refreshRecommended: false, skipBurstMode: false } };
    try {
      ack = await applyFeedbackRealtime(payload.userId, payload.sessionId, {
        trackId: payload.trackId,
        action: payload.action,
        duration: payload.duration,
        progress: payload.progress,
      });
    } catch (err) {
      logError(err, 'realtime-exclusion-feedback');
    }

    const event = {
      type: 'single',
      userId: payload.userId,
      sessionId: payload.sessionId,
      trackId: payload.trackId,
      action: payload.action,
      duration: payload.duration,
      progress: payload.progress,
      eventId: payload.eventId,
      playbackSessionId: payload.playbackSessionId,
      schemaVersion: payload.schemaVersion,
      eventTime: payload.eventTime,
      context: payload.context,
      timestamp: Date.now(),
    };

    await redis.enqueueFeedback(event);

    res.json({
      success: true,
      sessionState: ack.sessionState,
      clientActions: ack.clientActions,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/recommendations/batch-complete
 * Отправка batch фидбека о нескольких треках
 * Rate limited per-user
 */
router.post('/batch-complete', feedbackLimiter, async (req, res, next) => {
  try {
    const payload = validateBatchFeedbackPayload(req.user.id, req.body || {});

    let lastAck = { sessionState: null, clientActions: { refreshRecommended: false, skipBurstMode: false } };
    try {
      for (const interaction of payload.interactions) {
        lastAck = await applyFeedbackRealtime(payload.userId, payload.sessionId, {
          trackId: interaction.trackId,
          action: interaction.action,
          duration: interaction.duration,
          progress: interaction.progress,
        });
      }
    } catch (err) {
      logError(err, 'realtime-exclusion-batch-feedback');
    }

    const event = {
      type: 'batch',
      userId: payload.userId,
      sessionId: payload.sessionId,
      batchId: payload.batchId,
      interactions: payload.interactions,
      timestamp: Date.now(),
    };

    await redis.enqueueFeedback(event);

    logEvent('batch-feedback-enqueued', {
      userId: payload.userId,
      interactionCount: payload.interactions.length,
    });

    res.json({
      success: true,
      interactionsProcessed: payload.interactions.length,
      sessionState: lastAck.sessionState,
      clientActions: lastAck.clientActions,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/recommendations/similar
 * Получение похожих треков для заданного трека
 * Использует content-based filtering (audio features) + artist/genre
 * Rate limited per-user
 */
router.post('/similar', apiLimiter, async (req, res, next) => {
  try {
    const payload = validateSimilarPayload(req.user.id, req.body || {});
    const { deliverSimilarTracks } = require('../services/engineV2/trackSeed');

    const result = await deliverSimilarTracks(payload.userId, payload.trackId, payload.limit);

    recommendationsServed.inc({ endpoint: 'similar', source: 'engine-v2-track-seed' });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/recommendations/radio
 * Радио на основе трека — Engine V2 track seed + rankPipeline
 */
router.post('/radio', apiLimiter, async (req, res, next) => {
  try {
    const payload = validateRadioPayload(req.user.id, req.body || {});
    const { deliverRadioTracks } = require('../services/engineV2/trackSeed');

    const result = await deliverRadioTracks(
      payload.userId,
      payload.trackId,
      payload.limit,
      payload.sessionId
    );

    recommendationsServed.inc({ endpoint: 'radio', source: 'engine-v2-track-seed' });

    logEvent('radio-generated', {
      sourceTrackId: payload.trackId,
      tracksCount: result.count,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/recommendations/refresh
 * Принудительное обновление рекомендаций пользователя
 * НЕ очищает excludeIds - чтобы не показывать те же треки снова
 */
router.post('/refresh', refreshLimiter, async (req, res, next) => {
  try {
    const userId = Number(req.user?.id);
    if (!userId || !Number.isFinite(userId) || userId <= 0) {
      return res.status(400).json({ error: 'Invalid userId' });
    }

    const limit = Number(req.body?.limit ?? config.recommendations.defaultBatchSize);
    const preferences = req.body?.preferences || {};

    const previousSessionIdRaw = req.body?.sessionId ? String(req.body.sessionId) : '';
    let previousSessionId = null;
    if (previousSessionIdRaw) {
      try {
        previousSessionId = sanitizeSessionId(previousSessionIdRaw);
      } catch {
        previousSessionId = null;
      }
    }

    const result = await refreshV2(userId, preferences, limit, previousSessionId);

    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

router.post('/debug/explain', apiLimiter, async (req, res, next) => {
  try {
    const debugKey = config.debug?.recoDebugKey ? String(config.debug.recoDebugKey) : '';
    if (!debugKey || debugKey.length < 32) {
      return res.status(404).json({ error: 'Not found' });
    }

    const provided = req.headers['x-reco-debug-key'] ? String(req.headers['x-reco-debug-key']) : '';
    if (!provided || provided !== debugKey) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const userId = Number(req.user?.id);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(400).json({ error: 'Invalid userId' });
    }

    const sessionId = req.body?.sessionId ? String(req.body.sessionId) : null;
    const offset = Number(req.body?.offset ?? 0);
    const limit = Number(req.body?.limit ?? 20);
    const excludeIds = Array.isArray(req.body?.excludeIds) ? req.body.excludeIds : [];

    const report = await explainInfiniteV2(userId, sessionId, offset, limit, excludeIds);

    return res.json({ report });
  } catch (err) {
    next(err);
  }
});

router.get('/mood-radar', apiLimiter, async (req, res, next) => {
  try {
    const userId = Number.parseInt(req.user?.id, 10);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const moodResult = await query(`
      SELECT sm.mood, SUM(sm.confidence) / COUNT(*)::real AS avg_confidence, COUNT(*) AS track_count
      FROM song_moods sm
      JOIN user_history uh ON uh.song_id = sm.song_id
      WHERE uh.user_id = $1 AND uh.liked = TRUE
      GROUP BY sm.mood
      ORDER BY avg_confidence DESC
    `, [userId]);

    const profileResult = await query(
      'SELECT mood_vector FROM user_mood_profile WHERE user_id = $1',
      [userId]
    );

    const moods = {};
    for (const row of (moodResult.rows || [])) {
      moods[row.mood] = {
        confidence: Math.round(row.avg_confidence * 100) / 100,
        trackCount: Number(row.track_count),
      };
    }

    const tasteMix = Object.entries(moods)
      .sort((a, b) => b[1].confidence - a[1].confidence)
      .slice(0, 6)
      .map(([mood, data]) => ({ mood, ...data }));

    return res.json({
      moods,
      tasteMix,
      moodVector: profileResult.rows?.[0]?.mood_vector || null,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/mood-tracks/:mood', apiLimiter, async (req, res, next) => {
  try {
    const userId = Number.parseInt(req.user?.id, 10);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const mood = String(req.params.mood || '').trim().toLowerCase();
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 50);

    const allowed = ['energetic', 'calm', 'happy', 'melancholic', 'neutral', 'dark', 'romantic', 'focus'];
    if (!allowed.includes(mood)) {
      return res.status(400).json({ error: 'Invalid mood', allowed });
    }

    const result = await query(`
      SELECT s.id, s.title, s.artist, s.album, s.duration, s.genre, s.cover_path,
             sm.confidence AS mood_confidence
      FROM song_moods sm
      JOIN songs s ON s.id = sm.song_id
      WHERE sm.mood = $1
      ORDER BY sm.confidence DESC, s.popularity DESC NULLS LAST
      LIMIT $2
    `, [mood, limit]);

    return res.json({ mood, tracks: result.rows || [] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
