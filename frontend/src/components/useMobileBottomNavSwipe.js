import { useCallback, useRef } from 'react';
import { useAnimation } from 'framer-motion';
import {
  GESTURE_AXIS,
  IOS_GESTURE,
  shouldCommitHorizontalSwipe,
} from '../utils/gestureIntent';
import {
  GESTURE_CAPTURE_POLICY,
  GESTURE_DATA_ATTRIBUTE,
  GESTURE_SURFACE,
} from '../gestures/gestureContracts';
import { GESTURE_PROFILE } from '../gestures/gestureProfiles';
import { usePointerGestureMachine } from '../gestures/usePointerGestureMachine';
import { resolveAdjacentNavTab } from './mobileBottomNavTabs';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * iOS-style horizontal swipe on bottom nav pill — adjacent tab only (INV-GESTURE-011).
 * One surface via usePointerGestureMachine; taps still reach TabButton when travel < slop.
 */
export default function useMobileBottomNavSwipe({
  activeTab = '',
  onSelectTab,
  disabled = false,
} = {}) {
  const swipeCommittedRef = useRef(false);
  const pillShift = useAnimation();

  const resetShift = useCallback(() => {
    pillShift.set({ x: 0 });
  }, [pillShift]);

  const handleActiveMove = useCallback(({ dx, intent }) => {
    if (intent !== GESTURE_AXIS.HORIZONTAL) return;
    pillShift.set({ x: clamp(dx * 0.18, -28, 28) });
  }, [pillShift]);

  const handleCommit = useCallback(({ dx, dy, intent, state }) => {
    resetShift();
    if (intent !== GESTURE_AXIS.HORIZONTAL) return;

    const direction = shouldCommitHorizontalSwipe({
      dx,
      dy,
      velocityX: state.velocityX,
      velocityY: state.velocityY,
    });
    const nextTab = resolveAdjacentNavTab(activeTab, direction);
    if (!nextTab) return;
    swipeCommittedRef.current = true;
    onSelectTab?.(nextTab);
  }, [activeTab, onSelectTab, resetShift]);

  const suppressTapIfSwipeCommitted = useCallback(() => {
    if (!swipeCommittedRef.current) return false;
    swipeCommittedRef.current = false;
    return true;
  }, []);

  const { handlers: machineHandlers } = usePointerGestureMachine({
    surfaceId: GESTURE_SURFACE.MOBILE_BOTTOM_NAV,
    profileId: GESTURE_PROFILE.HORIZONTAL_SWIPE,
    capturePolicy: GESTURE_CAPTURE_POLICY.AFTER_INTENT_LOCK,
    claimOnPointerDown: false,
    intentPx: IOS_GESTURE.intentPx,
    dominance: IOS_GESTURE.dominance,
    disabled: disabled || !activeTab,
    shouldActivate: ({ intent }) => intent === GESTURE_AXIS.HORIZONTAL,
    onActiveMove: handleActiveMove,
    onCommit: handleCommit,
    onCancel: resetShift,
  });

  const handlers = {
    onPointerDown: (event) => {
      swipeCommittedRef.current = false;
      machineHandlers.onPointerDown?.(event);
    },
    onPointerMove: machineHandlers.onPointerMove,
    onPointerUp: machineHandlers.onPointerUp,
    onPointerCancel: machineHandlers.onPointerCancel,
  };

  return {
    handlers,
    pillShift,
    suppressTapIfSwipeCommitted,
    gestureSurfaceAttr: { [GESTURE_DATA_ATTRIBUTE.SURFACE]: GESTURE_SURFACE.MOBILE_BOTTOM_NAV },
  };
}
