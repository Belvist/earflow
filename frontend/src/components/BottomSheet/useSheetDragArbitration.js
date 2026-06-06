import { useCallback, useRef } from 'react';
import {
  IOS_GESTURE,
  isInteractiveGestureTarget,
} from '../../utils/gestureIntent';
import { GESTURE_CAPTURE_POLICY, GESTURE_SURFACE } from '../../gestures/gestureContracts';
import { GESTURE_PROFILE } from '../../gestures/gestureProfiles';
import { usePointerGestureMachine } from '../../gestures/usePointerGestureMachine';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function shouldIgnoreTarget(target) {
  return isInteractiveGestureTarget(target, ['[data-sheet-no-drag]']);
}

/**
 * Arbiter-native bottom sheet Y drag — no Framer drag recognizer (INV-GESTURE-012).
 */
export default function useSheetDragArbitration({
  contentRef,
  y,
  hiddenY = 0,
  stopAnim,
  pickSnapTarget,
  animateTo,
  onClose,
  thresholdPx = IOS_GESTURE.intentPx,
  dominance = IOS_GESTURE.dominance,
  surfaceId = GESTURE_SURFACE.SHEET_HANDLE_DRAG,
} = {}) {
  const dragAnchorYRef = useRef(0);

  const shouldActivate = useCallback(({ event, dy }) => {
    if (
      event?.target instanceof Element
      && event.target.closest(`[data-gesture-surface="${GESTURE_SURFACE.SHEET_HANDLE_DRAG}"]`)
    ) {
      return true;
    }

    const el = contentRef?.current;
    if (!el) return true;

    const scrollTop = el.scrollTop || 0;
    const atTop = scrollTop <= 0;

    const isDraggingDown = dy > 0;
    const isDraggingUp = dy < 0;

    const sheetY = typeof y?.get === 'function' ? y.get() : 0;
    const sheetNotFullyExpanded = sheetY > 0.5;

    const canStartDragDown = isDraggingDown && atTop;
    const canStartDragUp = isDraggingUp && atTop && sheetNotFullyExpanded;

    return canStartDragDown || canStartDragUp;
  }, [contentRef, y]);

  const onIntent = useCallback(() => {
    stopAnim?.();
    dragAnchorYRef.current = typeof y?.get === 'function' ? y.get() : 0;
  }, [stopAnim, y]);

  const onActiveMove = useCallback(({ dy }) => {
    if (typeof y?.set !== 'function') return;
    const nextY = clamp(dragAnchorYRef.current + dy, 0, hiddenY);
    y.set(nextY);
  }, [hiddenY, y]);

  const onCommit = useCallback(({ state, dy }) => {
    const current = typeof y?.get === 'function' ? y.get() : 0;
    const velocityY = state?.velocityY ?? 0;
    const { targetY, close } = pickSnapTarget?.(current, velocityY) ?? { targetY: current, close: false };

    if (close) {
      onClose?.();
      return;
    }

    animateTo?.(targetY);
  }, [animateTo, onClose, pickSnapTarget, y]);

  const onCancel = useCallback(() => {
    const current = typeof y?.get === 'function' ? y.get() : 0;
    const { targetY, close } = pickSnapTarget?.(current, 0) ?? { targetY: current, close: false };
    if (close) {
      onClose?.();
      return;
    }
    animateTo?.(targetY);
  }, [animateTo, onClose, pickSnapTarget, y]);

  const { handlers } = usePointerGestureMachine({
    surfaceId,
    profileId: GESTURE_PROFILE.SHEET_DRAG,
    capturePolicy: GESTURE_CAPTURE_POLICY.AFTER_INTENT_LOCK,
    intentPx: thresholdPx,
    dominance,
    shouldIgnoreTarget,
    shouldActivate,
    onIntent,
    onActiveMove,
    onCommit,
    onCancel,
  });

  return handlers;
}
