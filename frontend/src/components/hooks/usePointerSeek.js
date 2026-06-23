import { useCallback, useEffect, useRef } from 'react';
import { GESTURE_SURFACE } from '../../gestures/gestureContracts';
import { useGestureArbiter } from '../../gestures/GestureArbiterProvider';
import { shouldDeferToMiniPlayerGesture } from '../../gestures/miniPlayerGestureZone';

/**
 * @param {{
 *   disabled?: boolean,
 *   onBegin?: (() => void) | null,
 *   onPreview?: ((percent: number) => void) | null,
 *   onCommit?: ((percent: number) => void) | null,
 * }} params
 */
export function usePointerSeek(params = {}) {
    const { disabled = false, onBegin, onPreview, onCommit } = params;
    const arbiter = useGestureArbiter();

    const isDraggingRef = useRef(false);
    const pointerIdRef = useRef(null);
    const captureTargetRef = useRef(null);
    const windowHandlersRef = useRef({ up: null, cancel: null, blur: null });
    const rectRef = useRef(null);
    const lastPercentRef = useRef(0);
    const pendingPercentRef = useRef(null);
    const rafIdRef = useRef(0);
    const windowListenersRef = useRef(false);

    const clampPercent = useCallback((value) => Math.max(0, Math.min(100, value)), []);

    const computePercent = useCallback((clientX) => {
        const rect = rectRef.current;
        if (!rect || !Number.isFinite(rect.width) || rect.width <= 0) return 0;
        const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
        return clampPercent((x / rect.width) * 100);
    }, [clampPercent]);

    const flushPreview = useCallback(() => {
        rafIdRef.current = 0;
        const next = pendingPercentRef.current;
        pendingPercentRef.current = null;
        if (typeof next !== 'number') return;
        lastPercentRef.current = next;
        if (typeof onPreview === 'function') {
            onPreview(next);
        }
    }, [onPreview]);

    const schedulePreview = useCallback((percent) => {
        pendingPercentRef.current = percent;
        if (rafIdRef.current) return;
        rafIdRef.current = window.requestAnimationFrame(flushPreview);
    }, [flushPreview]);

    const detachWindowListeners = useCallback(() => {
        if (!windowListenersRef.current) return;
        windowListenersRef.current = false;

        const { up, cancel, blur } = windowHandlersRef.current || {};
        if (up) window.removeEventListener('pointerup', up, true);
        if (cancel) window.removeEventListener('pointercancel', cancel, true);
        if (blur) window.removeEventListener('blur', blur, true);
        windowHandlersRef.current = { up: null, cancel: null, blur: null };
    }, []);

    useEffect(() => {
        return () => {
            detachWindowListeners();
        };
    }, [detachWindowListeners]);

    const endDrag = useCallback((e) => {
        if (!isDraggingRef.current) return;
        if (pointerIdRef.current !== null && e?.pointerId != null && e.pointerId !== pointerIdRef.current) return;

        isDraggingRef.current = false;

        const pid = pointerIdRef.current;
        pointerIdRef.current = null;

        if (rafIdRef.current) {
            window.cancelAnimationFrame(rafIdRef.current);
            rafIdRef.current = 0;
        }

        const pending = pendingPercentRef.current;
        pendingPercentRef.current = null;
        if (typeof pending === 'number') {
            lastPercentRef.current = pending;
        }

        detachWindowListeners();
        arbiter.release({
            surfaceId: GESTURE_SURFACE.SEEK,
            pointerId: pid,
            reason: 'seek-end',
        });

        try {
            const target = captureTargetRef.current;
            if (pid != null && target?.releasePointerCapture) {
                target.releasePointerCapture(pid);
            }
        } catch {
        }

        rectRef.current = null;
        captureTargetRef.current = null;

        if (typeof onCommit === 'function') {
            onCommit(lastPercentRef.current);
        }
    }, [arbiter, detachWindowListeners, onCommit]);

    const onPointerUp = useCallback((e) => endDrag(e), [endDrag]);
    const onPointerCancel = useCallback((e) => endDrag(e), [endDrag]);

    const onPointerDown = useCallback((e) => {
        if (disabled) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (shouldDeferToMiniPlayerGesture({
            surfaceId: GESTURE_SURFACE.SEEK,
            clientX: e.clientX,
            clientY: e.clientY,
            target: e.target,
            pointerId: e.pointerId,
        })) {
            return;
        }

        const target = e.currentTarget;
        if (!target) return;

        isDraggingRef.current = true;
        pointerIdRef.current = e.pointerId;
        captureTargetRef.current = target;
        rectRef.current = target.getBoundingClientRect();

        if (!arbiter.tryClaim({
            surfaceId: GESTURE_SURFACE.SEEK,
            pointerId: e.pointerId,
            reason: 'seek-pointer-down',
        })) {
            isDraggingRef.current = false;
            pointerIdRef.current = null;
            captureTargetRef.current = null;
            rectRef.current = null;
            return;
        }

        try {
            if (typeof target.setPointerCapture === 'function') {
                target.setPointerCapture(e.pointerId);
            }
        } catch {
        }

        if (!windowListenersRef.current) {
            windowListenersRef.current = true;
            const up = (ev) => endDrag(ev);
            const cancel = (ev) => endDrag(ev);
            const blur = () => endDrag(null);
            windowHandlersRef.current = { up, cancel, blur };
            window.addEventListener('pointerup', up, true);
            window.addEventListener('pointercancel', cancel, true);
            window.addEventListener('blur', blur, true);
        }

        if (typeof onBegin === 'function') {
            onBegin();
        }

        const percent = computePercent(e.clientX);
        lastPercentRef.current = percent;
        pendingPercentRef.current = null;
        if (typeof onPreview === 'function') {
            onPreview(percent);
        }
    }, [arbiter, disabled, endDrag, onBegin, computePercent, onPreview]);

    const onPointerMove = useCallback((e) => {
        if (disabled) return;
        if (!isDraggingRef.current) return;
        if (pointerIdRef.current !== null && e.pointerId !== pointerIdRef.current) return;

        if (e.cancelable) e.preventDefault();

        const percent = computePercent(e.clientX);
        lastPercentRef.current = percent;
        if (typeof onPreview === 'function') {
            onPreview(percent);
        }
    }, [disabled, computePercent, onPreview]);

    return {
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onPointerCancel,
    };
}
