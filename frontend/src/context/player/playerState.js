import { useState, useRef, useEffect, useCallback, useMemo, useReducer } from 'react';
import { QUEUE_SOURCES, REPEAT_MODES, PLAYBACK_ENGINES, PLAYER_STATUSES } from './constants';

const clampIndex = (idx, len) => {
    const n = Number(idx);
    const l = Number(len);
    const safeLen = Number.isFinite(l) && l > 0 ? Math.floor(l) : 0;
    if (safeLen <= 0) return 0;
    const base = Number.isFinite(n) ? Math.floor(n) : 0;
    return Math.max(0, Math.min(safeLen - 1, base));
};

const playerMachineReducer = (state, action) => {
    const type = action && typeof action.type === 'string' ? action.type : '';

    switch (type) {
        case 'QUEUE_SNAPSHOT_SYNC': {
            const tracks = Array.isArray(action?.tracks) ? action.tracks : [];
            const ids = tracks.map((t) => (t && t.id != null ? String(t.id) : null)).filter(Boolean);
            const currentIndex = clampIndex(state.currentTrackIndex || 0, state.queueTracks?.length || 0);
            const currentTrack = Array.isArray(state.queueTracks) ? state.queueTracks[currentIndex] : null;
            const currentId = currentTrack && currentTrack.id != null ? String(currentTrack.id) : '';
            const preservedIndex = currentId ? ids.findIndex((id) => id === currentId) : -1;
            const nextIndex = preservedIndex >= 0 ? preservedIndex : clampIndex(state.currentTrackIndex || 0, ids.length);
            return {
                ...state,
                queueTracks: tracks,
                queueTrackIds: ids,
                currentTrackIndex: nextIndex,
            };
        }
        case 'QUEUE_TRACK_IDS_SYNC': {
            const ids = Array.isArray(action?.ids)
                ? action.ids.map((v) => (v === null || v === undefined ? '' : String(v))).filter(Boolean)
                : [];
            const nextIndex = clampIndex(state.currentTrackIndex || 0, ids.length);
            return {
                ...state,
                queueTrackIds: ids,
                currentTrackIndex: nextIndex,
            };
        }
        case 'TRACK_INDEX_SET': {
            const nextIndex = clampIndex(action?.index, state.queueTrackIds?.length || 0);
            const nextStatus = state.playbackIntent === true ? PLAYER_STATUSES.LOADING : state.status;
            return {
                ...state,
                currentTrackIndex: nextIndex,
                status: nextStatus,
            };
        }
        case 'INTENT_PLAY': {
            const base = state.status;
            const nextStatus =
                base === PLAYER_STATUSES.PLAYING || base === PLAYER_STATUSES.BUFFERING || base === PLAYER_STATUSES.STALLED
                    ? base
                    : PLAYER_STATUSES.LOADING;
            return {
                ...state,
                status: nextStatus,
                playbackIntent: true,
            };
        }
        case 'INTENT_PAUSE': {
            return {
                ...state,
                status: PLAYER_STATUSES.IDLE,
                playbackIntent: false,
                lastErrorCode: null,
            };
        }
        case 'PHASE_LOADING': {
            if (!state.playbackIntent) {
                return {
                    ...state,
                    status: PLAYER_STATUSES.IDLE,
                };
            }
            return {
                ...state,
                status: PLAYER_STATUSES.LOADING,
            };
        }
        case 'PHASE_PLAYING': {
            if (!state.playbackIntent) {
                return {
                    ...state,
                    status: PLAYER_STATUSES.IDLE,
                };
            }
            return {
                ...state,
                status: PLAYER_STATUSES.PLAYING,
                lastErrorCode: null,
            };
        }
        case 'PHASE_BUFFERING': {
            if (!state.playbackIntent) return state;
            return {
                ...state,
                status: PLAYER_STATUSES.BUFFERING,
            };
        }
        case 'PHASE_STALLED': {
            if (!state.playbackIntent) return state;
            return {
                ...state,
                status: PLAYER_STATUSES.STALLED,
            };
        }
        case 'PHASE_ERROR': {
            const code = action && (action.code || action.errorCode);
            return {
                ...state,
                status: PLAYER_STATUSES.ERROR,
                lastErrorCode: typeof code === 'string' ? code : null,
            };
        }
        default:
            return state;
    }
};

/**
 * @param {object} user
 * @returns {object}
 */
export const usePlayerState = (user) => {
    const [userId, setUserId] = useState(() => {
        const rawId = user?.id || user?.userId;
        return rawId ? String(rawId) : null;
    });

    useEffect(() => {
        const rawId = user?.id || user?.userId;
        const next = rawId ? String(rawId) : null;
        setUserId((prev) => (prev === next ? prev : next));
    }, [user?.id, user?.userId]);

    const [playerMachine, playerDispatch] = useReducer(playerMachineReducer, null, () => ({
        status: PLAYER_STATUSES.IDLE,
        playbackIntent: false,
        resumeStatus: null,
        lastErrorCode: null,
        currentTrackIndex: (() => {
            try {
                const saved = localStorage.getItem('lastTrackIndex');
                const n = saved ? Number.parseInt(saved, 10) : 0;
                return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
            } catch {
                return 0;
            }
        })(),
        queueTracks: [],
        queueTrackIds: [],
    }));

    const currentTrackIndex = useMemo(() => {
        const n = Number(playerMachine?.currentTrackIndex || 0);
        return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    }, [playerMachine?.currentTrackIndex]);

    const isPlaying = useMemo(() => {
        return playerMachine?.playbackIntent === true;
    }, [playerMachine?.playbackIntent]);

    const isActuallyPlaying = useMemo(() => {
        return (playerMachine?.status || PLAYER_STATUSES.IDLE) === PLAYER_STATUSES.PLAYING;
    }, [playerMachine?.status]);

    const isBuffering = useMemo(() => {
        const s = playerMachine?.status;
        return s === PLAYER_STATUSES.BUFFERING || s === PLAYER_STATUSES.STALLED;
    }, [playerMachine?.status]);

    const setIsPlaying = useCallback((next) => {
        if (next === true) {
            playerDispatch({ type: 'INTENT_PLAY' });
            return;
        }
        if (next === false) {
            playerDispatch({ type: 'INTENT_PAUSE' });
        }
    }, []);

    const setCurrentTrackIndex = useCallback((next) => {
        playerDispatch({ type: 'TRACK_INDEX_SET', index: next });
    }, []);

    const syncQueueTrackIds = useCallback((ids) => {
        playerDispatch({ type: 'QUEUE_TRACK_IDS_SYNC', ids });
    }, []);

    const syncQueueSnapshot = useCallback((tracks) => {
        playerDispatch({ type: 'QUEUE_SNAPSHOT_SYNC', tracks });
    }, []);

    const setIsBuffering = useCallback((next) => {
        if (next === true) {
            playerDispatch({ type: 'PHASE_BUFFERING' });
            return;
        }
        if (next === false) {
            playerDispatch({ type: 'PHASE_PLAYING' });
        }
    }, []);

    const markPlaybackStarted = useCallback(() => {
        playerDispatch({ type: 'PHASE_PLAYING' });
    }, []);

    const markPlaybackStalled = useCallback(() => {
        playerDispatch({ type: 'PHASE_STALLED' });
    }, []);

    const markPlaybackError = useCallback((code) => {
        const c = typeof code === 'string' ? code : '';
        playerDispatch({ type: 'PHASE_ERROR', code: c || null });
    }, []);
    const [duration, setDuration] = useState(0);

    const [isSeeking, setIsSeeking] = useState(false);

    const [volume, setVolume] = useState(() => {
        try {
            const saved = localStorage.getItem('playerVolume');
            return saved ? Number.parseFloat(saved) : 1;
        } catch { return 1; }
    });

    const [playbackRate, setPlaybackRate] = useState(1);
    const [preservePitch, setPreservePitch] = useState(() => {
        try {
            const raw = localStorage.getItem('playback_preserve_pitch');
            if (raw === 'true') return true;
            if (raw === 'false') return false;
            return true;
        } catch {
            return true;
        }
    });
    const [eqEnabled, setEqEnabled] = useState(() => {
        try {
            const raw = localStorage.getItem('eq_enabled');
            if (raw === 'true') return true;
            if (raw === 'false') return false;
            return false;
        } catch {
            return false;
        }
    });
    const [eqGains, setEqGains] = useState(() => {
        try {
            const raw = localStorage.getItem('eq_gains');
            const parsed = raw ? JSON.parse(raw) : null;
            if (Array.isArray(parsed) && parsed.length === 10) {
                const next = parsed.map((v) => {
                    const n = Number(v);
                    if (!Number.isFinite(n)) return 0;
                    return Math.max(-12, Math.min(12, n));
                });
                next[5] = 0;
                next[6] = 0;
                next[8] = 0;
                return next;
            }
            return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        } catch {
            return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        }
    });

    const [likedIds, setLikedIds] = useState(new Set());
    const [dislikedIds, setDislikedIds] = useState(new Set());

    const [likedTracks, setLikedTracks] = useState([]);

    const [queueSource, setQueueSource] = useState(() => {
        return QUEUE_SOURCES.AUTO;
    });

    const [queueName, setQueueName] = useState('');
    const [customQueue, setCustomQueue] = useState([]);
    const [customQueueMeta, setCustomQueueMeta] = useState(null);
    const [repeatMode, setRepeatMode] = useState(() => {
        try {
            const saved = localStorage.getItem('playerRepeatMode');
            const allowed = new Set(Object.values(REPEAT_MODES));
            return saved && allowed.has(saved) ? saved : REPEAT_MODES.ALL;
        } catch {
            return REPEAT_MODES.ALL;
        }
    });
    const [shuffleEnabled, setShuffleEnabled] = useState(() => {
        try {
            const saved = localStorage.getItem('playerShuffleEnabled');
            if (saved === 'true') return true;
            if (saved === 'false') return false;
            return false;
        } catch {
            return false;
        }
    });
    const [shuffleOrder, setShuffleOrder] = useState([]);

    const [userSettings, setUserSettings] = useState(() => {
        const defaults = {
            autoplay_enabled: true,
            crossfade_seconds: 0,
            normalize_volume: false,
            audio_quality: 'auto'
        };

        try {
            const saved = localStorage.getItem('playerSettings');
            const parsed = saved ? JSON.parse(saved) : null;
            if (!parsed || typeof parsed !== 'object') {
                return defaults;
            }
            return {
                ...defaults,
                ...parsed,
            };
        } catch {
            return defaults;
        }
    });

    const [resolvedAudioUrl, setResolvedAudioUrl] = useState(null);
    const [resolvedAudioUrlExpiresAtMs, setResolvedAudioUrlExpiresAtMs] = useState(null);
    const [playbackEngine, setPlaybackEngine] = useState(PLAYBACK_ENGINES.LEGACY);
    const [playbackRatePrefs, setPlaybackRatePrefs] = useState(() => {
        try {
            const saved = localStorage.getItem('playbackRatePrefs');
            return saved ? JSON.parse(saved) : {};
        } catch { return {}; }
    });

    const audioRef = useRef(null);
    const audioCtxRef = useRef(null);

    const isPlayingRef = useRef(isPlaying);
    const isBufferingRef = useRef(isBuffering);
    const isSeekingRef = useRef(isSeeking);
    const currentTimeRef = useRef(0);
    const seekCooldownUntilRef = useRef(0);
    const switchingUntilRef = useRef(0);
    const volumeRef = useRef(volume);
    const durationRef = useRef(duration);
    const userWantsPlaybackRef = useRef(false);
    const userGestureEverRef = useRef(false);
    const trackDurationRef = useRef(0);
    const playPauseInProgressRef = useRef(false);
    const playbackRateSaveTimerRef = useRef(null);

    const activeOperationIdRef = useRef(0);
    const activeOperationControllerRef = useRef(null);

    const trackLoudnessRef = useRef(null);

    const consecutiveErrorsRef = useRef(0);
    const lastErrorTimeRef = useRef(0);
    const errorSkipTimeoutRef = useRef(null);
    const lastErrorTrackIdRef = useRef(null);
    const retryCountRef = useRef(0);
    const isSkippingRef = useRef(false);
    const skipMutexRef = useRef(false);

    const mountedRef = useRef(true);
    useEffect(() => {
        return () => { mountedRef.current = false; };
    }, []);

    const isMounted = useCallback(() => mountedRef.current, []);

    useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
    useEffect(() => { isBufferingRef.current = isBuffering; }, [isBuffering]);
    useEffect(() => { isSeekingRef.current = isSeeking; }, [isSeeking]);
    useEffect(() => {
        volumeRef.current = volume;
    }, [volume]);
    useEffect(() => {
        durationRef.current = duration;
        trackDurationRef.current = duration;
    }, [duration]);


    useEffect(() => {
        try {
            localStorage.setItem('playerSettings', JSON.stringify(userSettings));
        } catch { }
    }, [userSettings]);


    useEffect(() => {
        try {
            localStorage.setItem('playbackRatePrefs', JSON.stringify(playbackRatePrefs));
        } catch { }
    }, [playbackRatePrefs]);

    return {
        userId, setUserId,
        currentTrackIndex, setCurrentTrackIndex,
        queueTracks: Array.isArray(playerMachine?.queueTracks) ? playerMachine.queueTracks : [],
        syncQueueTrackIds,
        syncQueueSnapshot,
        playerStatus: playerMachine?.status || PLAYER_STATUSES.IDLE,
        lastErrorCode: playerMachine?.lastErrorCode || null,
        playbackIntent: playerMachine?.playbackIntent === true,
        isActuallyPlaying,
        isPlaying, setIsPlaying,
        isBuffering, setIsBuffering,
        markPlaybackStarted,
        markPlaybackStalled,
        markPlaybackError,
        isSeeking, setIsSeeking,
        duration, setDuration,
        volume, setVolume,
        playbackRate, setPlaybackRate,
        preservePitch, setPreservePitch,
        playbackRatePrefs, setPlaybackRatePrefs,
        eqEnabled, setEqEnabled,
        eqGains, setEqGains,
        likedIds, setLikedIds,
        dislikedIds, setDislikedIds,
        likedTracks, setLikedTracks,
        queueSource, setQueueSource,
        queueName, setQueueName,
        customQueue, setCustomQueue,
        customQueueMeta, setCustomQueueMeta,
        repeatMode, setRepeatMode,
        shuffleEnabled, setShuffleEnabled,
        shuffleOrder, setShuffleOrder,
        userSettings, setUserSettings,
        resolvedAudioUrl, setResolvedAudioUrl,
        resolvedAudioUrlExpiresAtMs, setResolvedAudioUrlExpiresAtMs,
        playbackEngine, setPlaybackEngine,

        activeOperationIdRef,
        activeOperationControllerRef,
        audioRef,
        audioCtxRef,
        isPlayingRef,
        isBufferingRef,
        isSeekingRef,
        currentTimeRef,
        seekCooldownUntilRef,
        switchingUntilRef,
        volumeRef,
        durationRef,
        userWantsPlaybackRef,
        userGestureEverRef,
        trackDurationRef,
        playPauseInProgressRef,
        playbackRateSaveTimerRef,
        trackLoudnessRef,
        consecutiveErrorsRef,
        lastErrorTimeRef,
        errorSkipTimeoutRef,
        lastErrorTrackIdRef,
        retryCountRef,
        isSkippingRef,
        skipMutexRef,
        isMounted
    };
};
