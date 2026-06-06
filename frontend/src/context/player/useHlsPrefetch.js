import { useEffect, useMemo, useRef } from 'react';
import { PLAYBACK_ENGINES, REPEAT_MODES } from './constants';

const POLL_INTERVAL_MS = 2000;
const COOLDOWN_MS = 5000;
const PREFETCH_THRESHOLD_SEC = 30;
const PREFETCH_THRESHOLD_RATIO = 0.3;

function abortSafe(ctrl) {
    try { ctrl.abort(); } catch { }
}

/**
 * Prefetch warms the next track's signed URL / manifest
 * so that track transition is instant (~100ms vs 1-2s cold).
 * Works for both Direct and HLS protocols.
 */
export const useHlsPrefetch = ({
    apiClient,
    isAuthenticated,
    playbackEngine,
    currentTimeRef,
    duration,
    effectiveTracks,
    currentTrackIndex,
    repeatMode,
    isSeekingRef,
    switchingUntilRef,
}) => {
    const api = apiClient || null;

    const nextTrackId = useMemo(() => {
        if (!Array.isArray(effectiveTracks) || effectiveTracks.length === 0) return null;
        const baseIndex = Number(currentTrackIndex);
        const idx = Number.isFinite(baseIndex) ? Math.max(0, Math.floor(baseIndex)) : 0;
        const isLast = idx >= effectiveTracks.length - 1;
        if (isLast && repeatMode !== REPEAT_MODES.ALL) return null;
        const nextIndex = isLast ? 0 : idx + 1;
        const t = effectiveTracks[nextIndex] || null;
        const id = t?.id ? String(t.id) : '';
        return id || null;
    }, [currentTrackIndex, effectiveTracks, repeatMode]);

    const inFlightRef = useRef(null);
    const warmedTrackIdRef = useRef(null);
    const lastAttemptAtRef = useRef(0);

    useEffect(() => {
        warmedTrackIdRef.current = null;
        if (inFlightRef.current) {
            abortSafe(inFlightRef.current);
            inFlightRef.current = null;
        }
    }, [nextTrackId]);

    useEffect(() => {
        return () => {
            if (inFlightRef.current) {
                abortSafe(inFlightRef.current);
                inFlightRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (!api) return;
        if (!isAuthenticated) return;
        if (!nextTrackId) return;

        const preferDirect = playbackEngine === PLAYBACK_ENGINES.DIRECT;
        const hasDirect = typeof api.getSongDirectSession === 'function';
        const hasHls = typeof api.getSongHlsSession === 'function';

        const primaryFetch = preferDirect && hasDirect ? 'direct' : hasHls ? 'hls' : hasDirect ? 'direct' : null;
        if (!primaryFetch) return;

        const id = setInterval(() => {
            if (String(warmedTrackIdRef.current || '') === String(nextTrackId || '')) return;
            if (inFlightRef.current) return;
            if (isSeekingRef?.current) return;
            if (switchingUntilRef && Date.now() < (switchingUntilRef.current || 0)) return;

            const d = Number(duration);
            const t = Number(currentTimeRef?.current ?? 0);
            if (!Number.isFinite(d) || d <= 0) return;
            if (!Number.isFinite(t) || t < 0) return;
            const remaining = d - t;
            const threshold = Math.min(PREFETCH_THRESHOLD_SEC, d * PREFETCH_THRESHOLD_RATIO);
            if (remaining > threshold) return;

            const now = Date.now();
            if (now - (lastAttemptAtRef.current || 0) < COOLDOWN_MS) return;
            lastAttemptAtRef.current = now;

            const controller = new AbortController();
            inFlightRef.current = controller;

            const fetcher = primaryFetch === 'direct'
                ? api.getSongDirectSession(nextTrackId, { signal: controller.signal })
                : api.getSongHlsSession(nextTrackId, { signal: controller.signal });

            fetcher
                .then((sess) => {
                    if (controller.signal.aborted) return;
                    const hasValidSession = sess && typeof sess === 'object' && (
                        (typeof sess.masterUrl === 'string' && sess.masterUrl) ||
                        (typeof sess.url === 'string' && sess.url) ||
                        (typeof sess.streamUrl === 'string' && sess.streamUrl)
                    );
                    if (hasValidSession) {
                        warmedTrackIdRef.current = nextTrackId;
                    }
                })
                .catch(() => { })
                .finally(() => {
                    if (inFlightRef.current === controller) {
                        inFlightRef.current = null;
                    }
                });
        }, POLL_INTERVAL_MS);

        return () => clearInterval(id);
    }, [api, currentTimeRef, duration, isAuthenticated, isSeekingRef, nextTrackId, playbackEngine, switchingUntilRef]);
};
