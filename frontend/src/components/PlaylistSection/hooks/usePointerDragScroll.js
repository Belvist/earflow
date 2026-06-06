import { useCallback, useEffect, useRef } from 'react';
import { GESTURE_SURFACE } from '../../../gestures/gestureContracts';
import { useGestureArbiter } from '../../../gestures/GestureArbiterProvider';
import { shouldDeferToMiniPlayerGesture } from '../../../gestures/miniPlayerGestureZone';

export default function usePointerDragScroll({ thresholdPx = 6, speed = 1.35 } = {}) {
    const arbiter = useGestureArbiter();
    const isDraggingRef = useRef(false);
    const hasMovedRef = useRef(false);
    const hasCapturedRef = useRef(false);
    const startXRef = useRef(0);
    const startYRef = useRef(0);
    const startScrollLeftRef = useRef(0);
    const pointerIdRef = useRef(null);

    const onPointerDown = useCallback((e, scrollEl) => {
        if (!scrollEl) return;

        // Bypass JS-driven drag scrolling for real touch events to let the browser
        // handle native horizontal scrolling natively with full physics and momentum.
        if (e.pointerType === 'touch') {
            isDraggingRef.current = false;
            hasMovedRef.current = false;
            pointerIdRef.current = null;
            return;
        }

        if (String(e.pointerType || 'mouse') === 'mouse' && e.button !== 0) return;

        isDraggingRef.current = true;
        hasMovedRef.current = false;
        hasCapturedRef.current = false;
        pointerIdRef.current = e.pointerId;

        startXRef.current = e.clientX;
        startYRef.current = e.clientY;
        startScrollLeftRef.current = scrollEl.scrollLeft;

        return;
    }, []);

    const onPointerMove = useCallback((e, scrollEl) => {
        if (!isDraggingRef.current || !scrollEl) return;
        if (pointerIdRef.current !== null && e.pointerId !== pointerIdRef.current) return;

        const delta = e.clientX - startXRef.current;
        const dy = e.clientY - startYRef.current;
        const absX = Math.abs(delta);
        const absY = Math.abs(dy);
        const threshold = Math.max(1, Number(thresholdPx) || 0);
        if (!hasMovedRef.current && Math.max(absX, absY) < threshold) {
            return;
        }

        if (!hasMovedRef.current && absX <= absY * 1.2) {
            isDraggingRef.current = false;
            pointerIdRef.current = null;
            return;
        }

        hasMovedRef.current = true;

        if (!hasCapturedRef.current) {
            if (shouldDeferToMiniPlayerGesture({
                surfaceId: GESTURE_SURFACE.PLAYLIST_SCROLL,
                clientX: e.clientX,
                clientY: e.clientY,
                target: e.target,
                pointerId: e.pointerId,
            })) {
                isDraggingRef.current = false;
                pointerIdRef.current = null;
                return;
            }
            if (!arbiter.tryClaim({
                surfaceId: GESTURE_SURFACE.PLAYLIST_SCROLL,
                pointerId: e.pointerId,
                reason: 'playlist-drag-scroll',
            })) {
                isDraggingRef.current = false;
                return;
            }
            try {
                if (e.currentTarget && e.currentTarget.setPointerCapture) {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    hasCapturedRef.current = true;
                }
            } catch {
                hasCapturedRef.current = false;
            }
        }

        if (e.cancelable) {
            e.preventDefault();
        }
        scrollEl.scrollLeft = startScrollLeftRef.current - delta * (Number(speed) || 1);
    }, [arbiter, speed, thresholdPx]);

    const endDrag = useCallback((e) => {
        if (!isDraggingRef.current) return;
        isDraggingRef.current = false;

        const pid = pointerIdRef.current;
        pointerIdRef.current = null;

    const shouldRelease = hasCapturedRef.current;
    hasCapturedRef.current = false;

    window.setTimeout(() => {
      hasMovedRef.current = false;
    }, 0);

    try {
            if (shouldRelease && pid !== null && e && e.currentTarget && e.currentTarget.releasePointerCapture) {
                e.currentTarget.releasePointerCapture(pid);
            }
        } catch {
            // ignore
        }
        arbiter.release({
            surfaceId: GESTURE_SURFACE.PLAYLIST_SCROLL,
            pointerId: pid,
            reason: 'playlist-drag-scroll-end',
        });
    }, [arbiter]);

    const onPointerUp = useCallback((e) => endDrag(e), [endDrag]);
    const onPointerCancel = useCallback((e) => endDrag(e), [endDrag]);

    const consumeClickIfMoved = useCallback((e) => {
        if (!hasMovedRef.current) return false;
        e?.preventDefault?.();
        e?.stopPropagation?.();
        return true;
    }, []);

    useEffect(() => {
        return () => {
            if (!isDraggingRef.current) return;
            isDraggingRef.current = false;
            const pid = pointerIdRef.current;
            pointerIdRef.current = null;
            hasCapturedRef.current = false;
            arbiter.release({
                surfaceId: GESTURE_SURFACE.PLAYLIST_SCROLL,
                pointerId: pid,
                reason: 'unmount',
            });
        };
    }, [arbiter]);

    return {
        hasMovedRef,
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onPointerCancel,
        consumeClickIfMoved,
    };
}
