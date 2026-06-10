import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  GESTURE_AXIS,
  IOS_GESTURE,
} from '../utils/gestureIntent';
import {
  GESTURE_CAPTURE_POLICY,
  GESTURE_DATA_ATTRIBUTE,
  GESTURE_SURFACE,
} from '../gestures/gestureContracts';
import { GESTURE_PROFILE } from '../gestures/gestureProfiles';
import { usePointerGestureMachine } from '../gestures/usePointerGestureMachine';
import {
  getNavTabIndex,
  resolveTabFromDragOffset,
} from './mobileBottomNavTabs';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const PILL_DRAG_FOLLOW = 0.48;
const PILL_SCALE_MAX = 0.07;
const INDICATOR_RUBBER = 1.15;

const IDLE_DRAG = Object.freeze({
  active: false,
  pillX: 0,
  scale: 1,
  indicatorOffsetPx: 0,
  visualIndex: 0,
});

/**
 * iOS Liquid Glass tab bar drag — pill follows finger, scales up, indicator slides between tabs.
 * INV-GESTURE-011: single surface via usePointerGestureMachine.
 */
export default function useMobileBottomNavSwipe({
  pillRef,
  activeTab = '',
  onSelectTab,
  disabled = false,
} = {}) {
  const swipeCommittedRef = useRef(false);
  const pillWidthRef = useRef(0);
  const activeIndex = Math.max(0, getNavTabIndex(activeTab));

  const [segmentWidthPx, setSegmentWidthPx] = useState(0);
  const [dragVisual, setDragVisual] = useState(IDLE_DRAG);

  useEffect(() => {
    const node = pillRef?.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;

    const measure = (width) => {
      const w = Math.max(0, Math.floor(width));
      pillWidthRef.current = w;
      setSegmentWidthPx(w > 0 ? w / 4 : 0);
    };

    measure(node.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      measure(entry.contentRect.width);
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [pillRef]);

  const applyDragFrame = useCallback((dx, intent) => {
    const seg = pillWidthRef.current > 0 ? pillWidthRef.current / 4 : segmentWidthPx;
    if (!seg || intent !== GESTURE_AXIS.HORIZONTAL) return;

    const maxTravel = seg * INDICATOR_RUBBER;
    const dxClamped = clamp(dx, -maxTravel, maxTravel);
    const progress = Math.min(1, Math.abs(dxClamped) / (seg * 0.9));
    const scale = 1 + progress * PILL_SCALE_MAX;
    const pillX = dxClamped * PILL_DRAG_FOLLOW;
    const indicatorOffsetPx = -dxClamped;
    const visualIndex = clamp(activeIndex - dxClamped / seg, 0, 3);

    setDragVisual({
      active: true,
      pillX,
      scale,
      indicatorOffsetPx,
      visualIndex,
    });
  }, [activeIndex, segmentWidthPx]);

  const resetDragVisual = useCallback((visualIndex = activeIndex) => {
    setDragVisual({
      active: false,
      pillX: 0,
      scale: 1,
      indicatorOffsetPx: 0,
      visualIndex,
    });
  }, [activeIndex]);

  const handleCommit = useCallback(({ dx, intent, state }) => {
    const seg = pillWidthRef.current > 0 ? pillWidthRef.current / 4 : segmentWidthPx;

    if (intent !== GESTURE_AXIS.HORIZONTAL || !seg) {
      resetDragVisual(activeIndex);
      return;
    }

    const nextTab = resolveTabFromDragOffset({
      activeTab,
      dx,
      segmentWidthPx: seg,
      velocityX: state.velocityX,
    });

    if (nextTab) {
      swipeCommittedRef.current = true;
      onSelectTab?.(nextTab);
    }

    const nextIndex = nextTab ? getNavTabIndex(nextTab) : activeIndex;
    resetDragVisual(nextIndex);
  }, [activeIndex, activeTab, onSelectTab, resetDragVisual, segmentWidthPx]);

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
    disabled,
    shouldActivate: ({ intent }) => intent === GESTURE_AXIS.HORIZONTAL,
    onActiveMove: ({ dx, intent }) => applyDragFrame(dx, intent),
    onCommit: handleCommit,
    onCancel: () => resetDragVisual(activeIndex),
  });

  const wrapHandler = (handler) => (event) => {
    if (handler === machineHandlers.onPointerDown) {
      swipeCommittedRef.current = false;
    }
    handler?.(event);
  };

  const captureHandlers = {
    onPointerDownCapture: wrapHandler(machineHandlers.onPointerDown),
    onPointerMoveCapture: wrapHandler(machineHandlers.onPointerMove),
    onPointerUpCapture: wrapHandler(machineHandlers.onPointerUp),
    onPointerCancelCapture: wrapHandler(machineHandlers.onPointerCancel),
  };

  const litTabIndex = dragVisual.active
    ? Math.round(dragVisual.visualIndex)
    : activeIndex;

  const indicatorX = (activeIndex * segmentWidthPx) + dragVisual.indicatorOffsetPx;

  return {
    captureHandlers,
    dragVisual,
    segmentWidthPx,
    activeIndex,
    litTabIndex,
    indicatorX,
    suppressTapIfSwipeCommitted,
    gestureSurfaceAttr: { [GESTURE_DATA_ATTRIBUTE.SURFACE]: GESTURE_SURFACE.MOBILE_BOTTOM_NAV },
  };
}
