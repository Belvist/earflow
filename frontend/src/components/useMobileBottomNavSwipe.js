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
  getNavTabCount,
  getNavTabIndex,
  resolveTabFromDragOffset,
} from './mobileBottomNavTabs';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const PILL_SCALE_MAX = 0.05;
const INDICATOR_RUBBER = 1.12;

const IDLE_DRAG = Object.freeze({
  active: false,
  scale: 1,
  indicatorX: 0,
  visualIndex: 0,
});

/**
 * Liquid Glass tab drag — scale pill + sliding chip inside (chip never leaves pill).
 * INV-GESTURE-011: usePointerGestureMachine only.
 */
export default function useMobileBottomNavSwipe({
  trackRef,
  activeTab = '',
  onSelectTab,
  disabled = false,
  innerPadPx = 4,
} = {}) {
  const swipeCommittedRef = useRef(false);
  const segmentWidthRef = useRef(0);
  const activeIndex = Math.max(0, getNavTabIndex(activeTab));
  const tabCount = getNavTabCount();

  const [segmentWidthPx, setSegmentWidthPx] = useState(0);
  const [dragVisual, setDragVisual] = useState(IDLE_DRAG);

  const measureSegments = useCallback(() => {
    const node = trackRef?.current;
    if (!node) return;
    const w = Math.max(0, Math.floor(node.getBoundingClientRect().width));
    const seg = w > 0 ? w / tabCount : 0;
    segmentWidthRef.current = seg;
    setSegmentWidthPx(seg);
  }, [tabCount, trackRef]);

  useEffect(() => {
    measureSegments();
    const node = trackRef?.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => measureSegments());
    ro.observe(node);
    return () => ro.disconnect();
  }, [measureSegments, trackRef]);

  const baseIndicatorX = activeIndex * segmentWidthPx;

  const resetDragVisual = useCallback((index = activeIndex) => {
    const seg = segmentWidthRef.current || segmentWidthPx;
    setDragVisual({
      active: false,
      scale: 1,
      indicatorX: index * seg,
      visualIndex: index,
    });
  }, [activeIndex, segmentWidthPx]);

  useEffect(() => {
    resetDragVisual(activeIndex);
  }, [activeIndex, segmentWidthPx, resetDragVisual]);

  const applyDragFrame = useCallback((dx, intent) => {
    const seg = segmentWidthRef.current || segmentWidthPx;
    if (!seg || intent !== GESTURE_AXIS.HORIZONTAL) return;

    const maxOffset = seg * INDICATOR_RUBBER;
    const dxClamped = clamp(dx, -maxOffset, maxOffset);
    const progress = Math.min(1, Math.abs(dxClamped) / (seg * 0.85));
    const scale = 1 + progress * PILL_SCALE_MAX;
    const maxX = Math.max(0, (tabCount - 1) * seg);
    const indicatorX = clamp(baseIndicatorX - dxClamped, 0, maxX);
    const visualIndex = clamp(indicatorX / seg, 0, tabCount - 1);

    setDragVisual({
      active: true,
      scale,
      indicatorX,
      visualIndex,
    });
  }, [baseIndicatorX, segmentWidthPx, tabCount]);

  const handleCommit = useCallback(({ dx, intent, state }) => {
    const seg = segmentWidthRef.current || segmentWidthPx;

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

  const indicatorX = dragVisual.active ? dragVisual.indicatorX : baseIndicatorX;

  return {
    captureHandlers,
    dragVisual,
    segmentWidthPx,
    litTabIndex,
    indicatorX,
    innerPadPx,
    suppressTapIfSwipeCommitted,
    gestureSurfaceAttr: { [GESTURE_DATA_ATTRIBUTE.SURFACE]: GESTURE_SURFACE.MOBILE_BOTTOM_NAV },
  };
}
