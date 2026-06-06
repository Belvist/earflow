import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const ACTIVE_ATTR = 'data-lyrics-active';
const ACTIVE_SELECTOR = `[${ACTIVE_ATTR}]`;

const isReducedMotion = () => {
    try {
        return typeof window !== 'undefined'
            && typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
        return false;
    }
};

export const useAutoScroll = (currentLineIndex, _mode, currentTime) => {
    const containerElRef = useRef(null);
    const [containerNode, setContainerNode] = useState(null);
    const prevIndexRef = useRef(-1);
    const prevTimeRef = useRef(NaN);
    const currentIndexRef = useRef(-1);
    const disabledUntilRef = useRef(0);
    const isProgrammaticRef = useRef(false);
    const resetTimerRef = useRef(0);
    const roRef = useRef(null);
    const recenterTimerRef = useRef(0);
    const disableSeqRef = useRef(0);

    currentIndexRef.current = currentLineIndex;

    const clearResetTimer = () => {
        if (resetTimerRef.current) {
            clearTimeout(resetTimerRef.current);
            resetTimerRef.current = 0;
        }
    };

    const scrollToActive = (behavior) => {
        const container = containerElRef.current;
        if (!container) return;

        const line = container.querySelector(ACTIVE_SELECTOR);
        if (!line) return;

        clearResetTimer();

        const cRect = container.getBoundingClientRect();
        const lRect = line.getBoundingClientRect();
        const delta = (lRect.top + lRect.height / 2) - (cRect.top + cRect.height / 2);
        const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
        const target = Math.min(maxScroll, Math.max(0, container.scrollTop + delta));

        isProgrammaticRef.current = true;

        try {
            container.scrollTo({ top: target, behavior });
        } catch {
            container.scrollTop = target;
        }

        resetTimerRef.current = setTimeout(() => {
            isProgrammaticRef.current = false;
            resetTimerRef.current = 0;
        }, behavior === 'smooth' ? 900 : 120);
    };

    const containerCallbackRef = useCallback((node) => {
        containerElRef.current = node;
        setContainerNode((prev) => (prev === node ? prev : node));
    }, []);

    useLayoutEffect(() => {
        if (currentLineIndex < 0) return;

        const nextTime = Number(currentTime);
        const prevTime = Number(prevTimeRef.current);
        prevTimeRef.current = nextTime;

        const timeJump = Number.isFinite(prevTime)
            && Number.isFinite(nextTime)
            && Math.abs(nextTime - prevTime) >= 1.25;

        const lineChanged = currentLineIndex !== prevIndexRef.current;
        if (!lineChanged && !timeJump) return;

        prevIndexRef.current = currentLineIndex;

        const nowMs = Date.now();
        if (nowMs < disabledUntilRef.current && !timeJump) return;

        const reduced = isReducedMotion();
        const behavior = (reduced || timeJump) ? 'auto' : 'smooth';

        requestAnimationFrame(() => scrollToActive(behavior));
    }, [currentLineIndex, currentTime]);

    useEffect(() => {
        const el = containerNode;
        if (!el) return undefined;

        const applyCenterPadding = () => {
            const h = Math.max(0, Math.trunc(el.clientHeight || 0));
            const pad = Math.max(0, Math.trunc(h / 2));
            el.style.setProperty('--lyrics-center-pad', `${pad}px`);
        };

        applyCenterPadding();

        if (roRef.current) {
            try { roRef.current.disconnect(); } catch { /* noop */ }
            roRef.current = null;
        }

        if (typeof ResizeObserver !== 'undefined') {
            roRef.current = new ResizeObserver(applyCenterPadding);
            try { roRef.current.observe(el); } catch { /* noop */ }
        } else if (typeof window !== 'undefined') {
            window.addEventListener('resize', applyCenterPadding, { passive: true });
        }

        const disableAutoScroll = (ms) => {
            disabledUntilRef.current = Date.now() + ms;
            disableSeqRef.current += 1;
            const seq = disableSeqRef.current;

            if (recenterTimerRef.current) {
                clearTimeout(recenterTimerRef.current);
                recenterTimerRef.current = 0;
            }

            recenterTimerRef.current = setTimeout(() => {
                if (disableSeqRef.current !== seq) return;
                if (Date.now() < disabledUntilRef.current) return;
                if (isProgrammaticRef.current) return;
                if (currentIndexRef.current < 0) return;
                scrollToActive('smooth');
            }, ms + 80);
        };

        const onWheel = () => disableAutoScroll(1200);
        const onScroll = () => {
            if (isProgrammaticRef.current) return;
            disableAutoScroll(3000);
        };

        el.addEventListener('wheel', onWheel, { passive: true });
        el.addEventListener('scroll', onScroll, { passive: true });

        return () => {
            if (roRef.current) {
                try { roRef.current.disconnect(); } catch { /* noop */ }
                roRef.current = null;
            } else if (typeof window !== 'undefined') {
                window.removeEventListener('resize', applyCenterPadding);
            }
            if (recenterTimerRef.current) {
                clearTimeout(recenterTimerRef.current);
                recenterTimerRef.current = 0;
            }
            clearResetTimer();
            el.removeEventListener('wheel', onWheel);
            el.removeEventListener('scroll', onScroll);
        };
    }, [containerNode]);

    return { containerRef: containerCallbackRef, ACTIVE_ATTR };
};
