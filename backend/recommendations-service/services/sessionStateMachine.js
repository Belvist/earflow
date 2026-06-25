/**
 * Recommendation session state machine — single backend owner for reco session lifecycle.
 * States: idle | active | skip_burst | expired
 * @module services/sessionStateMachine
 */

const config = require('../config');
const redis = require('../lib/redis');
const { validateSecureSessionId } = require('../lib/sessionSecurity');

const SESSION_STATE = Object.freeze({
  IDLE: 'idle',
  ACTIVE: 'active',
  SKIP_BURST: 'skip_burst',
  EXPIRED: 'expired',
});

function skipBurstThreshold() {
  return Math.max(1, Number(config.engineV2.skipBurstThreshold) || 3);
}

function sessionIntentWeight(payload) {
  const action = typeof payload?.action === 'string' ? payload.action : '';
  const durationSeconds = Math.max(0, Number(payload?.duration) || 0) / 1000;
  const progress = Number(payload?.progress);
  const positiveByDuration = durationSeconds >= config.engineV2.onlineIntentPositivePlayMinSeconds;
  const positiveByProgress = Number.isFinite(progress) && progress >= config.engineV2.onlineIntentPositivePlayMinProgress;
  const lateSkip = Number.isFinite(progress) && progress >= config.engineV2.onlineIntentLateSkipMinProgress;

  if (action === 'like') return { polarity: 'positive', weight: config.engineV2.onlineIntentLikeWeight };
  if (action === 'complete') return { polarity: 'positive', weight: config.engineV2.onlineIntentCompleteWeight };
  if (action === 'dislike') return { polarity: 'negative', weight: config.engineV2.onlineIntentDislikeWeight };
  if (action === 'skip' && lateSkip) return { polarity: 'positive', weight: config.engineV2.onlineIntentLateSkipWeight };
  if (action === 'skip') return { polarity: 'negative', weight: config.engineV2.onlineIntentShortSkipWeight };

  if (action === 'play' && (positiveByDuration || positiveByProgress)) {
    return { polarity: 'positive', weight: config.engineV2.onlineIntentLongPlayWeight };
  }

  return null;
}

async function touchSessionIfValid(userId, sessionId) {
  if (!sessionId || typeof sessionId !== 'string') {
    return false;
  }
  return redis.touchEphemeralSession(userId, sessionId, config.engineV2.sessionTtlSeconds);
}

async function readSkipBurstCount(userId) {
  try {
    return await redis.getSkipBurstCount(userId);
  } catch {
    return 0;
  }
}

function isSkipBurstMode(count) {
  return Number(count) >= skipBurstThreshold();
}

/**
 * @param {number} userId
 * @param {string|null|undefined} sessionId
 * @param {{ skipBurstCount?: number }} [hints]
 */
async function resolveSessionState(userId, sessionId, hints = {}) {
  const sid = typeof sessionId === 'string' ? sessionId.trim() : '';
  const burstCount = Number.isFinite(Number(hints.skipBurstCount))
    ? Number(hints.skipBurstCount)
    : await readSkipBurstCount(userId);

  if (isSkipBurstMode(burstCount)) {
    return {
      state: SESSION_STATE.SKIP_BURST,
      skipBurstCount: burstCount,
      skipBurstMode: true,
      sessionValid: sid.length > 0 && validateSecureSessionId(sid, userId).valid,
    };
  }

  if (!sid) {
    return {
      state: SESSION_STATE.IDLE,
      skipBurstCount: burstCount,
      skipBurstMode: false,
      sessionValid: false,
    };
  }

  const validation = validateSecureSessionId(sid, userId);
  if (!validation.valid) {
    return {
      state: SESSION_STATE.EXPIRED,
      skipBurstCount: burstCount,
      skipBurstMode: false,
      sessionValid: false,
    };
  }

  const touched = await touchSessionIfValid(userId, sid);
  if (!touched) {
    return {
      state: SESSION_STATE.EXPIRED,
      skipBurstCount: burstCount,
      skipBurstMode: false,
      sessionValid: false,
    };
  }

  return {
    state: SESSION_STATE.ACTIVE,
    skipBurstCount: burstCount,
    skipBurstMode: false,
    sessionValid: true,
  };
}

function buildClientActions({ shouldRefresh = false, skipBurstMode = false } = {}) {
  return {
    refreshRecommended: shouldRefresh === true,
    skipBurstMode: skipBurstMode === true,
  };
}

function buildSessionStateDto(resolved) {
  return {
    state: resolved.state,
    skipBurstCount: Math.max(0, Number(resolved.skipBurstCount) || 0),
    skipBurstMode: resolved.skipBurstMode === true,
    sessionValid: resolved.sessionValid === true,
  };
}

/**
 * Enrich init/next/infinite/refresh payloads with sessionState + clientActions.
 */
async function enrichDeliveryResponse(userId, sessionId, payload = {}) {
  const resolved = await resolveSessionState(userId, sessionId);
  const out = { ...payload };
  out.sessionState = buildSessionStateDto(resolved);
  out.clientActions = buildClientActions({
    shouldRefresh: false,
    skipBurstMode: resolved.skipBurstMode,
  });
  return out;
}

/**
 * Realtime feedback side-effects (exclude, intent, skip burst). Returns ack for client.
 */
async function applyFeedbackRealtime(userId, sessionId, interaction) {
  const trackId = interaction.trackId;
  const sid = typeof sessionId === 'string' ? sessionId.trim() : '';
  const sessionOk = sid
    ? await touchSessionIfValid(userId, sid)
    : false;
  const intent = sessionIntentWeight(interaction);

  if (interaction.action === 'skip') {
    const writes = [redis.markSkipTrack(userId, trackId)];
    if (intent?.polarity === 'negative') {
      writes.push(redis.incrementSkipBurst(userId));
    }
    await Promise.all(writes);
    if (sessionOk) {
      await redis.appendSessionExcludeIds(
        sid,
        [trackId],
        config.recommendations.maxExcludeIds,
        config.engineV2.sessionTtlSeconds
      );
    }
  } else if (interaction.action === 'dislike') {
    await Promise.all([
      redis.markDislikeTrack(userId, trackId),
      redis.markRecentTrack(userId, trackId),
    ]);
    if (sessionOk) {
      await redis.appendSessionExcludeIds(
        sid,
        [trackId],
        config.recommendations.maxExcludeIds,
        config.engineV2.sessionTtlSeconds
      );
    }
  } else {
    await redis.markRecentTrack(userId, trackId);
  }

  if (sessionOk && intent) {
    await redis.appendSessionIntentTrack(
      sid,
      trackId,
      intent.polarity,
      intent.weight,
      config.engineV2.sessionTtlSeconds
    );
  }

  const skipBurstCount = await readSkipBurstCount(userId);
  const skipBurstMode = isSkipBurstMode(skipBurstCount);
  const negativeAction = interaction.action === 'skip' || interaction.action === 'dislike';
  const shouldRefresh = negativeAction && skipBurstMode;

  const resolved = await resolveSessionState(userId, sessionOk ? sid : null, { skipBurstCount });

  return {
    sessionState: buildSessionStateDto(resolved),
    clientActions: buildClientActions({ shouldRefresh, skipBurstMode }),
  };
}

module.exports = {
  SESSION_STATE,
  sessionIntentWeight,
  resolveSessionState,
  enrichDeliveryResponse,
  applyFeedbackRealtime,
  buildClientActions,
  buildSessionStateDto,
};
