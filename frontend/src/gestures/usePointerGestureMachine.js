import { useCallback, useRef, useEffect } from 'react';
import { GESTURE_AXIS, getPointerVelocity, isPrimaryPointerEvent } from '../utils/gestureIntent';
import { getGesturePriority, GESTURE_CAPTURE_POLICY, GESTURE_STATE } from './gestureContracts';
import { getGestureProfile } from './gestureProfiles';
import { useGestureArbiter } from './GestureArbiterProvider';
import {
  isMiniPlayerGestureSurface,
  shouldDeferToMiniPlayerGesture,
} from './miniPlayerGestureZone';
import { recordInteractionEvent, updateInteractionState } from '../utils/interactionDiagnostics';

const emptyHandlers = Object.freeze({
  onPointerDown: undefined,
  onPointerMove: undefined,
  onPointerUp: undefined,
  onPointerCancel: undefined,
});

function getNow() {
  return Date.now();
}

function releasePointerCapture(target, pointerId) {
  try {
    target?.releasePointerCapture?.(pointerId);
  } catch {
  }
}

function capturePointer(target, pointerId) {
  try {
    target?.setPointerCapture?.(pointerId);
    return true;
  } catch {
    return false;
  }
}

function defaultShouldIgnoreTarget() {
  return false;
}

export function usePointerGestureMachine({
  surfaceId,
  profileId,
  priority = getGesturePriority(surfaceId),
  capturePolicy = GESTURE_CAPTURE_POLICY.AFTER_INTENT_LOCK,
  intentPx,
  dominance,
  disabled = false,
  claimOnPointerDown = false,
  shouldIgnoreTarget = defaultShouldIgnoreTarget,
  shouldActivate,
  onTrack,
  onTrackingMove,
  onIntent,
  onActiveMove,
  onScrollIntent,
  onCommit,
  onCancel,
  getSurfaceIdForIntent,
} = {}) {
  const arbiter = useGestureArbiter();
  const profile = getGestureProfile(profileId);
  const stateRef = useRef({
    state: GESTURE_STATE.IDLE,
    pointerId: null,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    lastTime: 0,
    velocityX: 0,
    velocityY: 0,
    intent: null,
    activeSurfaceId: surfaceId,
    captured: false,
    target: null,
  });
  const endRef = useRef(null);
  const windowEndHandlerRef = useRef(null);

  const detachWindowEnd = useCallback(() => {
    const handler = windowEndHandlerRef.current;
    if (!handler) return;
    window.removeEventListener('pointerup', handler.onPointerEnd, true);
    window.removeEventListener('pointercancel', handler.onPointerEnd, true);
    window.removeEventListener('touchend', handler.onTouchEnd, true);
    window.removeEventListener('touchcancel', handler.onTouchEnd, true);
    windowEndHandlerRef.current = null;
  }, []);

  const attachWindowEnd = useCallback((pointerId) => {
    detachWindowEnd();
    const finishActiveGesture = (event, reason) => {
      if (stateRef.current.state === GESTURE_STATE.IDLE) return;
      endRef.current?.(event, reason);
    };
    const onPointerEnd = (event) => {
      if (event.pointerId !== pointerId) return;
      finishActiveGesture(event, event.type === 'pointercancel' ? 'cancel' : 'pointer-up-window');
    };
    const onTouchEnd = (event) => {
      if (stateRef.current.state === GESTURE_STATE.IDLE) return;
      const touch = event.changedTouches?.[0];
      if (!touch) return;
      finishActiveGesture({
        pointerId,
        clientX: touch.clientX,
        clientY: touch.clientY,
        type: 'touchend',
      }, event.type === 'touchcancel' ? 'cancel' : 'touch-end-window');
    };
    windowEndHandlerRef.current = { onPointerEnd, onTouchEnd };
    window.addEventListener('pointerup', onPointerEnd, true);
    window.addEventListener('pointercancel', onPointerEnd, true);
    window.addEventListener('touchend', onTouchEnd, true);
    window.addEventListener('touchcancel', onTouchEnd, true);
  }, [detachWindowEnd]);

  const reset = useCallback((reason = 'reset') => {
    detachWindowEnd();
    const state = stateRef.current;
    if (state.captured) {
      releasePointerCapture(state.target, state.pointerId);
    }
    arbiter.release({ surfaceId: state.activeSurfaceId || surfaceId, pointerId: state.pointerId, reason });
    stateRef.current = {
      state: GESTURE_STATE.IDLE,
      pointerId: null,
      startX: 0,
      startY: 0,
      lastX: 0,
      lastY: 0,
      lastTime: 0,
      velocityX: 0,
      velocityY: 0,
      intent: null,
      activeSurfaceId: surfaceId,
      captured: false,
      target: null,
    };
  }, [arbiter, detachWindowEnd, surfaceId]);

  const onPointerDown = useCallback((event) => {
    if (disabled) return;
    if (!isPrimaryPointerEvent(event)) return;
    if (shouldIgnoreTarget(event.target, event)) return;
    if (shouldDeferToMiniPlayerGesture({
      surfaceId,
      clientX: event.clientX,
      clientY: event.clientY,
      target: event.target,
      pointerId: event.pointerId,
    })) {
      return;
    }

    const now = getNow();
    const captured = capturePolicy === GESTURE_CAPTURE_POLICY.IMMEDIATE
      ? capturePointer(event.currentTarget, event.pointerId)
      : false;

    if (claimOnPointerDown && !arbiter.tryClaim({
      surfaceId,
      pointerId: event.pointerId,
      priority: typeof priority === 'function' ? priority({ intent: null, surfaceId }) : priority,
      reason: 'pointer-down',
      exclusive: isMiniPlayerGestureSurface(surfaceId),
    })) {
      if (captured) {
        releasePointerCapture(event.currentTarget, event.pointerId);
      }
      return;
    }

    if ((claimOnPointerDown || captured) && event.cancelable) {
      event.preventDefault();
    }

    stateRef.current = {
      state: GESTURE_STATE.TRACKING,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: now,
      velocityX: 0,
      velocityY: 0,
      intent: null,
      activeSurfaceId: surfaceId,
      captured,
      target: event.currentTarget,
    };

    recordInteractionEvent('gesture:tracking', {
      surfaceId,
      pointerId: event.pointerId,
      profile: profile.id,
    });
    updateInteractionState({
      surfaceId,
      state: GESTURE_STATE.TRACKING,
      pointerId: event.pointerId,
      profile: profile.id,
    });
    onTrack?.({ event, state: stateRef.current });
    if (captured || claimOnPointerDown) {
      attachWindowEnd(event.pointerId);
    }
  }, [arbiter, attachWindowEnd, capturePolicy, claimOnPointerDown, disabled, onTrack, priority, profile.id, shouldIgnoreTarget, surfaceId]);

  const onPointerMove = useCallback((event) => {
    const state = stateRef.current;
    if (disabled || state.state === GESTURE_STATE.IDLE) return;
    if (state.pointerId !== event.pointerId) return;
    if (shouldDeferToMiniPlayerGesture({
      surfaceId,
      clientX: event.clientX,
      clientY: event.clientY,
      target: event.target,
      pointerId: event.pointerId,
    })) {
      return;
    }

    const now = getNow();
    const dt = Math.max(1, now - state.lastTime);
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    state.velocityX = getPointerVelocity(event.clientX, state.lastX, dt);
    state.velocityY = getPointerVelocity(event.clientY, state.lastY, dt);
    state.lastX = event.clientX;
    state.lastY = event.clientY;
    state.lastTime = now;

    const lockDistance = intentPx ?? profile.intentPx ?? 0;
    if (!state.intent) {
      onTrackingMove?.({ event, state, dx, dy, absX, absY });
    }

    if (!state.intent && Math.max(absX, absY) >= lockDistance) {
      const intent = profile.classify({ dx, dy, event, intentPx: lockDistance, dominance });
      if (!intent) {
        return;
      }
      state.intent = intent;

      if (intent === GESTURE_AXIS.SCROLL || intent === GESTURE_AXIS.IGNORE) {
        recordInteractionEvent('gesture:scroll-intent', {
          surfaceId,
          pointerId: state.pointerId,
          intent,
        });
        onScrollIntent?.({ event, state, dx, dy, intent });
        reset('scroll-intent');
        return;
      }

      if (typeof shouldActivate === 'function' && !shouldActivate({ event, state, dx, dy, intent })) {
        onCancel?.({ event, state, reason: 'activation-gate-rejected', dx, dy, intent });
        reset('activation-gate-rejected');
        return;
      }

      const activeSurfaceId = typeof getSurfaceIdForIntent === 'function'
        ? getSurfaceIdForIntent({ event, state, dx, dy, intent }) || surfaceId
        : surfaceId;
      state.activeSurfaceId = activeSurfaceId;

      const claimed = arbiter.tryClaim({
        surfaceId: activeSurfaceId,
        pointerId: state.pointerId,
        priority: typeof priority === 'function' ? priority({ intent, surfaceId: activeSurfaceId }) : priority,
        reason: intent,
        allowSamePointerTransfer: claimOnPointerDown,
        exclusive: claimOnPointerDown && isMiniPlayerGestureSurface(activeSurfaceId),
      });
      if (!claimed) {
        onCancel?.({ event, state, reason: 'claim-rejected', dx, dy, intent });
        reset('claim-rejected');
        return;
      }

      state.state = GESTURE_STATE.INTENT_LOCKED;
      if (capturePolicy === GESTURE_CAPTURE_POLICY.AFTER_INTENT_LOCK) {
        state.captured = capturePointer(event.currentTarget, event.pointerId);
      }
      if (event.cancelable) {
        event.preventDefault();
      }
      event.stopPropagation?.();
      onIntent?.({ event, state, dx, dy, intent });
      if (!claimOnPointerDown) {
        attachWindowEnd(state.pointerId);
      }
      updateInteractionState({
        surfaceId: activeSurfaceId,
        state: GESTURE_STATE.INTENT_LOCKED,
        intent,
        capture: state.captured,
        pointerId: state.pointerId,
      });
    }

    if (state.state === GESTURE_STATE.INTENT_LOCKED || state.state === GESTURE_STATE.ACTIVE) {
      state.state = GESTURE_STATE.ACTIVE;
      if (event.cancelable) {
        event.preventDefault();
      }
      event.stopPropagation?.();
      onActiveMove?.({ event, state, dx, dy, intent: state.intent });
    }
  }, [
    arbiter,
    capturePolicy,
    claimOnPointerDown,
    disabled,
    dominance,
    getSurfaceIdForIntent,
    intentPx,
    onTrackingMove,
    onActiveMove,
    onCancel,
    onIntent,
    onScrollIntent,
    priority,
    profile,
    reset,
    shouldActivate,
    surfaceId,
  ]);

  const end = useCallback((event, reason) => {
    const state = stateRef.current;
    if (state.state === GESTURE_STATE.IDLE) return;
    if (event?.pointerId != null && state.pointerId !== event.pointerId) return;

    const trackedDx = state.lastX - state.startX;
    const trackedDy = state.lastY - state.startY;
    const eventDx = event && typeof event.clientX === 'number' ? event.clientX - state.startX : trackedDx;
    const eventDy = event && typeof event.clientY === 'number' ? event.clientY - state.startY : trackedDy;
    const dx = Number.isFinite(trackedDx) && Math.abs(trackedDx) >= Math.abs(eventDx)
      ? trackedDx
      : eventDx;
    const dy = Number.isFinite(trackedDy) && Math.abs(trackedDy) >= Math.abs(eventDy)
      ? trackedDy
      : eventDy;
    const snapshot = { ...state };

    if (reason === 'cancel') {
      onCancel?.({ event, state: snapshot, reason, dx, dy, intent: snapshot.intent });
      updateInteractionState({
        surfaceId,
        state: GESTURE_STATE.CANCELLED,
        pointerId: snapshot.pointerId,
        intent: snapshot.intent,
      });
      reset(reason);
      return;
    }

    onCommit?.({ event, state: snapshot, dx, dy, intent: snapshot.intent });
    reset(reason);
  }, [onCancel, onCommit, reset, surfaceId]);

  const onPointerUp = useCallback((event) => end(event, 'pointer-up'), [end]);
  const onPointerCancel = useCallback((event) => end(event, 'cancel'), [end]);

  useEffect(() => {
    endRef.current = end;
  }, [end]);

  const resetRef = useRef(reset);
  useEffect(() => {
    resetRef.current = reset;
  }, [reset]);

  // Clean up gesture claim and capture ONLY on unmount to prevent leaked arbiter ownership
  useEffect(() => {
    return () => {
      detachWindowEnd();
      resetRef.current('unmount');
    };
  }, [detachWindowEnd]);

  if (!surfaceId || disabled) {
    return { handlers: emptyHandlers, stateRef, reset };
  }

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
    },
    stateRef,
    reset,
  };
}
