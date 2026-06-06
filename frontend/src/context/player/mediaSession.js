import { useEffect, useRef } from 'react';
import { isIosSafari } from '../../utils/platform';
import { buildArtworkEntries, preloadArtwork, resolveAlbumLabel } from './mediaSessionArtwork';

let lastExternalMediaSessionSeekAtMs = 0;

const mediaSessionState = {
    bound: false,
    playbackEngine: 'legacy',
    queueName: '',
    queueLength: 0,
    currentTrack: null,
    lastKnownTrack: null,
    isPlaying: false,
    duration: 0,
    currentTime: 0,
    playbackRate: 1,
    isSeekingRef: null,
    processedSinkAudioRef: null,
    audioRef: null,
    setIsPlaying: null,
    userWantsPlaybackRef: null,
    playNextTrack: null,
    playPreviousTrack: null,
    seekToSeconds: null,
    pausePlayback: null,
    resumePlayback: null,
    lastPositionUpdateAtMs: 0,
    lastPosition: { duration: 0, position: -1, rate: 1 },
    lastMetadataKey: '',
    lastMetadataBaseKey: '',
    metadataSeq: 0,
    lastTrackSkipAtMs: 0,
};

export function markExternalMediaSessionSeekAtNow() {
    lastExternalMediaSessionSeekAtMs = Date.now();
}

export function shouldSkipMediaSessionPositionUpdate(isSeekingRef) {
    if (isSeekingRef?.current) return true;
    if (lastExternalMediaSessionSeekAtMs > 0 && Date.now() - lastExternalMediaSessionSeekAtMs < 300) return true;
    return false;
}

function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function parseDurationSeconds(value) {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') {
        return Number.isFinite(value) && value > 0 ? value : 0;
    }
    const raw = String(value).trim();
    if (!raw) return 0;
    if (/^\d+(?::\d{1,2}){1,2}$/.test(raw)) {
        const parts = raw.split(':').map((p) => Number.parseInt(p, 10));
        if (parts.some((p) => !Number.isFinite(p) || p < 0)) return 0;
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function getTrackDurationSeconds(track) {
    if (!track || typeof track !== 'object') return 0;
    const seconds =
        parseDurationSeconds(track.durationSeconds) ||
        parseDurationSeconds(track.duration_seconds) ||
        parseDurationSeconds(track.duration_sec) ||
        parseDurationSeconds(track.duration);
    if (seconds > 0) return seconds;

    const ms = safeNumber(track.durationMs ?? track.duration_ms, 0);
    return ms > 0 ? ms / 1000 : 0;
}

function getPositionSnapshot(params) {
    const durationFromState = safeNumber(params?.duration, 0);
    const timeFromState = safeNumber(params?.currentTime, Number.NaN);
    const rateFromState = safeNumber(params?.playbackRate, Number.NaN);
    const durationFromTrack = getTrackDurationSeconds(params?.currentTrack);

    const audio = params?.audioRef?.current;
    const audioDuration = safeNumber(audio?.duration, 0);
    const audioTime = safeNumber(audio?.currentTime, Number.NaN);
    const audioRate = safeNumber(audio?.playbackRate, Number.NaN);

    if (Number.isFinite(timeFromState) && timeFromState >= 0) {
        const dBase = durationFromState > 0 ? durationFromState : (audioDuration > 0 ? audioDuration : durationFromTrack);
        if (dBase <= 0) return null;
        const rBase = Number.isFinite(rateFromState) && rateFromState > 0 ? rateFromState : (Number.isFinite(audioRate) && audioRate > 0 ? audioRate : 1);
        return { duration: dBase, position: Math.min(timeFromState, dBase), playbackRate: rBase };
    }

    const dBase = audioDuration > 0 ? audioDuration : durationFromTrack;
    if (dBase <= 0) return null;
    if (!Number.isFinite(audioTime) || audioTime < 0) return null;
    const r = Number.isFinite(audioRate) && audioRate > 0 ? audioRate : 1;
    return { duration: dBase, position: Math.min(audioTime, dBase), playbackRate: r };
}

export function updateMediaSessionPositionStateNow({ audioRef, duration, currentTime, playbackRate, currentTrack, isSeekingRef, force }) {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    if (typeof navigator.mediaSession?.setPositionState !== 'function') return;
    if (!force && shouldSkipMediaSessionPositionUpdate(isSeekingRef)) return;

    const now = Date.now();
    const prevAt = mediaSessionState.lastPositionUpdateAtMs;
    if (!force && prevAt && now - prevAt < 900) return;

    try {
        const snap = getPositionSnapshot({ audioRef, duration, currentTime, playbackRate, currentTrack });
        if (!snap) return;
        const last = mediaSessionState.lastPosition;
        const changed =
            Math.abs(safeNumber(last.position, -1) - snap.position) > 0.25 ||
            Math.abs(safeNumber(last.duration, 0) - snap.duration) > 0.5 ||
            Math.abs(safeNumber(last.rate, 1) - snap.playbackRate) > 0.01;
        if (!force && !changed) return;

        navigator.mediaSession.setPositionState(snap);
        mediaSessionState.lastPositionUpdateAtMs = now;
        mediaSessionState.lastPosition = { duration: snap.duration, position: snap.position, rate: snap.playbackRate };
    } catch {
    }
}

function forcePositionStateSyncFromState() {
    updateMediaSessionPositionStateNow({
        audioRef: mediaSessionState.audioRef,
        duration: mediaSessionState.duration,
        currentTime: mediaSessionState.currentTime,
        playbackRate: mediaSessionState.playbackRate,
        currentTrack: mediaSessionState.currentTrack,
        isSeekingRef: mediaSessionState.isSeekingRef,
        force: true,
    });
}

export function applyMediaSessionMetadataEager(track, queueName) {
    if (!track) return;
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    if (typeof window === 'undefined' || !('MediaMetadata' in window)) return;

    mediaSessionState.lastKnownTrack = track;

    const album = resolveAlbumLabel(track, queueName);
    const baseKey = `${String(track.id ?? '')}|${String(track.updated_at ?? '')}|${album}`;
    mediaSessionState.lastMetadataBaseKey = baseKey;
    mediaSessionState.lastMetadataKey = baseKey;
    mediaSessionState.metadataSeq = safeNumber(mediaSessionState.metadataSeq, 0) + 1;
    const seq = mediaSessionState.metadataSeq;

    try {
        navigator.mediaSession.metadata = new window.MediaMetadata({
            title: track.title || 'Unknown Title',
            artist: track.artist || 'Unknown Artist',
            album,
            artwork: [],
        });
    } catch {
    }

    void applyMediaSessionMetadataArtworkInner({ currentTrack: track, queueName, seq });
}

function applyMediaSessionMetadataFastInner({ currentTrack, queueName }) {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const track = currentTrack || mediaSessionState.lastKnownTrack;
    if (!track) return;

    const mediaSession = navigator.mediaSession;

    try {
        if (typeof window === 'undefined' || !('MediaMetadata' in window)) return;

        const album = resolveAlbumLabel(track, queueName);
        const baseKey = `${String(track?.id ?? '')}|${String(track?.updated_at ?? '')}|${album}`;
        if (mediaSessionState.lastMetadataBaseKey === baseKey) {
            try {
                if (navigator.mediaSession.metadata) return;
                mediaSessionState.lastMetadataBaseKey = '';
                mediaSessionState.lastMetadataKey = '';
            } catch {
                return;
            }
        }

        mediaSessionState.lastMetadataBaseKey = baseKey;
        mediaSessionState.lastMetadataKey = baseKey;
        if (currentTrack) {
            mediaSessionState.metadataSeq = safeNumber(mediaSessionState.metadataSeq, 0) + 1;
        }

        mediaSession.metadata = new window.MediaMetadata({
            title: track.title || 'Unknown Title',
            artist: track.artist || 'Unknown Artist',
            album,
            artwork: [],
        });
    } catch {
    }
}

async function applyMediaSessionMetadataArtworkInner({ currentTrack, queueName, seq }) {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const track = currentTrack || mediaSessionState.lastKnownTrack;
    if (!track) return;
    if (safeNumber(seq, 0) !== safeNumber(mediaSessionState.metadataSeq, 0)) return;

    const mediaSession = navigator.mediaSession;
    const album = resolveAlbumLabel(track, queueName);

    let coverUrl = '';
    try {
        const apiClient = (await import('../../api/client')).default;
        coverUrl = apiClient.getCoverUrl(track) || '';
    } catch {
        coverUrl = '';
    }
    if (!coverUrl) return;

    if (safeNumber(seq, 0) !== safeNumber(mediaSessionState.metadataSeq, 0)) return;

    const loaded = await preloadArtwork(coverUrl).catch(() => false);
    if (!loaded) return;
    if (safeNumber(seq, 0) !== safeNumber(mediaSessionState.metadataSeq, 0)) return;

    try {
        if (typeof window === 'undefined' || !('MediaMetadata' in window)) return;

        const key = `${String(track?.id ?? '')}|${String(track?.updated_at ?? '')}|${album}|${String(coverUrl ?? '')}`;
        if (mediaSessionState.lastMetadataKey === key) return;

        const artwork = buildArtworkEntries(coverUrl);

        mediaSession.metadata = new window.MediaMetadata({
            title: track.title || 'Unknown Title',
            artist: track.artist || 'Unknown Artist',
            album,
            artwork,
        });

        mediaSessionState.lastMetadataKey = key;
    } catch {
    }
}

function bindMediaSessionHandlers() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

    const mediaSession = navigator.mediaSession;

    const queueLength = safeNumber(mediaSessionState.queueLength, 0);
    const canSkipTracks = queueLength > 1 && (typeof mediaSessionState.playNextTrack === 'function' || typeof mediaSessionState.playPreviousTrack === 'function');
    const ios = isIosSafari();

    const getCurrentPositionSeconds = () => {
        const fromState = safeNumber(mediaSessionState.currentTime, Number.NaN);
        if (Number.isFinite(fromState) && fromState >= 0) return fromState;
        const snap = getPositionSnapshot(mediaSessionState);
        if (!snap) return 0;
        return safeNumber(snap.position, 0);
    };

    const getDurationSeconds = () => {
        const fromState = safeNumber(mediaSessionState.duration, 0);
        if (fromState > 0) return fromState;
        const snap = getPositionSnapshot(mediaSessionState);
        if (!snap) return 0;
        return safeNumber(snap.duration, 0);
    };

    const clampSeekTarget = (target) => {
        const t = safeNumber(target, Number.NaN);
        if (!Number.isFinite(t)) return null;
        const d = getDurationSeconds();
        if (d > 0) return Math.max(0, Math.min(d, t));
        return Math.max(0, t);
    };

    const doSeekTo = (seconds) => {
        const fn = mediaSessionState.seekToSeconds;
        const target = clampSeekTarget(seconds);
        if (target == null) return;
        markExternalMediaSessionSeekAtNow();
        mediaSessionState.currentTime = target;
        if (typeof fn === 'function') {
            try {
                fn(target);
            } catch {
            }
        } else {
            const audio = mediaSessionState.audioRef?.current;
            if (audio) {
                try { audio.currentTime = target; } catch { }
            }
        }
        forcePositionStateSyncFromState();
    };

    const handlePlay = () => {
        if (mediaSessionState.userWantsPlaybackRef) mediaSessionState.userWantsPlaybackRef.current = true;
        const resumePlayback = mediaSessionState.resumePlayback;
        if (typeof resumePlayback === 'function') {
            resumePlayback();
        }
    };

    const handlePause = () => {
        if (mediaSessionState.userWantsPlaybackRef) mediaSessionState.userWantsPlaybackRef.current = false;
        const pausePlayback = mediaSessionState.pausePlayback;
        if (typeof pausePlayback === 'function') {
            pausePlayback();
        }
    };

    const handleNext = () => {
        const now = Date.now();
        const last = safeNumber(mediaSessionState.lastTrackSkipAtMs, 0);
        if (last > 0 && now - last < 350) return;
        mediaSessionState.lastTrackSkipAtMs = now;
        if (mediaSessionState.userWantsPlaybackRef) mediaSessionState.userWantsPlaybackRef.current = true;
        const fn = mediaSessionState.playNextTrack;
        if (typeof fn === 'function') fn();
    };

    const handlePrev = () => {
        const now = Date.now();
        const last = safeNumber(mediaSessionState.lastTrackSkipAtMs, 0);
        if (last > 0 && now - last < 350) return;
        mediaSessionState.lastTrackSkipAtMs = now;

        const audioEl = mediaSessionState.audioRef?.current;
        const audioPos = safeNumber(audioEl?.currentTime, Number.NaN);
        const statePos = safeNumber(mediaSessionState.currentTime, Number.NaN);
        const pos = Number.isFinite(audioPos) && audioPos >= 0
            ? audioPos
            : (Number.isFinite(statePos) && statePos >= 0 ? statePos : 0);

        if (pos > 3) {
            doSeekTo(0);
            return;
        }

        if (mediaSessionState.userWantsPlaybackRef) mediaSessionState.userWantsPlaybackRef.current = true;
        const fn = mediaSessionState.playPreviousTrack;
        if (typeof fn === 'function') fn();
    };

    const handleStop = () => {
        if (mediaSessionState.userWantsPlaybackRef) mediaSessionState.userWantsPlaybackRef.current = false;
        const pausePlayback = mediaSessionState.pausePlayback;
        if (typeof pausePlayback === 'function') {
            pausePlayback();
        }
    };

    const handleSeekTo = (details) => {
        let t = Number.NaN;
        if (details && typeof details.seekTime === 'number') t = details.seekTime;
        const fastSeek = !!(details && details.fastSeek === true);
        const target = clampSeekTarget(t);
        if (target == null) return;
        markExternalMediaSessionSeekAtNow();
        mediaSessionState.currentTime = target;
        if (fastSeek) {
            const audio = mediaSessionState.audioRef?.current;
            if (audio && typeof audio.fastSeek === 'function') {
                try {
                    audio.fastSeek(target);
                    forcePositionStateSyncFromState();
                    return;
                } catch {
                }
            }
        }
        const fn = mediaSessionState.seekToSeconds;
        if (typeof fn === 'function') {
            try {
                fn(target);
            } catch {
            }
        } else {
            const audio = mediaSessionState.audioRef?.current;
            if (audio) {
                try { audio.currentTime = target; } catch { }
            }
        }
        forcePositionStateSyncFromState();
    };

    const handleSeekForward = (details) => {
        let off = 15;
        if (details && typeof details.seekOffset === 'number') off = details.seekOffset;
        const base = getCurrentPositionSeconds();
        doSeekTo(base + safeNumber(off, 15));
    };

    const handleSeekBackward = (details) => {
        let off = 15;
        if (details && typeof details.seekOffset === 'number') off = details.seekOffset;
        const base = getCurrentPositionSeconds();
        doSeekTo(base - safeNumber(off, 15));
    };

    let previousTrackHandler = handlePrev;
    let nextTrackHandler = handleNext;
    if (ios && !canSkipTracks) {
        previousTrackHandler = null;
        nextTrackHandler = null;
    }

    let seekBackwardHandler = handleSeekBackward;
    let seekForwardHandler = handleSeekForward;
    if (ios) {
        seekBackwardHandler = null;
        seekForwardHandler = null;
    }

    const handlers = [
        ['play', handlePlay],
        ['pause', handlePause],
        ['previoustrack', previousTrackHandler],
        ['nexttrack', nextTrackHandler],
        ['seekto', handleSeekTo],
        ['seekbackward', seekBackwardHandler],
        ['seekforward', seekForwardHandler],
        ['stop', handleStop],
    ];

    handlers.forEach(([action, handler]) => {
        try {
            mediaSession.setActionHandler(action, handler || null);
        } catch {
        }
    });

    mediaSessionState.bound = true;
}

const POSITION_STATE_EVENTS = Object.freeze([
    'loadedmetadata',
    'durationchange',
    'play',
    'pause',
    'seeked',
    'ratechange',
    'ended',
]);

function bindMediaSessionPositionStateInner({ audioRef, duration, isSeekingRef }) {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return () => { };
    if (typeof navigator.mediaSession?.setPositionState !== 'function') return () => { };

    const updatePositionState = (evt) => {
        updateMediaSessionPositionStateNow({
            audioRef,
            duration,
            currentTime: mediaSessionState.currentTime,
            playbackRate: mediaSessionState.playbackRate,
            currentTrack: mediaSessionState.currentTrack,
            isSeekingRef,
            force: !!evt,
        });
    };

    const interval = setInterval(updatePositionState, 1000);
    const audio = audioRef.current;
    if (audio) {
        for (const evt of POSITION_STATE_EVENTS) {
            try { audio.addEventListener(evt, updatePositionState); } catch { }
        }
    }

    return () => {
        clearInterval(interval);
        if (audio) {
            for (const evt of POSITION_STATE_EVENTS) {
                try { audio.removeEventListener(evt, updatePositionState); } catch { }
            }
        }
    };
}

function setMediaSessionPlaybackStateInner(isPlaying) {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
        navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    } catch {
    }
}

function setMediaSessionPlaybackStateExplicitInner(state) {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const v = state === 'none' || state === 'paused' || state === 'playing' ? state : null;
    if (!v) return;
    try {
        navigator.mediaSession.playbackState = v;
    } catch {
    }
}

function clearMediaSessionMetadataInner() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
        navigator.mediaSession.metadata = null;
    } catch {
    }
    mediaSessionState.lastMetadataKey = '';
    mediaSessionState.lastMetadataBaseKey = '';
    mediaSessionState.metadataSeq = safeNumber(mediaSessionState.metadataSeq, 0) + 1;
}

export function useMediaSession({ currentTrack, queueName, queueLength, playbackEngine, processedSinkAudioRef, audioRef, setIsPlaying, userWantsPlaybackRef, playNextTrack, playPreviousTrack, seekToSeconds, pausePlayback, resumePlayback, isPlaying, duration, currentTime, playbackRate, isSeekingRef, disablePlaybackStateSync }) {
    const clearTimerRef = useRef(0);
    const pauseDebounceTimerRef = useRef(0);

    useEffect(() => {
        mediaSessionState.playbackEngine = playbackEngine;
        mediaSessionState.queueName = queueName || '';
        mediaSessionState.queueLength = safeNumber(queueLength, 0);
        mediaSessionState.currentTrack = currentTrack || null;
        if (currentTrack) mediaSessionState.lastKnownTrack = currentTrack;
        mediaSessionState.processedSinkAudioRef = processedSinkAudioRef;
        mediaSessionState.audioRef = audioRef;
        mediaSessionState.setIsPlaying = setIsPlaying;
        mediaSessionState.userWantsPlaybackRef = userWantsPlaybackRef;
        mediaSessionState.playNextTrack = playNextTrack;
        mediaSessionState.playPreviousTrack = playPreviousTrack;
        mediaSessionState.seekToSeconds = seekToSeconds;
        mediaSessionState.pausePlayback = pausePlayback;
        mediaSessionState.resumePlayback = resumePlayback;
        mediaSessionState.isSeekingRef = isSeekingRef;

        bindMediaSessionHandlers();

        applyMediaSessionMetadataFastInner({ currentTrack, queueName });
        const seq = safeNumber(mediaSessionState.metadataSeq, 0);
        void applyMediaSessionMetadataArtworkInner({ currentTrack, queueName, seq });

        return () => { };
    }, [currentTrack, queueName, queueLength, playbackEngine, processedSinkAudioRef, audioRef, setIsPlaying, userWantsPlaybackRef, playNextTrack, playPreviousTrack, seekToSeconds, pausePlayback, resumePlayback, isSeekingRef]);

    useEffect(() => {
        mediaSessionState.duration = safeNumber(duration, 0) || getTrackDurationSeconds(mediaSessionState.currentTrack);
        mediaSessionState.currentTime = safeNumber(currentTime, 0);
        mediaSessionState.playbackRate = safeNumber(playbackRate, 1);
    }, [currentTime, duration, playbackRate, currentTrack]);

    useEffect(() => {
        return bindMediaSessionPositionStateInner({
            audioRef,
            duration,
            isSeekingRef,
        });
    }, [currentTrack?.id, audioRef, duration, isSeekingRef]);

    useEffect(() => {
        if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
            return undefined;
        }

        mediaSessionState.isPlaying = !!isPlaying;

        if (disablePlaybackStateSync) {
            if (clearTimerRef.current) {
                try { clearTimeout(clearTimerRef.current); } catch { }
                clearTimerRef.current = 0;
            }
            if (pauseDebounceTimerRef.current) {
                try { clearTimeout(pauseDebounceTimerRef.current); } catch { }
                pauseDebounceTimerRef.current = 0;
            }
            return undefined;
        }

        const cancelClearTimer = () => {
            if (clearTimerRef.current) {
                try { clearTimeout(clearTimerRef.current); } catch { }
                clearTimerRef.current = 0;
            }
        };

        const cancelPauseDebounce = () => {
            if (pauseDebounceTimerRef.current) {
                try { clearTimeout(pauseDebounceTimerRef.current); } catch { }
                pauseDebounceTimerRef.current = 0;
            }
        };

        const isBackground = (() => {
            try {
                return typeof document !== 'undefined' && document.visibilityState !== 'visible';
            } catch {
                return false;
            }
        })();

        const iosBackground = isBackground && isIosSafari();

        if (isPlaying) {
            cancelClearTimer();
            cancelPauseDebounce();
            setMediaSessionPlaybackStateExplicitInner('playing');
            return cancelPauseDebounce;
        }

        if (!currentTrack) {
            cancelPauseDebounce();
            cancelClearTimer();

            const stillWantedNow = !!userWantsPlaybackRef?.current;

            if (!iosBackground && !stillWantedNow) {
                setMediaSessionPlaybackStateExplicitInner('none');
            }

            const delayMs = iosBackground ? 6000 : 2000;
            clearTimerRef.current = setTimeout(() => {
                clearTimerRef.current = 0;
                const stillNoTrack = !mediaSessionState.currentTrack;
                const stillPlaying = !!mediaSessionState.isPlaying;
                if (!stillNoTrack || stillPlaying) return;
                const stillWanted = !!mediaSessionState.userWantsPlaybackRef?.current;
                const nowBackground = (() => {
                    try {
                        return typeof document !== 'undefined' && document.visibilityState !== 'visible';
                    } catch {
                        return false;
                    }
                })();
                const nowIosBackground = nowBackground && isIosSafari();
                if (nowIosBackground && (stillWanted || stillPlaying)) return;
                if (!stillWanted && !stillPlaying) {
                    setMediaSessionPlaybackStateExplicitInner('none');
                }
            }, delayMs);
            return cancelPauseDebounce;
        }

        cancelClearTimer();

        if (iosBackground) {
            const isSeeking = !!isSeekingRef?.current;
            if (isSeeking) {
                cancelPauseDebounce();
                setMediaSessionPlaybackStateExplicitInner('playing');
                return cancelPauseDebounce;
            }

            cancelPauseDebounce();
            pauseDebounceTimerRef.current = setTimeout(() => {
                pauseDebounceTimerRef.current = 0;
                const nowPlaying = !!mediaSessionState.isPlaying;
                if (nowPlaying) return;
                const nowSeeking = !!mediaSessionState.isSeekingRef?.current;
                if (nowSeeking) return;
                const wantsPlay = !!mediaSessionState.userWantsPlaybackRef?.current;
                if (wantsPlay) return;
                setMediaSessionPlaybackStateExplicitInner('paused');
            }, 800);
            return cancelPauseDebounce;
        }

        cancelPauseDebounce();
        setMediaSessionPlaybackStateExplicitInner('paused');
        return cancelPauseDebounce;
    }, [currentTrack, isPlaying, disablePlaybackStateSync]);
}
