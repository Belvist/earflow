import { useState, useEffect, useRef, useCallback } from 'react';
import { usePointerSeek } from './usePointerSeek';

/**
 * Shared seek + time display engine for player bars.
 *
 * Owns: time polling, seek state machine, progress bar CSS, usePointerSeek integration.
 * Guarantees: no stale closures (all hot values via refs), single setState per tick,
 * progress bar CSS written imperatively (no React re-render needed for animation).
 *
 * @param {{
 *   currentTimeRef: { current: number },
 *   durationRaw: number,
 *   isSeeking: boolean,
 *   disabled?: boolean,
 *   progressBarId?: string,
 *   onBeginSeek?: () => void,
 *   onCommitSeek?: (percent: number) => void,
 *   onPreviewSeek?: (percent: number) => void,
 *   pollIntervalMs?: number,
 * }} params
 */
export function useSeekableProgress({
    currentTimeRef,
    durationRaw,
    isSeeking: externalIsSeeking,
    disabled = false,
    progressBarId,
    onBeginSeek,
    onCommitSeek,
    onPreviewSeek,
    pollIntervalMs = 500,  // Increased from 250ms to reduce re-renders
}) {
    const [localIsSeeking, setLocalIsSeeking] = useState(false);
    const [displaySeconds, setDisplaySeconds] = useState(0);
    const [displayPercent, setDisplayPercent] = useState(0);

    const seekingRef = useRef(false);
    const hasCommittedRef = useRef(false);
    const safetyTimerRef = useRef(null);
    const progressBarRef = useRef(null);
    const durationRef = useRef(0);
    const seekPreviewTimeRef = useRef(0);

    const onBeginSeekRef = useRef(onBeginSeek);
    onBeginSeekRef.current = onBeginSeek;
    const onCommitSeekRef = useRef(onCommitSeek);
    onCommitSeekRef.current = onCommitSeek;
    const onPreviewSeekRef = useRef(onPreviewSeek);
    onPreviewSeekRef.current = onPreviewSeek;

    durationRef.current = Number(durationRaw) || 0;

    const writeProgressCss = useCallback((pct) => {
        const bar = progressBarRef.current;
        let v = Math.max(0, Math.min(100, Number(pct) || 0));
        if (!seekingRef.current && v > 0 && v < 1) {
            v = 0;
        }
        setDisplayPercent(v);
        if (!bar) return;
        try {
            bar.style.setProperty('--progress', `${v}%`);
        } catch { /* noop */ }
    }, []);

    useEffect(() => {
        const ref = currentTimeRef;
        if (!ref) return;

        const initT = Number(ref.current ?? 0);
        if (!seekingRef.current && initT > 0) {
            setDisplaySeconds(Math.floor(initT));
        }

        let lastFlooredSec = Math.floor(initT);
        let rafId = null;

        // RAF loop: updates CSS progress bar at 60fps, React state at ~10fps
        let frameCount = 0;
        const tick = () => {
            if (seekingRef.current) {
                rafId = requestAnimationFrame(tick);
                return;
            }
            const t = Number(ref.current ?? 0);
            const d = durationRef.current;

            // Always update CSS progress bar (no React state - fast)
            if (Number.isFinite(d) && d > 0) {
                const pct = Math.min(100, Math.max(0, (t / d) * 100));
                writeProgressCss(pct);
            }

            // Throttled React state update (~10fps) - only when seconds change
            frameCount++;
            if (frameCount % 6 === 0) {
                const floored = Math.floor(t);
                if (floored !== lastFlooredSec) {
                    lastFlooredSec = floored;
                    setDisplaySeconds(floored);
                }
            }

            rafId = requestAnimationFrame(tick);
        };

        rafId = requestAnimationFrame(tick);

        return () => {
            if (rafId) cancelAnimationFrame(rafId);
        };
    }, [currentTimeRef, writeProgressCss]);

    useEffect(() => {
        if (!hasCommittedRef.current) return;
        if (externalIsSeeking) return;
        if (safetyTimerRef.current) {
            window.clearTimeout(safetyTimerRef.current);
            safetyTimerRef.current = null;
        }
        hasCommittedRef.current = false;
        seekingRef.current = false;
        setLocalIsSeeking(false);
    }, [externalIsSeeking]);

    const seekHandlers = usePointerSeek({
        disabled,
        onBegin: () => {
            seekingRef.current = true;
            setLocalIsSeeking(true);

            const t = Number(currentTimeRef?.current ?? 0);
            const d = durationRef.current;
            const initialPct =
                Number.isFinite(d) && d > 0 && Number.isFinite(t) && t >= 0
                    ? Math.min(100, Math.max(0, (t / d) * 100))
                    : 0;

            seekPreviewTimeRef.current = t;
            setDisplaySeconds(Math.floor(t));
            writeProgressCss(initialPct);

            if (typeof onBeginSeekRef.current === 'function') {
                onBeginSeekRef.current();
            }
        },
        onPreview: (percent) => {
            writeProgressCss(percent);
            const d = durationRef.current;
            if (Number.isFinite(d) && d > 0) {
                const t = (Math.max(0, Math.min(100, percent)) / 100) * d;
                seekPreviewTimeRef.current = t;
                setDisplaySeconds(Math.floor(t));
            }
            if (typeof onPreviewSeekRef.current === 'function') {
                onPreviewSeekRef.current(percent);
            }
        },
        onCommit: (percent) => {
            writeProgressCss(percent);
            const d = durationRef.current;
            if (Number.isFinite(d) && d > 0) {
                const t = (Math.max(0, Math.min(100, percent)) / 100) * d;
                seekPreviewTimeRef.current = t;
                setDisplaySeconds(Math.floor(t));
            }

            hasCommittedRef.current = true;
            if (safetyTimerRef.current) window.clearTimeout(safetyTimerRef.current);
            safetyTimerRef.current = window.setTimeout(() => {
                safetyTimerRef.current = null;
                if (hasCommittedRef.current) {
                    hasCommittedRef.current = false;
                    seekingRef.current = false;
                    setLocalIsSeeking(false);
                }
            }, 1500);

            if (typeof onCommitSeekRef.current === 'function') {
                onCommitSeekRef.current(percent);
            }
        },
    });

    const formatTime = useCallback((sec) => {
        const s = Number(sec);
        if (!Number.isFinite(s) || s < 0) return '0:00';
        const m = Math.floor(s / 60);
        const r = Math.floor(s % 60);
        return `${m}:${String(r).padStart(2, '0')}`;
    }, []);

    const displayTimeFormatted = formatTime(displaySeconds);

    return {
        isSeeking: localIsSeeking,
        displaySeconds,
        displayPercent,
        displayTime: displayTimeFormatted,
        progressBarRef,
        seekHandlers,
        seekingRef,
        formatTime,
    };
}
