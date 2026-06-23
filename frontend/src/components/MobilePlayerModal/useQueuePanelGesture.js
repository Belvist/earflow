import { useCallback, useRef } from 'react';
import { GESTURE_AXIS, IOS_GESTURE, shouldCommitVerticalSheetDetent } from '../../utils/gestureIntent';
import { GESTURE_CAPTURE_POLICY, GESTURE_SURFACE } from '../../gestures/gestureContracts';
import { GESTURE_PROFILE } from '../../gestures/gestureProfiles';
import { usePointerGestureMachine } from '../../gestures/usePointerGestureMachine';

const QUEUE_HANDLE_SELECTOR = '[data-testid="queue-drag-handle"]';

function isQueueHandleTarget(target) {
  return Boolean(target instanceof Element && target.closest(QUEUE_HANDLE_SELECTOR));
}

/**
 * Queue sheet expand / collapse / close via drag handle only (Spotify-style).
 * Tracking runs on the overlay so pointer capture survives long handle drags;
 * only touches that start on the handle are accepted.
 */
export default function useQueuePanelGesture({
  expanded,
  onExpand,
  onCollapse,
  onClose,
} = {}) {
  const expandedRef = useRef(Boolean(expanded));
  expandedRef.current = Boolean(expanded);

  const callbacksRef = useRef({ onExpand, onCollapse, onClose });
  callbacksRef.current = { onExpand, onCollapse, onClose };

  const suppressClickRef = useRef(false);

  const shouldIgnoreTarget = useCallback((target) => !isQueueHandleTarget(target), []);

  const handleCommit = useCallback(({ state, dx, dy, intent }) => {
    suppressClickRef.current = false;
    if (intent !== GESTURE_AXIS.VERTICAL) return;

    const detent = shouldCommitVerticalSheetDetent({
      dy,
      dx,
      velocityY: state?.velocityY ?? 0,
      distancePx: IOS_GESTURE.sheetDetentPx,
      velocityPx: IOS_GESTURE.sheetDetentVelocityPx,
    });

    if (detent > 0) {
      callbacksRef.current.onExpand?.();
      return;
    }

    if (detent < 0) {
      const isExpanded = typeof document !== 'undefined'
        ? document.querySelector('[data-testid="queue-panel-overlay"]')?.getAttribute('data-expanded') === 'true'
        : expandedRef.current;
      if (isExpanded) {
        callbacksRef.current.onCollapse?.();
      } else {
        callbacksRef.current.onClose?.();
      }
    }
  }, []);

  const handleActiveMove = useCallback(() => {
    suppressClickRef.current = true;
  }, []);

  const handleCancel = useCallback(() => {
    suppressClickRef.current = false;
  }, []);

  const { handlers } = usePointerGestureMachine({
    surfaceId: GESTURE_SURFACE.QUEUE_OVERLAY,
    profileId: GESTURE_PROFILE.DEFAULT_AXIS,
    capturePolicy: GESTURE_CAPTURE_POLICY.IMMEDIATE,
    claimOnPointerDown: true,
    intentPx: IOS_GESTURE.intentPx,
    dominance: IOS_GESTURE.dominance,
    shouldIgnoreTarget,
    shouldActivate: ({ intent }) => intent === GESTURE_AXIS.VERTICAL,
    onActiveMove: handleActiveMove,
    onCommit: handleCommit,
    onCancel: handleCancel,
  });

  const consumeClickIfDragged = useCallback((event) => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    return true;
  }, []);

  return {
    handlers,
    consumeClickIfDragged,
  };
}
