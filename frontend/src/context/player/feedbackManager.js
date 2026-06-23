import { useCallback, useRef } from 'react';

/**
 * Manages playback feedback for ML recommendations.
 */
export const useFeedbackManager = (state, { recommendations }) => {
    const { currentTrack, audioRef, currentTimeRef, trackDurationRef, duration, queueSource, currentTrackIndex } = state;
    const playFeedbackTrackIdRef = useRef(null);
    const playFeedbackSentRef = useRef(false);
    const skipFeedbackTrackIdRef = useRef(null);
    const playbackSessionTrackIdRef = useRef(null);
    const playbackSessionIdRef = useRef(null);

    const createId = useCallback(() => {
        try {
            const c = typeof window !== 'undefined' ? window.crypto : null;
            if (c && typeof c.randomUUID === 'function') return c.randomUUID();
        } catch {
        }
        return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }, []);

    const ensurePlaybackSession = useCallback((trackId) => {
        if (!trackId) return null;
        if (playbackSessionTrackIdRef.current !== trackId || !playbackSessionIdRef.current) {
            playbackSessionTrackIdRef.current = trackId;
            playbackSessionIdRef.current = createId();
        }
        return playbackSessionIdRef.current;
    }, [createId]);

    const buildContext = useCallback(() => {
        const surface = typeof queueSource === 'string' && queueSource.trim().length > 0 ? queueSource : null;
        const position = Number.isFinite(Number(currentTrackIndex)) ? Number(currentTrackIndex) : null;
        if (!surface && position === null) return null;
        return { surface, position };
    }, [currentTrackIndex, queueSource]);

    const resolveTrackId = useCallback((overrideTrackId = null) => {
        if (overrideTrackId && typeof overrideTrackId === 'object') {
            const id = overrideTrackId.id ?? overrideTrackId.trackId;
            return id ? String(id) : null;
        }
        if (overrideTrackId !== null && overrideTrackId !== undefined) {
            return String(overrideTrackId);
        }
        return currentTrack?.id ? String(currentTrack.id) : null;
    }, [currentTrack]);

    const getPlaybackProgress = useCallback(() => {
        const audio = audioRef.current;
        const audioCurrentSeconds = audio ? Number(audio.currentTime) : Number.NaN;
        const audioDurationSeconds = audio ? Number(audio.duration) : Number.NaN;
        const stateCurrentSeconds = Number(currentTimeRef?.current);
        const stateDurationSeconds = Number(trackDurationRef?.current || duration);

        const safeCurrentSeconds = (() => {
            if (Number.isFinite(audioCurrentSeconds) && audioCurrentSeconds > 0) return audioCurrentSeconds;
            if (Number.isFinite(stateCurrentSeconds) && stateCurrentSeconds > 0) return stateCurrentSeconds;
            return 0;
        })();

        const safeDurationSeconds = (() => {
            if (Number.isFinite(audioDurationSeconds) && audioDurationSeconds > 0) return audioDurationSeconds;
            if (Number.isFinite(stateDurationSeconds) && stateDurationSeconds > 0) return stateDurationSeconds;
            const fromTrack = Number(currentTrack?.durationSeconds || currentTrack?.duration);
            if (Number.isFinite(fromTrack) && fromTrack > 0) return fromTrack;
            return 0;
        })();

        return {
            progress: safeDurationSeconds > 0 ? (safeCurrentSeconds / safeDurationSeconds) : 0,
            durationMs: Math.floor(safeCurrentSeconds * 1000),
        };
    }, [audioRef, currentTrack, currentTimeRef, duration, trackDurationRef]);

    const recordFeedback = useCallback((action, overrideTrackId = null) => {
        if (!recommendations?.recordFeedback) return;

        const trackId = resolveTrackId(overrideTrackId);
        if (!trackId) return;

        const playbackSessionId = ensurePlaybackSession(trackId);
        const eventId = createId();
        const eventTime = Date.now();
        const schemaVersion = 1;
        const context = buildContext();
        const { progress, durationMs } = getPlaybackProgress();

        if (action === 'dislike' && typeof recommendations?.markTrackPlayed === 'function') {
            recommendations.markTrackPlayed(trackId);
        }

        recommendations.recordFeedback(trackId, action, durationMs, progress, {
            eventId,
            playbackSessionId,
            schemaVersion,
            eventTime,
            context,
        });

        if (action === 'complete') {
            playFeedbackSentRef.current = false;
            skipFeedbackTrackIdRef.current = null;
            playbackSessionIdRef.current = createId();
        }
    }, [buildContext, createId, ensurePlaybackSession, getPlaybackProgress, recommendations, resolveTrackId]);

    const recordSkipFeedback = useCallback((overrideTrackId = null) => {
        if (!recommendations?.recordFeedback) return;

        const trackId = resolveTrackId(overrideTrackId);
        if (!trackId) return;
        if (skipFeedbackTrackIdRef.current === trackId) return;

        const { progress } = getPlaybackProgress();
        if (progress >= 0.92) return;

        skipFeedbackTrackIdRef.current = trackId;

        if (typeof recommendations?.markTrackPlayed === 'function') {
            recommendations.markTrackPlayed(trackId);
        }

        recordFeedback('skip', trackId);
    }, [getPlaybackProgress, recommendations, recordFeedback, resolveTrackId]);

    const handlePlayFeedback = useCallback((overrideTrackId = null) => {
        const trackId = resolveTrackId(overrideTrackId);
        if (!trackId) return;

        if (playFeedbackTrackIdRef.current === trackId && playFeedbackSentRef.current) {
            return;
        }

        if (playFeedbackTrackIdRef.current !== trackId) {
            skipFeedbackTrackIdRef.current = null;
        }

        playFeedbackTrackIdRef.current = trackId;
        playFeedbackSentRef.current = true;

        if (typeof recommendations?.markTrackPlayed === 'function') {
            recommendations.markTrackPlayed(trackId);
        }

        recordFeedback('play', trackId);
    }, [recordFeedback, recommendations, resolveTrackId]);

    return {
        recordFeedback,
        recordSkipFeedback,
        handlePlayFeedback,
        playFeedbackSentRef
    };
};
