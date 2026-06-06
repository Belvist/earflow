import { useState, useEffect, useCallback, useRef, startTransition } from 'react';
import apiClient from '../api/client';

// Срок жизни персистентного кэша рекомендаций: 90 минут.
// Раньше было 12ч, из-за чего один и тот же набор показывался целый день
// (после hydration ленты на том же sessionId) — пользователи жаловались,
// что «рекомендации постоянные».
// Effective TTL: 5 minutes.
const RECO_CACHE_TTL_MS = 5 * 60 * 1000;

// Если вкладка была скрыта дольше этого времени и пользователь вернулся,
// безопасно попробовать обновить рекомендации (но не чаще cooldown из
// refreshRecommendations, т.е. не чаще 15 c и с учётом backoff при 429).
// Effective hidden-tab staleness threshold: 5 minutes.
const RECO_STALENESS_AFTER_MS = 5 * 60 * 1000;
const RECO_SKIP_BURST_WINDOW_MS = 90 * 1000;
const RECO_SKIP_BURST_THRESHOLD = 3;
const RECO_SKIP_REFRESH_DELAY_MS = 1200;
const RECO_SKIP_REFRESH_MIN_INTERVAL_MS = 90 * 1000;
const RECO_REFRESH_COOLDOWN_MS = 60 * 1000;

const normalizeInitOptions = (options) => {
  const forceNew = options?.forceNew === true;
  const initLimitRaw = options?.limit == null ? 40 : Number(options.limit);
  const initLimit = Number.isFinite(initLimitRaw)
    ? Math.min(Math.max(Math.floor(initLimitRaw), 1), 100)
    : 20;

  return { forceNew, initLimit };
};

const normalizeUserId = (userId) => {
  const numericUserId = Number.parseInt(String(userId), 10);
  if (!Number.isFinite(numericUserId) || numericUserId <= 0) {
    throw new Error(`Invalid userId: ${userId}`);
  }
  return numericUserId;
};

const getErrorStatus = (err) => {
  if (!err || typeof err !== 'object') return null;
  const raw = err.status ?? err.responseStatus ?? err.response?.status;
  const status = Number(raw);
  return Number.isFinite(status) ? status : null;
};

const isAuthDegradedStatus = (status) => status === 401 || status === 403;

const normalizeHasMore = (value, tracksLength) => {
  if (tracksLength > 0) {
    return true;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return false;
};

const createEventId = () => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const recoStorageKey = (userId) => {
  const uid = userId == null ? '' : String(userId).trim();
  return uid ? `reco:v2:resume:${uid}` : '';
};

const safeParseJson = (raw) => {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const isSafeSessionId = (value) => {
  if (!value || typeof value !== 'string') return false;
  const v = value.trim();
  if (v.length < 10 || v.length > 200) return false;
  return /^[A-Za-z0-9_:\-.]+$/.test(v);
};

const normalizePersistedIds = (ids, max = 1000) => {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(ids) ? ids : []) {
    const id = Number.parseInt(raw, 10);
    if (!Number.isFinite(id) || id <= 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
};

const normalizePersistedTracks = (tracks, max = 120) => {
  if (!Array.isArray(tracks) || tracks.length === 0) return [];
  const sliceStart = Math.max(0, tracks.length - max);
  const window = tracks.slice(sliceStart);
  const seen = new Set();
  const out = [];
  for (const t of window) {
    if (!t || typeof t !== 'object') continue;
    const id = t.id == null ? null : Number.parseInt(String(t.id), 10);
    if (!Number.isFinite(id) || id <= 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(t);
  }
  return out;
};

const normalizeRecommendationMeta = (meta) => {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const mode = typeof meta.mode === 'string' ? meta.mode.trim() : '';
  if (!['personalized', 'cold_start', 'discovery_only'].includes(mode)) return null;
  const strength = Number(meta.profileStrength);
  const profileStrength = Number.isFinite(strength) ? Math.min(Math.max(strength, 0), 1) : 0;
  const sourceMix = meta.sourceMix && typeof meta.sourceMix === 'object' && !Array.isArray(meta.sourceMix)
    ? meta.sourceMix
    : null;
  const sourceCounts = meta.sourceCounts && typeof meta.sourceCounts === 'object' && !Array.isArray(meta.sourceCounts)
    ? meta.sourceCounts
    : null;
  const servedBucketCounts = meta.servedBucketCounts && typeof meta.servedBucketCounts === 'object' && !Array.isArray(meta.servedBucketCounts)
    ? meta.servedBucketCounts
    : null;
  const candidateCount = Number(meta.candidateCount);
  const recentTrackCount = Number(meta.recentTrackCount);
  return {
    mode,
    personalized: mode === 'personalized',
    profileStrength,
    sourceMix,
    sourceCounts,
    servedBucketCounts,
    candidateCount: Number.isFinite(candidateCount) && candidateCount >= 0 ? Math.floor(candidateCount) : 0,
    recentTrackCount: Number.isFinite(recentTrackCount) && recentTrackCount >= 0 ? Math.floor(recentTrackCount) : 0,
    skipBurstMode: meta.skipBurstMode === true,
  };
};

const mergeUniqueTracks = (baseTracks, incomingTracks, max = 180) => {
  const out = [];
  const seen = new Set();
  const append = (track) => {
    if (!track || typeof track !== 'object') return;
    const id = track.id == null ? '' : String(track.id).trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(track);
  };
  for (const track of Array.isArray(baseTracks) ? baseTracks : []) append(track);
  for (const track of Array.isArray(incomingTracks) ? incomingTracks : []) append(track);
  return out.slice(0, max);
};

export const useRecommendations = (userId, options = {}) => {
  const autoInitialize = options?.autoInitialize !== false;
  const onAuthDegraded = typeof options?.onAuthDegraded === 'function'
    ? options.onAuthDegraded
    : null;
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);
  const [error, setError] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [recommendationMeta, setRecommendationMeta] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hydrationDone, setHydrationDone] = useState(false);
  const tracksRef = useRef([]);
  const hasMoreRef = useRef(true);

  useEffect(() => {
    tracksRef.current = Array.isArray(tracks) ? tracks : [];
  }, [tracks]);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  const playedTrackIds = useRef(new Set());
  const currentBatch = useRef([]);
  const isInitializing = useRef(false);
  const initWaitersRef = useRef([]);
  const activeRequestControllersRef = useRef(new Map());
  const lastRefreshAtRef = useRef(0);
  const refreshInFlightRef = useRef(false);
  const refreshBackoffUntilRef = useRef(0);
  const refreshRecommendationsRef = useRef(null);
  const skipBurstRef = useRef({ count: 0, firstAt: 0, lastRefreshAt: 0 });
  const realtimeRefreshTimerRef = useRef(0);
  const prevUserIdRef = useRef('');
  const hydrationDoneRef = useRef(false);
  const hydrationHadSessionRef = useRef(false);
  const persistTimerRef = useRef(0);

  useEffect(() => {
    const nextUserId = userId == null ? '' : String(userId);
    if (prevUserIdRef.current === nextUserId) return;
    prevUserIdRef.current = nextUserId;

    const controllers = activeRequestControllersRef.current;
    if (controllers && typeof controllers.values === 'function') {
      for (const ctrl of controllers.values()) {
        try {
          ctrl.abort();
        } catch (e) {
          void e;
        }
      }
      try {
        controllers.clear();
      } catch (e) {
        void e;
      }
    }

    isInitializing.current = false;
    const waiters = initWaitersRef.current;
    initWaitersRef.current = [];
    if (Array.isArray(waiters) && waiters.length > 0) {
      for (const resolve of waiters) {
        try {
          resolve([]);
        } catch (e) {
          void e;
        }
      }
    }
    lastRefreshAtRef.current = 0;
    refreshInFlightRef.current = false;
    refreshBackoffUntilRef.current = 0;
    skipBurstRef.current = { count: 0, firstAt: 0, lastRefreshAt: 0 };
    if (realtimeRefreshTimerRef.current) {
      try { window.clearTimeout(realtimeRefreshTimerRef.current); } catch { }
      realtimeRefreshTimerRef.current = 0;
    }

    playedTrackIds.current = new Set();
    currentBatch.current = [];

    hydrationDoneRef.current = false;
    hydrationHadSessionRef.current = false;
    setHydrationDone(false);
    if (persistTimerRef.current) {
      try { window.clearTimeout(persistTimerRef.current); } catch { }
      persistTimerRef.current = 0;
    }

    setTracks([]);
    setSessionId(null);
    setRecommendationMeta(null);
    setHasMore(true);
    setOffset(0);
    setError(null);
    setLoading(false);

    if (!nextUserId) {
      hydrationDoneRef.current = true;
      setHydrationDone(true);
      return;
    }

    try {
      if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
        hydrationDoneRef.current = true;
        setHydrationDone(true);
        return;
      }
      const key = recoStorageKey(nextUserId);
      if (!key) {
        hydrationDoneRef.current = true;
        setHydrationDone(true);
        return;
      }
      const raw = localStorage.getItem(key);
      const persisted = safeParseJson(raw);
      const updatedAt = persisted && Number.isFinite(Number(persisted.updatedAt)) ? Number(persisted.updatedAt) : 0;
      if (!persisted || updatedAt <= 0 || Date.now() - updatedAt > RECO_CACHE_TTL_MS) {
        // Кэш устарел — не hydrate, позволим initializeSession получить свежие треки.
        try { localStorage.removeItem(key); } catch { /* ignore */ }
        hydrationDoneRef.current = true;
        setHydrationDone(true);
        return;
      }

      const sidRaw = persisted.sessionId && typeof persisted.sessionId === 'string' ? persisted.sessionId.trim() : '';
      const sid = isSafeSessionId(sidRaw) ? sidRaw : '';
      const snapshotTracks = normalizePersistedTracks(persisted.tracks);
      const ids = normalizePersistedIds(persisted.playedIds, 1000);
      const snapshotRecommendationMeta = normalizeRecommendationMeta(persisted.recommendationMeta);

      if (snapshotTracks.length > 0) {
        setTracks(snapshotTracks);
        currentBatch.current = snapshotTracks;
      }
      if (ids.length > 0) {
        playedTrackIds.current = new Set(ids);
      }
      if (snapshotTracks.length > 0) {
        for (const t of snapshotTracks) {
          const tid = t && t.id != null ? Number.parseInt(String(t.id), 10) : Number.NaN;
          if (Number.isFinite(tid) && tid > 0) {
            playedTrackIds.current.add(tid);
          }
        }
      }

      if (sid && snapshotTracks.length > 0) {
        hydrationHadSessionRef.current = true;
        setSessionId(sid);
      }

      setRecommendationMeta(snapshotRecommendationMeta);

      if (snapshotTracks.length > 0) {
        const safeOffsetRaw = Number(persisted.offset);
        const safeOffset = Number.isFinite(safeOffsetRaw) && safeOffsetRaw >= 0
          ? Math.floor(safeOffsetRaw)
          : snapshotTracks.length;
        setOffset(Math.max(safeOffset, snapshotTracks.length));
      }

      const hm = snapshotTracks.length > 0
        ? true
        : (typeof persisted.hasMore === 'boolean' ? persisted.hasMore : false);
      setHasMore(hm);
    } catch {
    } finally {
      hydrationDoneRef.current = true;
      setHydrationDone(true);
    }
  }, [userId]);

  const trimPlayedTrackIds = useCallback(() => {
    const ids = Array.from(playedTrackIds.current);
    const MAX_IDS = 1000;
    if (ids.length > MAX_IDS) {
      const limited = ids.slice(-MAX_IDS);
      playedTrackIds.current = new Set(limited);
    }
  }, []);

  const startAbortableRequest = useCallback((key) => {
    const name = typeof key === 'string' ? key : '';
    const controllers = activeRequestControllersRef.current;
    if (!controllers || !name) {
      return new AbortController();
    }

    const previous = controllers.get(name);
    if (previous) {
      try {
        previous.abort();
      } catch (e) {
        void e;
      }
      try {
        controllers.delete(name);
      } catch (e) {
        void e;
      }
    }

    const controller = new AbortController();
    controllers.set(name, controller);
    return controller;
  }, []);

  const recoverAuthDegraded = useCallback(async () => {
    if (!onAuthDegraded) return false;
    try {
      const ok = await Promise.resolve(onAuthDegraded());
      if (ok) {
        refreshBackoffUntilRef.current = 0;
        setError(null);
      }
      return !!ok;
    } catch {
      return false;
    }
  }, [onAuthDegraded]);

  const initializeSession = useCallback(async (preferences = {}, options = {}) => {
    if (!userId) {
      return [];
    }

    if (refreshBackoffUntilRef.current && Date.now() < refreshBackoffUntilRef.current) {
      return tracksRef.current.length > 0 ? tracksRef.current : [];
    }

    if (isInitializing.current) {
      return new Promise((resolve) => {
        initWaitersRef.current.push(resolve);
      });
    }

    isInitializing.current = true;
    loadingRef.current = true;

    setLoading(true);
    setError(null);

    const { forceNew, initLimit } = normalizeInitOptions(options);
    let sessionTracks = [];
    const controller = startAbortableRequest('init');

    try {
      const numericUserId = normalizeUserId(userId);

      const makeRequest = () => apiClient.request('/api/recommendations/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: numericUserId,
          preferences,
          forceNew,
          limit: initLimit,
          excludeIds: Array.from(playedTrackIds.current).slice(-500),
        }),
        signal: controller.signal
      });

      let response;
      try {
        response = await makeRequest();
      } catch (requestErr) {
        if (isAuthDegradedStatus(getErrorStatus(requestErr)) && await recoverAuthDegraded()) {
          response = await makeRequest();
        } else {
          throw requestErr;
        }
      }

      const tracksFromResponse = Array.isArray(response.tracks) ? response.tracks : [];
      const nextRecommendationMeta = normalizeRecommendationMeta(response?.recommendationMeta);
      sessionTracks = tracksFromResponse;

      const responseSessionId = typeof response?.sessionId === 'string' && isSafeSessionId(response.sessionId)
        ? response.sessionId.trim()
        : null;

      setSessionId(responseSessionId);
      setRecommendationMeta(nextRecommendationMeta);
      setTracks(tracksFromResponse);
      currentBatch.current = tracksFromResponse;
      setOffset(tracksFromResponse.length);
      setHasMore(normalizeHasMore(response.hasMore, tracksFromResponse.length));

      tracksFromResponse.forEach(track => {
        const tid = track && track.id != null ? Number.parseInt(String(track.id), 10) : Number.NaN;
        if (Number.isFinite(tid) && tid > 0) {
          playedTrackIds.current.add(tid);
        }
      });
      trimPlayedTrackIds();

      return tracksFromResponse;
    } catch (err) {
      if (err.name === 'AbortError') {
        return [];
      }

      const status = getErrorStatus(err);
      if (isAuthDegradedStatus(status)) {
        refreshBackoffUntilRef.current = Date.now() + 15000;
        setError('auth_degraded');
        if (tracksRef.current.length > 0) {
          setHasMore(hasMoreRef.current || true);
          return tracksRef.current;
        }
        return [];
      }
      if (status === 429) {
        const retryAfterSeconds = Number(err?.details?.retryAfter);
        const waitMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? retryAfterSeconds * 1000
          : 60 * 60 * 1000;
        refreshBackoffUntilRef.current = Date.now() + waitMs;
        setHasMore(hasMoreRef.current || tracksRef.current.length > 0);
        setError('Too Many Requests');
        return tracksRef.current.length > 0 ? tracksRef.current : [];
      }

      setError(err.message);
      return [];
    } finally {
      setLoading(false);
      loadingRef.current = false;
      isInitializing.current = false;
      try { activeRequestControllersRef.current?.delete('init'); } catch { }

      if (initWaitersRef.current.length > 0) {
        const waiters = initWaitersRef.current;
        initWaitersRef.current = [];
        waiters.forEach((resolve) => {
          try {
            resolve(sessionTracks);
          } catch (e) {
            void e;
          }
        });
      }
    }
  }, [userId, trimPlayedTrackIds, startAbortableRequest, recoverAuthDegraded]);

  useEffect(() => {
    if (!hydrationDone) return;
    if (!userId) return;
    if (sessionId) return;
    if (hydrationHadSessionRef.current) return;
    if (!autoInitialize) return;
    initializeSession({}, { limit: 40 });
  }, [userId, sessionId, initializeSession, hydrationDone, autoInitialize]);

  const scheduleRealtimeRefreshAfterNegativeFeedback = useCallback(() => {
    const now = Date.now();
    const burst = skipBurstRef.current || { count: 0, firstAt: 0, lastRefreshAt: 0 };

    if (!burst.firstAt || now - burst.firstAt > RECO_SKIP_BURST_WINDOW_MS) {
      burst.firstAt = now;
      burst.count = 1;
    } else {
      burst.count = (Number.isFinite(Number(burst.count)) ? Number(burst.count) : 0) + 1;
    }

    skipBurstRef.current = burst;

    if (burst.count < RECO_SKIP_BURST_THRESHOLD) {
      return;
    }

    if (burst.lastRefreshAt && now - burst.lastRefreshAt < RECO_SKIP_REFRESH_MIN_INTERVAL_MS) {
      return;
    }

    burst.count = 0;
    burst.firstAt = 0;
    burst.lastRefreshAt = now;
    skipBurstRef.current = burst;

    const run = () => {
      realtimeRefreshTimerRef.current = 0;
      const refresh = refreshRecommendationsRef.current;
      if (typeof refresh === 'function') {
        void refresh(false, { preserveExisting: true, reason: 'negative_feedback_burst' });
      }
    };

    try {
      if (typeof window === 'undefined') {
        run();
        return;
      }
      if (realtimeRefreshTimerRef.current) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
      }
      realtimeRefreshTimerRef.current = window.setTimeout(run, RECO_SKIP_REFRESH_DELAY_MS);
    } catch {
      run();
    }
  }, []);

  const recordFeedback = useCallback(async (trackId, action, duration = 0, progress = 0, envelope = null) => {
    if (!userId) {
      return;
    }

    const numericTrackId = parseInt(String(trackId), 10);
    if (!Number.isFinite(numericTrackId) || numericTrackId <= 0) {
      return;
    }

    const numericUserId = parseInt(String(userId), 10);
    if (!Number.isFinite(numericUserId) || numericUserId <= 0) {
      return;
    }

    const validActions = ['play', 'pause', 'skip', 'complete', 'like', 'dislike', 'seek'];
    if (!validActions.includes(action)) {
      return;
    }

    const schemaVersionRaw = envelope && typeof envelope === 'object' ? Number(envelope.schemaVersion) : Number.NaN;
    const schemaVersion = Number.isFinite(schemaVersionRaw) && schemaVersionRaw > 0 ? Math.floor(schemaVersionRaw) : 1;
    const eventId = envelope && typeof envelope === 'object' && typeof envelope.eventId === 'string' && envelope.eventId.trim().length > 0
      ? envelope.eventId.trim()
      : createEventId();
    const eventTimeRaw = envelope && typeof envelope === 'object' ? Number(envelope.eventTime) : Number.NaN;
    const eventTime = Number.isFinite(eventTimeRaw) && eventTimeRaw > 0 ? Math.floor(eventTimeRaw) : Date.now();
    const playbackSessionId = envelope && typeof envelope === 'object' && typeof envelope.playbackSessionId === 'string' && envelope.playbackSessionId.trim().length > 0
      ? envelope.playbackSessionId.trim()
      : null;
    const context = envelope && typeof envelope === 'object' && envelope.context && typeof envelope.context === 'object' && !Array.isArray(envelope.context)
      ? envelope.context
      : null;

    const shouldRefreshAfterFeedback = action === 'skip' || action === 'dislike';

    try {
      const makeRequest = () => apiClient.request('/api/recommendations/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: numericUserId,
          sessionId: sessionId || null,
          trackId: numericTrackId,
          action,
          duration: Math.max(0, Number(duration) || 0),
          progress: Math.min(1, Math.max(0, Number(progress) || 0)),
          eventId,
          playbackSessionId,
          schemaVersion,
          eventTime,
          context,
        })
      });
      try {
        await makeRequest();
      } catch (requestErr) {
        if (isAuthDegradedStatus(getErrorStatus(requestErr)) && await recoverAuthDegraded()) {
          await makeRequest();
        } else {
          throw requestErr;
        }
      }
    } catch (err) {
      void err;
    } finally {
      if (shouldRefreshAfterFeedback) {
        scheduleRealtimeRefreshAfterNegativeFeedback();
      }
    }
  }, [userId, sessionId, scheduleRealtimeRefreshAfterNegativeFeedback, recoverAuthDegraded]);

  const getNextBatch = useCallback(async (batchSize = 10) => {
    if (!userId || loadingRef.current) return [];
    if (!sessionId) {
      return initializeSession({}, { limit: batchSize });
    }

    loadingRef.current = true;
    setLoading(true);
    setError(null);

    const controller = startAbortableRequest('next');

    try {
      const numericUserId = parseInt(String(userId), 10);
      if (!Number.isFinite(numericUserId) || numericUserId <= 0) {
        throw new Error(`Invalid userId: ${userId}`);
      }

      const excludeIds = Array.from(playedTrackIds.current).slice(-500);
      const makeRequest = () => apiClient.request('/api/recommendations/next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: numericUserId,
          sessionId,
          count: batchSize,
          excludeIds,
        }),
        signal: controller.signal
      });

      let response;
      try {
        response = await makeRequest();
      } catch (requestErr) {
        if (isAuthDegradedStatus(getErrorStatus(requestErr)) && await recoverAuthDegraded()) {
          response = await makeRequest();
        } else {
          throw requestErr;
        }
      }

      if (response && typeof response.sessionId === 'string' && isSafeSessionId(response.sessionId)) {
        startTransition(() => {
          setSessionId(response.sessionId.trim());
        });
      }

      const newTracks = Array.isArray(response.tracks) ? response.tracks : [];
      const nextRecommendationMeta = normalizeRecommendationMeta(response?.recommendationMeta);

      if (newTracks.length > 0) {
        startTransition(() => {
          setTracks(prev => [...prev, ...newTracks]);
        });
        currentBatch.current = newTracks;

        newTracks.forEach(track => {
          const tid = track && track.id != null ? Number.parseInt(String(track.id), 10) : Number.NaN;
          if (Number.isFinite(tid) && tid > 0) {
            playedTrackIds.current.add(tid);
          }
        });
        trimPlayedTrackIds();

        startTransition(() => {
          setOffset(prev => prev + newTracks.length);
        });
      }

      if (typeof response.hasMore === 'boolean') {
        startTransition(() => {
          setHasMore(normalizeHasMore(response.hasMore, newTracks.length));
        });
      } else {
        startTransition(() => {
          setHasMore(normalizeHasMore(null, newTracks.length));
        });
      }

      startTransition(() => {
        setRecommendationMeta(nextRecommendationMeta);
      });

      return newTracks;
    } catch (err) {
      if (err.name === 'AbortError') {
        return [];
      }
      const status = getErrorStatus(err);
      if (isAuthDegradedStatus(status)) {
        setError('auth_degraded');
      } else {
        setError(err.message);
      }
      return [];
    } finally {
      setLoading(false);
      loadingRef.current = false;
      try { activeRequestControllersRef.current?.delete('next'); } catch { }
    }
  }, [userId, sessionId, initializeSession, trimPlayedTrackIds, startAbortableRequest, recoverAuthDegraded]);

  const getInfiniteFeed = useCallback(async (limit = 10, options = {}) => {
    if (!userId || loadingRef.current) return [];
    if (!sessionId) {
      return initializeSession({}, { limit });
    }
    if (!hasMore) return [];

    const background = options?.background === true;
    loadingRef.current = true;

    if (!background) {
      setLoading(true);
      setError(null);
    }

    const controller = startAbortableRequest('infinite');

    try {
      const numericUserId = parseInt(String(userId), 10);
      if (!Number.isFinite(numericUserId) || numericUserId <= 0) {
        throw new Error(`Invalid userId: ${userId}`);
      }

      const excludeIds = Array.from(playedTrackIds.current).slice(-500);
      const makeRequest = () => apiClient.request('/api/recommendations/infinite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: numericUserId,
          sessionId,
          offset,
          limit,
          excludeIds,
        }),
        signal: controller.signal
      });

      let response;
      try {
        response = await makeRequest();
      } catch (requestErr) {
        if (isAuthDegradedStatus(getErrorStatus(requestErr)) && await recoverAuthDegraded()) {
          response = await makeRequest();
        } else {
          throw requestErr;
        }
      }

      if (response && typeof response.sessionId === 'string' && isSafeSessionId(response.sessionId)) {
        startTransition(() => {
          setSessionId(response.sessionId.trim());
        });
      }

      const newTracks = Array.isArray(response.tracks) ? response.tracks : [];
      const nextRecommendationMeta = normalizeRecommendationMeta(response?.recommendationMeta);

      if (newTracks.length > 0) {
        startTransition(() => {
          setTracks(prev => [...prev, ...newTracks]);
        });

        newTracks.forEach(track => {
          const tid = track && track.id != null ? Number.parseInt(String(track.id), 10) : Number.NaN;
          if (Number.isFinite(tid) && tid > 0) {
            playedTrackIds.current.add(tid);
          }
        });
        trimPlayedTrackIds();
      }

      const responseNextOffsetRaw = response?.nextOffset ?? response?.offset;
      const responseNextOffset = Number(responseNextOffsetRaw);
      const nextOffset = Number.isFinite(responseNextOffset) && responseNextOffset >= 0
        ? Math.floor(responseNextOffset)
        : offset + newTracks.length;

      startTransition(() => {
        setOffset(nextOffset);
      });

      if (typeof response.hasMore === 'boolean') {
        startTransition(() => {
          setHasMore(normalizeHasMore(response.hasMore, newTracks.length));
        });
      } else {
        startTransition(() => {
          setHasMore(normalizeHasMore(null, newTracks.length));
        });
      }

      startTransition(() => {
        setRecommendationMeta(nextRecommendationMeta);
      });

      return newTracks;
    } catch (err) {
      if (err.name === 'AbortError') {
        return [];
      }
      if (!background) {
        const status = getErrorStatus(err);
        setError(isAuthDegradedStatus(status) ? 'auth_degraded' : err.message);
      }
      return [];
    } finally {
      if (!background) {
        setLoading(false);
      }
      loadingRef.current = false;
      try { activeRequestControllersRef.current?.delete('infinite'); } catch { }
    }
  }, [userId, sessionId, hasMore, offset, initializeSession, trimPlayedTrackIds, startAbortableRequest, recoverAuthDegraded]);

  const processBatchComplete = useCallback(async (interactions) => {
    if (!sessionId || !userId || !currentBatch.current.length) return;

    try {
      const numericUserId = parseInt(String(userId), 10);
      if (!Number.isFinite(numericUserId) || numericUserId <= 0) {
        return;
      }

      await apiClient.request('/api/recommendations/batch-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: numericUserId,
          sessionId,
          batchId: `batch_${Date.now()}`,
          interactions
        })
      });
    } catch (err) {
      void err;
    }
  }, [userId, sessionId]);

  const refreshRecommendations = useCallback(async (resetExcludes = false, options = {}) => {
    if (!userId) return;
    if (!hydrationDoneRef.current) {
      return [];
    }
    if (isInitializing.current) {
      return [];
    }

    const now = Date.now();
    const cooldownMs = RECO_REFRESH_COOLDOWN_MS;
    const bypassCooldown = options?.bypassCooldown === true;
    if (refreshInFlightRef.current) {
      return [];
    }
    if (now < refreshBackoffUntilRef.current) {
      return [];
    }
    if (!bypassCooldown && now - lastRefreshAtRef.current < cooldownMs) {
      return [];
    }

    refreshInFlightRef.current = true;
    loadingRef.current = true;
    lastRefreshAtRef.current = now;

    setLoading(true);

    const oldSessionId = resetExcludes ? null : sessionId;

    if (resetExcludes) {
      playedTrackIds.current.clear();
    }

    const prevTracks = tracks;
    const prevOffset = offset;
    const prevHasMore = hasMore;
    const prevBatch = currentBatch.current;
    const prevRecommendationMeta = recommendationMeta;

    const controller = startAbortableRequest('refresh');

    try {
      const numericUserId = parseInt(String(userId), 10);

      const makeRequest = () => apiClient.request('/api/recommendations/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: numericUserId,
          sessionId: oldSessionId,
          excludeIds: Array.from(playedTrackIds.current).slice(-500),
        }),
        signal: controller.signal
      });

      let response;
      try {
        response = await makeRequest();
      } catch (requestErr) {
        if (isAuthDegradedStatus(getErrorStatus(requestErr)) && await recoverAuthDegraded()) {
          response = await makeRequest();
        } else {
          throw requestErr;
        }
      }

      const tracksFromResponse = Array.isArray(response.tracks) ? response.tracks : [];
      const nextRecommendationMeta = normalizeRecommendationMeta(response?.recommendationMeta);
      const shouldPreserveExisting = options?.preserveExisting === true && !resetExcludes;
      const nextTracks = shouldPreserveExisting
        ? mergeUniqueTracks(prevTracks, tracksFromResponse)
        : tracksFromResponse;

      const responseSessionId = typeof response?.sessionId === 'string' && isSafeSessionId(response.sessionId)
        ? response.sessionId.trim()
        : null;

      setSessionId(responseSessionId || oldSessionId || null);
      setRecommendationMeta(nextRecommendationMeta);
      setTracks(nextTracks);
      currentBatch.current = tracksFromResponse;
      setOffset(nextTracks.length);
      setHasMore(normalizeHasMore(response.hasMore, nextTracks.length));

      tracksFromResponse.forEach(track => {
        const tid = track && track.id != null ? Number.parseInt(String(track.id), 10) : Number.NaN;
        if (Number.isFinite(tid) && tid > 0) {
          playedTrackIds.current.add(tid);
        }
      });

      return tracksFromResponse;
    } catch (err) {
      if (err.name === 'AbortError') {
        return [];
      }

      void err;

      const message = err && err.message ? String(err.message) : '';

      const status = getErrorStatus(err);
      if (isAuthDegradedStatus(status)) {
        setError('auth_degraded');
        refreshBackoffUntilRef.current = Date.now() + 15000;
        setHasMore(prevHasMore);
        setTracks(prevTracks);
        setOffset(prevOffset);
        setRecommendationMeta(prevRecommendationMeta);
        currentBatch.current = prevBatch;
        return [];
      }

      if (status === 429 || message.includes('Too many sessions created') || message.includes('Too Many Requests') || message.includes('Rate limit')) {
        setError('Too Many Requests');
        const retryAfterSeconds = Number(err?.details?.retryAfter);
        const retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? retryAfterSeconds * 1000
          : 5 * 60 * 1000;
        refreshBackoffUntilRef.current = Date.now() + Math.min(Math.max(retryAfterMs, 60 * 1000), 60 * 60 * 1000);
        setHasMore(prevHasMore);
        setTracks(prevTracks);
        setOffset(prevOffset);
        setRecommendationMeta(prevRecommendationMeta);
        currentBatch.current = prevBatch;
        return [];
      }

      setError(message || 'Request failed');
      refreshBackoffUntilRef.current = Date.now() + 30000;
      setHasMore(prevHasMore);
      setTracks(prevTracks);
      setOffset(prevOffset);
      setRecommendationMeta(prevRecommendationMeta);
      currentBatch.current = prevBatch;
      return [];
    } finally {
      setLoading(false);
      loadingRef.current = false;
      refreshInFlightRef.current = false;
      try { activeRequestControllersRef.current?.delete('refresh'); } catch { }
    }
  }, [userId, sessionId, startAbortableRequest, tracks, offset, hasMore, recommendationMeta, recoverAuthDegraded]);

  useEffect(() => {
    refreshRecommendationsRef.current = refreshRecommendations;
  }, [refreshRecommendations]);

  useEffect(() => {
    if (!userId) return;
    if (!hydrationDone) return;
    if (!autoInitialize) return;
    if (!sessionId) return;
    if (!hydrationHadSessionRef.current) return;
    if (typeof window === 'undefined') return;

    const timer = window.setTimeout(() => {
      void refreshRecommendations(false, { preserveExisting: true, reason: 'hydrated_revalidate' });
    }, 800);

    return () => {
      try {
        window.clearTimeout(timer);
      } catch {
      }
    };
  }, [userId, hydrationDone, autoInitialize, sessionId, refreshRecommendations]);

  const markTrackPlayed = useCallback((trackId) => {
    const tid = Number.parseInt(String(trackId), 10);
    if (Number.isFinite(tid) && tid > 0) {
      playedTrackIds.current.add(tid);
      trimPlayedTrackIds();
    }
  }, [trimPlayedTrackIds]);

  useEffect(() => {
    if (!userId) return;
    if (!hydrationDone) return;
    if (!sessionId) return;
    const key = recoStorageKey(userId);
    if (!key) return;

    if (persistTimerRef.current) {
      try { window.clearTimeout(persistTimerRef.current); } catch { }
      persistTimerRef.current = 0;
    }

    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = 0;
      try {
        if (typeof localStorage === 'undefined') return;
        const playedIds = Array.from(playedTrackIds.current).slice(-1000);
        const snapshot = normalizePersistedTracks(tracks, 120);
        const payload = {
          sessionId,
          offset,
          hasMore,
          recommendationMeta,
          playedIds,
          tracks: snapshot,
          updatedAt: Date.now(),
        };
        localStorage.setItem(key, JSON.stringify(payload));
      } catch {
      }
    }, 700);
  }, [userId, sessionId, tracks, offset, hasMore, recommendationMeta, hydrationDone]);

  useEffect(() => {
    const controllers = activeRequestControllersRef.current;
    return () => {
      if (realtimeRefreshTimerRef.current) {
        try { window.clearTimeout(realtimeRefreshTimerRef.current); } catch { }
        realtimeRefreshTimerRef.current = 0;
      }
      if (controllers && typeof controllers.values === 'function') {
        for (const ctrl of controllers.values()) {
          try {
            ctrl.abort();
          } catch (e) {
            void e;
          }
        }
        try {
          controllers.clear();
        } catch (e) {
          void e;
        }
      }
    };
  }, []);

  // Освежение рекомендаций при возврате во вкладку после долгого отсутствия.
  // refreshRecommendations уже защищён собственным cooldown/backoff/in-flight,
  // поэтому здесь достаточно вызвать его — дубликатов запросов не будет.
  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    if (!userId) return;
    if (!hydrationDone) return;
    if (!autoInitialize) return;

    let hiddenAt = 0;

    const onVisibility = () => {
      try {
        if (document.visibilityState === 'hidden') {
          hiddenAt = Date.now();
          return;
        }
        if (document.visibilityState !== 'visible') return;
      } catch {
        return;
      }

      const now = Date.now();
      const awayMs = hiddenAt > 0 ? now - hiddenAt : 0;
      hiddenAt = 0;
      if (awayMs < RECO_STALENESS_AFTER_MS) return;
      if (!sessionId) return;
      if (refreshInFlightRef.current) return;

      void refreshRecommendations(false);
    };

    document.addEventListener('visibilitychange', onVisibility, { passive: true });
    return () => {
      try {
        document.removeEventListener('visibilitychange', onVisibility);
      } catch {
        /* ignore */
      }
    };
  }, [userId, hydrationDone, sessionId, refreshRecommendations, autoInitialize]);

  return {
    tracks,
    loading,
    error,
    hasMore,
    sessionId,
    recommendationMeta,
    hydrationDone,
    initializeSession,
    recordFeedback,
    getNextBatch,
    getInfiniteFeed,
    processBatchComplete,
    refreshRecommendations,
    markTrackPlayed,
    playedTracksCount: playedTrackIds.current.size
  };
};
