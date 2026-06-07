import { useRef, useCallback, useEffect } from 'react';
import { useAnimation } from 'framer-motion';
import { getGlobalGestureArbiter } from '../../gestures/GestureArbiterProvider';
import { GESTURE_SURFACE } from '../../gestures/gestureContracts';
import { withAnimationTimeout } from '../../utils/miniTrackSwipeAnimation';
import {
  GESTURE_AXIS,
  IOS_GESTURE,
  classifyMiniBarSheetIntent,
  isInteractiveGestureTarget,
  isPrimaryPointerEvent,
  shouldCommitHorizontalSwipe,
} from '../../utils/gestureIntent';
import { PLAYER_SHEET } from '../../utils/playerSheetPhysics';
import {
  getMiniBarElement,
  isPointerInMiniPlayerGestureZone,
} from '../../gestures/miniPlayerGestureZone';
import {
  isSheetDragging,
  isSheetModalVisible,
  isSheetOpen,
  isSheetSnapping,
  PLAYER_SHEET_PHASE,
} from './playerSheetPhase';
import {
  clearActiveMiniPanPointerId,
  setActiveMiniPanPointerId,
} from './miniPlayerPanSession';

const CAPTURE = { capture: true, passive: false };
const TAP_SLOP_PX = 8;
const SWIPE_COOLDOWN_MS = 160;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const TRACK_SWIPE_EXIT_EASE = [0.32, 0, 0.67, 0];

function getTrackSwipeTravelPx() {
  const bar = getMiniBarElement();
  if (bar && typeof bar.getBoundingClientRect === 'function') {
    return Math.max(260, Math.ceil(bar.getBoundingClientRect().width * 1.08));
  }
  return 300;
}

function travelPreviewCap() {
  return Math.min(140, Math.round(getTrackSwipeTravelPx() * 0.42));
}

function isInteractiveMiniTarget(target) {
  return isInteractiveGestureTarget(target, ['[data-mini-no-drag]']);
}

/**
 * INV-SHEET-010 / MOBILE_PLAYER_SHEET_DESIGN §2 — single mini-bar pan controller.
 * Document pointerdown (rail steal) + window move/up until release. One path for
 * expand, track swipe, tap. No React shell handlers, capture routing, or gesture machine stack.
 */
export default function useMiniPlayerPan({ sheet, player }) {
  const controls = useAnimation();
  const sessionRef = useRef(null);
  const isAnimatingRef = useRef(false);
  const trackAnimIdRef = useRef(0);
  const lastSwipeTimeRef = useRef(0);
  const sheetRef = useRef(sheet);
  const playerRef = useRef(player);

  useEffect(() => {
    sheetRef.current = sheet;
    playerRef.current = player;
  }, [sheet, player]);

  const resetTrackVisual = useCallback(() => {
    if (isAnimatingRef.current) return;
    controls.set({ x: 0, y: 0, opacity: 1 });
    sheetRef.current?.resetOnTrackChange?.();
  }, [controls]);

  const isTrackSwipeAnimating = useCallback(() => isAnimatingRef.current, []);

  const clearMiniPanSession = useCallback((reason = 'clear') => {
    const session = sessionRef.current;
    if (session?.pointerId != null) {
      clearActiveMiniPanPointerId(session.pointerId);
      getGlobalGestureArbiter().release({
        surfaceId: GESTURE_SURFACE.PLAYER_SHEET,
        pointerId: session.pointerId,
        reason: `mini-pan-${reason}`,
      });
    }
    sessionRef.current = null;
    isAnimatingRef.current = false;
    trackAnimIdRef.current += 1;
    controls.stop?.();
    controls.set({ x: 0, y: 0, opacity: 1 });
    getGlobalGestureArbiter().cancelOwner(`mini-pan-${reason}`);
  }, [controls]);

  /** Emergency only — tab hide / unmount / unrecoverable animation error. */
  const forceUnlock = useCallback((reason = 'emergency') => {
    if (reason === 'sheet-closed-clear') {
      clearMiniPanSession(reason);
      return;
    }
    clearMiniPanSession(reason);
    const s = sheetRef.current;
    if (!s) return;
    if (reason === 'visibility' || reason === 'emergency') {
      s.recoverInteraction?.();
      return;
    }
    if (reason === 'track-swipe-error') {
      if (isSheetDragging(s.phaseRef.current)) {
        s.settleDrag(0, 0);
      } else if (!isSheetOpen(s.phaseRef.current)) {
        s.finishClosed?.();
      }
      return;
    }
    if (isSheetDragging(s.phaseRef.current)) {
      s.settleDrag(0, 0);
    }
  }, [clearMiniPanSession]);

  const cleanupTrackAnimation = useCallback(() => {
    sheetRef.current?.stopSnapAnimation?.();
    controls.stop?.();
    trackAnimIdRef.current += 1;
    isAnimatingRef.current = false;
  }, [controls]);

  const animateMiniHome = useCallback(() => (
    controls.start({
      x: 0,
      y: 0,
      opacity: 1,
      transition: { type: 'spring', stiffness: 520, damping: 34 },
    })
  ), [controls]);

  const releaseSession = useCallback((pointerId) => {
    clearActiveMiniPanPointerId(pointerId);
    sessionRef.current = null;
    getGlobalGestureArbiter().release({
      surfaceId: GESTURE_SURFACE.PLAYER_SHEET,
      pointerId,
      reason: 'mini-pan-end',
    });
  }, []);

  const runTrackSwipe = useCallback(async (direction, startX = 0) => {
    // Never controls.stop() here — it snaps x back to 0 before exit (visible "bounce").
    trackAnimIdRef.current += 1;
    const animId = trackAnimIdRef.current;
    isAnimatingRef.current = true;

    const s = sheetRef.current;
    const p = playerRef.current;
    if (!s || !p) {
      isAnimatingRef.current = false;
      return;
    }

    if (!isSheetOpen(s.phaseRef.current)) {
      s.finishClosed();
    }

    try {
      const travel = getTrackSwipeTravelPx();
      const exitX = direction < 0 ? -travel : travel;
      const fromX = clamp(Number(startX) || 0, -travel * 0.55, travel * 0.55);
      controls.set({
        x: fromX,
        y: 0,
        opacity: clamp(1 - Math.abs(fromX) / travel, 0.45, 1),
      });

      await withAnimationTimeout(controls.start({
        x: exitX,
        y: 0,
        opacity: 0,
        transition: { type: 'tween', duration: 0.22, ease: TRACK_SWIPE_EXIT_EASE },
      }));
      if (trackAnimIdRef.current !== animId) return;

      if (direction < 0) p.playNextTrack();
      else p.playPreviousTrack();

      if (trackAnimIdRef.current !== animId) return;
      controls.set({ x: -exitX, y: 0, opacity: 0 });
      await withAnimationTimeout(controls.start({
        x: 0,
        y: 0,
        opacity: 1,
        transition: { type: 'tween', duration: 0.24, ease: [0.22, 1, 0.36, 1] },
      }));
    } catch {
      forceUnlock('track-swipe-error');
    } finally {
      if (trackAnimIdRef.current === animId) {
        isAnimatingRef.current = false;
        controls.set({ x: 0, y: 0, opacity: 1 });
        lastSwipeTimeRef.current = Date.now();
      }
    }
  }, [controls, forceUnlock]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    const onPointerDown = (event) => {
      if (!isPrimaryPointerEvent(event)) return;
      if (sessionRef.current) return;

      const s = sheetRef.current;
      if (!s || isSheetModalVisible(s.phaseRef.current)) return;

      if (!isPointerInMiniPlayerGestureZone({
        clientX: event.clientX,
        clientY: event.clientY,
        target: event.target,
      })) return;

      if (isInteractiveMiniTarget(event.target)) return;

      if (isAnimatingRef.current) {
        cleanupTrackAnimation();
      }

      const arbiter = getGlobalGestureArbiter();
      arbiter.releaseStaleMiniOwners?.(event.pointerId, 'mini-pan-down');
      arbiter.releaseNonMiniOwner?.(event.pointerId, 'mini-pan-down');

      if (!arbiter.tryClaim({
        surfaceId: GESTURE_SURFACE.PLAYER_SHEET,
        pointerId: event.pointerId,
        reason: 'mini-pan-down',
        exclusive: true,
      })) return;

      const phase = s.phaseRef.current;
      if (phase === PLAYER_SHEET_PHASE.DRAGGING) {
        const nearClosed = Math.abs(s.sheetDragY.get() - s.getSheetClosedY()) < 24;
        if (nearClosed) s.finishClosed?.();
        else s.beginSheetDrag('mini');
      } else if (isSheetModalVisible(phase)) {
        if (isSheetSnapping(phase)) {
          s.beginSheetDrag('mini');
        } else {
          s.stopSnapAnimation?.();
        }
      } else {
        s.stopSnapAnimation?.();
        if (Math.abs(s.sheetDragY.get() - s.getSheetClosedY()) > 6) {
          s.finishClosed?.();
        }
      }

      setActiveMiniPanPointerId(event.pointerId);
      sessionRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        lastTime: performance.now(),
        velocityX: 0,
        velocityY: 0,
        intent: null,
        sheetExpandStarted: false,
      };

      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
    };

    const onPointerMove = (event) => {
      const session = sessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;

      const s = sheetRef.current;
      if (!s) return;

      const prevX = session.lastX;
      const prevY = session.lastY;
      const now = performance.now();
      const dt = Math.max(1, now - session.lastTime);
      const dx = event.clientX - session.startX;
      const dy = event.clientY - session.startY;

      session.velocityX = ((event.clientX - prevX) / dt) * 1000;
      session.velocityY = ((event.clientY - prevY) / dt) * 1000;
      session.lastX = event.clientX;
      session.lastY = event.clientY;
      session.lastTime = now;

      const stepDy = event.clientY - prevY;

      if (!session.intent) {
        const horizontalDominant = Math.abs(dx) >= IOS_GESTURE.miniDirectionLockPx
          && Math.abs(dx) > Math.abs(dy) * IOS_GESTURE.miniHorizontalDominance;
        const verticalExpandDominant = dy < -IOS_GESTURE.miniDirectionLockPx
          && Math.abs(dy) > Math.abs(dx) * IOS_GESTURE.miniVerticalDominance;

        if (!isAnimatingRef.current && horizontalDominant) {
          controls.set({
            x: clamp(dx * 0.92, -travelPreviewCap(), travelPreviewCap()),
            y: 0,
            opacity: clamp(1 - Math.abs(dx) / (travelPreviewCap() * 2.2), 0.55, 1),
          });
        }

        // Expand only when upward movement clearly dominates — avoids stealing horizontal track swipes.
        if (verticalExpandDominant && !horizontalDominant && !isAnimatingRef.current) {
          if (!session.sheetExpandStarted) {
            s.beginExpandPan();
            session.sheetExpandStarted = true;
          }
        } else if (Math.max(Math.abs(dx), Math.abs(dy)) < IOS_GESTURE.intentPx) {
          if (session.sheetExpandStarted) {
            s.applySheetDragStep(stepDy);
          }
          return;
        }

        const classified = classifyMiniBarSheetIntent({ dx, dy });
        if (!classified) {
          if (session.sheetExpandStarted) {
            s.applySheetDragStep(stepDy);
          }
          return;
        }

        session.intent = classified;
        if (classified === GESTURE_AXIS.VERTICAL && dy < 0) {
          if (!session.sheetExpandStarted) {
            s.beginExpandPan();
            session.sheetExpandStarted = true;
          }
        }
      }

      if (session.intent === GESTURE_AXIS.HORIZONTAL && !isAnimatingRef.current) {
        controls.set({
          x: clamp(dx * 0.92, -travelPreviewCap(), travelPreviewCap()),
          y: 0,
          opacity: clamp(1 - Math.abs(dx) / (travelPreviewCap() * 2.2), 0.55, 1),
        });
      }

      if (session.sheetExpandStarted && session.intent === GESTURE_AXIS.VERTICAL) {
        s.applySheetDragStep(stepDy);
      }

      if (event.cancelable) event.preventDefault();
    };

    const finishPan = (event) => {
      const session = sessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;

      const s = sheetRef.current;
      const endX = Number.isFinite(event.clientX) ? event.clientX : session.lastX;
      const endY = Number.isFinite(event.clientY) ? event.clientY : session.lastY;
      const dx = endX - session.startX;
      const dy = endY - session.startY;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);

      releaseSession(event.pointerId);

      if (!s) return;

      let intent = session.intent;
      if (!intent && Math.max(absX, absY) >= IOS_GESTURE.miniDirectionLockPx) {
        intent = classifyMiniBarSheetIntent({ dx, dy });
      }

      const swipeDir = intent === GESTURE_AXIS.HORIZONTAL
        ? shouldCommitHorizontalSwipe({
          dx,
          dy,
          velocityX: session.velocityX,
          velocityY: session.velocityY,
        })
        : 0;

      if (swipeDir !== 0
        && Date.now() - lastSwipeTimeRef.current >= SWIPE_COOLDOWN_MS) {
        const cap = travelPreviewCap();
        const releaseX = clamp(dx * 0.92, -cap, cap);
        void runTrackSwipe(swipeDir, releaseX);
        return;
      }

      if (intent === GESTURE_AXIS.HORIZONTAL && absX >= IOS_GESTURE.miniDirectionLockPx) {
        void controls.start({
          x: 0,
          y: 0,
          opacity: 1,
          transition: { type: 'tween', duration: 0.16, ease: 'easeOut' },
        });
        return;
      }

      if (session.sheetExpandStarted && isSheetDragging(s.phaseRef.current)) {
        s.settleDrag(session.velocityY, dy);
        void animateMiniHome();
        return;
      }

      if (!intent && absX < TAP_SLOP_PX && absY < TAP_SLOP_PX) {
        s.open();
        void animateMiniHome();
        return;
      }

      if (intent === GESTURE_AXIS.VERTICAL && dy < 0 && !session.sheetExpandStarted) {
        s.beginExpandPan();
        s.applySheetDragDelta(dy);
        s.settleDrag(session.velocityY, dy);
        void animateMiniHome();
        return;
      }

      if (isSheetDragging(s.phaseRef.current)) {
        s.settleDrag(session.velocityY, dy);
      }
      void animateMiniHome();
    };

    document.addEventListener('pointerdown', onPointerDown, CAPTURE);
    // document capture (not window): Playwright pointerSwipeOn dispatches on mini element;
    // capture on document still sees bubbled/captured pointermove/up (INV-SHEET-010).
    document.addEventListener('pointermove', onPointerMove, CAPTURE);
    document.addEventListener('pointerup', finishPan, CAPTURE);
    document.addEventListener('pointercancel', finishPan, CAPTURE);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, CAPTURE);
      document.removeEventListener('pointermove', onPointerMove, CAPTURE);
      document.removeEventListener('pointerup', finishPan, CAPTURE);
      document.removeEventListener('pointercancel', finishPan, CAPTURE);
      sessionRef.current = null;
      setActiveMiniPanPointerId(null);
    };
  }, [animateMiniHome, controls, cleanupTrackAnimation, releaseSession, runTrackSwipe]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (isAnimatingRef.current) forceUnlock('visibility');
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [forceUnlock]);

  return {
    controls,
    resetTrackVisual,
    cleanupTrackAnimation,
    clearMiniPanSession,
    forceUnlockGestures: forceUnlock,
    recoverGestures: forceUnlock,
    isTrackSwipeAnimating,
  };
}
