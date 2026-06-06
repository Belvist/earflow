import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useMotionValue, useTransform, animate } from 'framer-motion';
import {
  PLAYER_SHEET,
  getPlayerSheetClosedY,
  getPlayerSheetHeight,
  progressToSheetY,
  rubberBandSheetY,
  shapeSheetSnapVelocity,
  shouldSnapOpen,
  yToSheetProgress,
} from '../../utils/playerSheetPhysics';
import {
  isSheetDragging,
  isSheetGestureActive,
  isSheetModalVisible,
  isSheetOpen,
  isSheetSnapping,
  PLAYER_SHEET_PHASE,
} from './playerSheetPhase';
import { getGlobalGestureArbiter } from '../../gestures/GestureArbiterProvider';
import { getActiveMiniPanPointerId } from './miniPlayerPanSession';

const viewportHeight = () => getPlayerSheetHeight();
const closedY = () => getPlayerSheetClosedY(viewportHeight());

/** Already at top — skip spring to avoid micro-bounce. */
const OPEN_INSTANT_Y_PX = 2;
/** Near bottom — skip close spring so dismiss feels instant. */
const CLOSE_INSTANT_Y_PX = 18;

/**
 * Owner: phase + sheetDragY + sheetProgress + snap springs.
 * Mini expand pan stream lives in useMiniPlayerPan (INV-SHEET-010).
 */
export default function usePlayerSheetState() {
  const [phase, setPhase] = useState(PLAYER_SHEET_PHASE.CLOSED);
  const [holdModalForCloseSnap, setHoldModalForCloseSnap] = useState(false);

  const phaseRef = useRef(PLAYER_SHEET_PHASE.CLOSED);
  const snapAnimationRef = useRef(null);
  const snapTargetRef = useRef(null);
  const snapGenerationRef = useRef(0);
  const dragAnchorYRef = useRef(closedY());
  const dragSourceRef = useRef(null);
  const viewportHeightRef = useRef(viewportHeight());
  const resizeFrameRef = useRef(null);

  const sheetDragY = useMotionValue(closedY());
  const sheetProgress = useMotionValue(PLAYER_SHEET.closedProgress);

  const miniOpacity = useTransform(sheetProgress, [0, 0.28, 0.78, 1], [1, 0.97, 0.38, 0]);
  const miniScale = useTransform(sheetProgress, [0, 0.55, 1], [1, 0.985, 0.94]);
  const miniY = useTransform(sheetProgress, [0, 1], [0, 14]);
  const miniRadius = useTransform(sheetProgress, [0, 1], [14, 22]);

  const setPhaseSafe = useCallback((next) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const stopSnapAnimation = useCallback(() => {
    snapGenerationRef.current += 1;
    snapAnimationRef.current?.stop?.();
    snapAnimationRef.current = null;
    snapTargetRef.current = null;
    setHoldModalForCloseSnap(false);
  }, []);

  const writeSheetY = useCallback((y) => {
    const height = viewportHeight();
    viewportHeightRef.current = height;
    sheetDragY.set(y);
    sheetProgress.set(yToSheetProgress(y, height));
  }, [sheetDragY, sheetProgress]);

  const finishOpen = useCallback(() => {
    stopSnapAnimation();
    writeSheetY(PLAYER_SHEET.open);
    setPhaseSafe(PLAYER_SHEET_PHASE.OPEN);
  }, [setPhaseSafe, stopSnapAnimation, writeSheetY]);

  const finishClosed = useCallback(() => {
    stopSnapAnimation();
    setHoldModalForCloseSnap(false);
    writeSheetY(closedY());
    setPhaseSafe(PLAYER_SHEET_PHASE.CLOSED);
  }, [setPhaseSafe, stopSnapAnimation, writeSheetY]);

  const runSnap = useCallback((targetY, velocityY, nextPhase) => {
    stopSnapAnimation();
    const height = viewportHeight();
    const generation = ++snapGenerationRef.current;
    snapTargetRef.current = targetY;
    setPhaseSafe(PLAYER_SHEET_PHASE.SNAPPING);
    const isClosingSnap = targetY > PLAYER_SHEET.open + 8;
    if (isClosingSnap) {
      setHoldModalForCloseSnap(true);
    }
    snapAnimationRef.current = animate(sheetDragY, targetY, {
      ...(isClosingSnap ? PLAYER_SHEET.closeSpring : PLAYER_SHEET.spring),
      velocity: shapeSheetSnapVelocity({
        currentY: sheetDragY.get(),
        targetY,
        velocityY,
      }),
      onUpdate: (latest) => {
        if (snapGenerationRef.current !== generation) return;
        sheetProgress.set(yToSheetProgress(latest, height));
      },
      onComplete: () => {
        if (snapGenerationRef.current !== generation) return;
        snapAnimationRef.current = null;
        snapTargetRef.current = null;
        dragSourceRef.current = null;
        if (nextPhase === PLAYER_SHEET_PHASE.CLOSED) {
          setHoldModalForCloseSnap(false);
        }
        writeSheetY(targetY);
        setPhaseSafe(nextPhase);
      },
    });
  }, [setPhaseSafe, sheetDragY, sheetProgress, stopSnapAnimation, writeSheetY]);

  const snapToOpen = useCallback((velocityY = 0) => {
    if (sheetDragY.get() <= OPEN_INSTANT_Y_PX) {
      finishOpen();
      return;
    }
    runSnap(PLAYER_SHEET.open, velocityY, PLAYER_SHEET_PHASE.OPEN);
  }, [finishOpen, runSnap, sheetDragY]);

  const snapToClosed = useCallback((velocityY = 0) => {
    dragSourceRef.current = null;
    const target = getPlayerSheetClosedY(viewportHeight());
    const y = sheetDragY.get();
    if (Math.abs(y - target) <= CLOSE_INSTANT_Y_PX) {
      finishClosed();
      return;
    }
    runSnap(target, velocityY, PLAYER_SHEET_PHASE.CLOSED);
  }, [finishClosed, runSnap, sheetDragY]);

  const open = useCallback(() => {
    finishOpen();
  }, [finishOpen]);

  const cancel = useCallback(() => {
    finishClosed();
  }, [finishClosed]);

  const recoverInteraction = useCallback(() => {
    stopSnapAnimation();
    dragSourceRef.current = null;
    writeSheetY(closedY());
    setPhaseSafe(PLAYER_SHEET_PHASE.CLOSED);
  }, [setPhaseSafe, stopSnapAnimation, writeSheetY]);

  const beginSheetDrag = useCallback((source = 'sheet') => {
    stopSnapAnimation();
    setHoldModalForCloseSnap(false);
    dragSourceRef.current = source;
    dragAnchorYRef.current = sheetDragY.get();
    if (phaseRef.current === PLAYER_SHEET_PHASE.CLOSED && sheetProgress.get() > 0.08) {
      finishClosed();
      dragAnchorYRef.current = closedY();
    }
    setPhaseSafe(PLAYER_SHEET_PHASE.DRAGGING);
  }, [finishClosed, setPhaseSafe, sheetDragY, sheetProgress, stopSnapAnimation]);

  /** Mini vertical expand — anchor at closed; moves via applySheetDragStep in useMiniPlayerPan. */
  const beginExpandPan = useCallback(() => {
    if (isSheetOpen(phaseRef.current)) return;
    writeSheetY(closedY());
    beginSheetDrag('mini');
  }, [beginSheetDrag, writeSheetY]);

  const applySheetDragDelta = useCallback((dy) => {
    const height = viewportHeight();
    writeSheetY(rubberBandSheetY(dragAnchorYRef.current + Number(dy || 0), height));
  }, [writeSheetY]);

  const applySheetDragStep = useCallback((stepDy) => {
    const height = viewportHeight();
    writeSheetY(rubberBandSheetY(sheetDragY.get() + Number(stepDy || 0), height));
  }, [sheetDragY, writeSheetY]);

  const settleDrag = useCallback((velocityY = 0, travelY = 0) => {
    if (!isSheetGestureActive(phaseRef.current)) return;
    stopSnapAnimation();

    const height = viewportHeight();
    const y = sheetDragY.get();
    if (shouldSnapOpen({ y, velocityY, height, travelY })) {
      snapToOpen(velocityY);
      return;
    }
    snapToClosed(velocityY);
  }, [sheetDragY, snapToClosed, snapToOpen, stopSnapAnimation]);

  const syncToViewport = useCallback(() => {
    const previousHeight = viewportHeightRef.current || viewportHeight();
    const nextHeight = viewportHeight();
    const snapTarget = snapTargetRef.current;
    viewportHeightRef.current = nextHeight;

    if (snapTarget != null) {
      writeSheetY(snapTarget <= PLAYER_SHEET.open ? PLAYER_SHEET.open : getPlayerSheetClosedY(nextHeight));
      return;
    }
    if (isSheetOpen(phaseRef.current)) {
      writeSheetY(PLAYER_SHEET.open);
      return;
    }
    if (isSheetDragging(phaseRef.current) || isSheetSnapping(phaseRef.current)) {
      writeSheetY(progressToSheetY(yToSheetProgress(sheetDragY.get(), previousHeight), nextHeight));
      return;
    }
    writeSheetY(getPlayerSheetClosedY(nextHeight));
  }, [sheetDragY, writeSheetY]);

  const scheduleViewportSync = useCallback(() => {
    if (resizeFrameRef.current != null) return;
    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      syncToViewport();
    });
  }, [syncToViewport]);

  const resetOnTrackChange = useCallback(() => {
    if (isSheetModalVisible(phaseRef.current)) {
      finishOpen();
      return;
    }
    setPhaseSafe(PLAYER_SHEET_PHASE.CLOSED);
  }, [finishOpen, setPhaseSafe]);

  useEffect(() => {
    const vp = window.visualViewport;
    window.addEventListener('resize', scheduleViewportSync);
    vp?.addEventListener?.('resize', scheduleViewportSync);
    return () => {
      window.removeEventListener('resize', scheduleViewportSync);
      vp?.removeEventListener?.('resize', scheduleViewportSync);
      if (resizeFrameRef.current != null) window.cancelAnimationFrame(resizeFrameRef.current);
    };
  }, [scheduleViewportSync]);

  useEffect(() => {
    const root = document.documentElement;
    if (isSheetModalVisible(phase)) {
      root.setAttribute('data-player-sheet-open', 'true');
    } else {
      root.removeAttribute('data-player-sheet-open');
    }
    return () => root.removeAttribute('data-player-sheet-open');
  }, [phase]);

  useEffect(() => {
    if (phase !== PLAYER_SHEET_PHASE.CLOSED) return;
    if (snapAnimationRef.current) return;
    const targetY = closedY();
    if (Math.abs(sheetDragY.get() - targetY) > 6) {
      writeSheetY(targetY);
    }
  }, [phase, sheetDragY, writeSheetY]);

  useEffect(() => {
    if (phase !== PLAYER_SHEET_PHASE.DRAGGING) return undefined;
    const id = window.setTimeout(() => {
      if (phaseRef.current !== PLAYER_SHEET_PHASE.DRAGGING) return;
      if (snapAnimationRef.current) return;
      const height = viewportHeight();
      const y = sheetDragY.get();
      const progress = yToSheetProgress(y, height);
      const fromMini = dragSourceRef.current === 'mini';
      if (fromMini) {
        if (getActiveMiniPanPointerId() != null) return;
        if (getGlobalGestureArbiter().hasExclusiveMiniPointer()) return;
        settleDrag(0, 0);
        return;
      }
      const midHang = progress > 0.06 && progress < 0.94;
      if (midHang) {
        settleDrag(0, 0);
        return;
      }
      settleDrag(0, 0);
    }, dragSourceRef.current === 'mini' ? 1100 : 900);
    return () => window.clearTimeout(id);
  }, [phase, sheetDragY, settleDrag]);

  useEffect(() => {
    if (phase !== PLAYER_SHEET_PHASE.SNAPPING) return undefined;
    const id = window.setTimeout(() => {
      if (phaseRef.current !== PLAYER_SHEET_PHASE.SNAPPING) return;
      if (snapAnimationRef.current) return;
      const y = sheetDragY.get();
      if (y <= OPEN_INSTANT_Y_PX + 24) {
        finishOpen();
        return;
      }
      finishClosed();
    }, 2200);
    return () => window.clearTimeout(id);
  }, [phase, sheetDragY, finishClosed, finishOpen]);

  useEffect(() => () => stopSnapAnimation(), [stopSnapAnimation]);

  const sheetOpen = isSheetOpen(phase);
  const modalVisible = useMemo(
    () => isSheetModalVisible(phase) || holdModalForCloseSnap,
    [phase, holdModalForCloseSnap],
  );
  const draggingFromMini = phase === PLAYER_SHEET_PHASE.DRAGGING && dragSourceRef.current === 'mini';

  return {
    phase,
    phaseRef,
    modalVisible,
    holdModalForCloseSnap,
    dragging: isSheetDragging(phase),
    snapping: isSheetSnapping(phase),
    sheetOpen,
    draggingFromMini,
    miniBarPointerEvents: sheetOpen || (modalVisible && !draggingFromMini) ? 'none' : 'auto',
    sheetDragY,
    sheetProgress,
    miniOpacity,
    miniScale,
    miniY,
    miniRadius,
    open,
    beginExpandPan,
    beginSheetDrag,
    applySheetDragDelta,
    applySheetDragStep,
    settleDrag,
    cancel,
    recoverInteraction,
    finishOpen,
    finishClosed,
    stopSnapAnimation,
    resetOnTrackChange,
    getSheetClosedY: closedY,
    getViewportHeight: viewportHeight,
  };
}
