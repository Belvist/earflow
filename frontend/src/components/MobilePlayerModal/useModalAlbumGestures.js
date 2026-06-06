import { useCallback, useRef } from 'react';
import { useAnimation } from 'framer-motion';
import {
  GESTURE_AXIS,
  IOS_GESTURE,
  isInteractiveGestureTarget,
  shouldCommitHorizontalSwipe,
  shouldCommitVerticalDismiss,
} from '../../utils/gestureIntent';
import {
  GESTURE_CAPTURE_POLICY,
  GESTURE_SURFACE,
  GESTURE_PRIORITY,
} from '../../gestures/gestureContracts';
import { GESTURE_PROFILE } from '../../gestures/gestureProfiles';
import { usePointerGestureMachine } from '../../gestures/usePointerGestureMachine';
import { canSheetDragDismissFromTarget } from '../../utils/sheetScrollHandoff';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Above MODAL_DISMISS (550) — one surface, intent lock for H track / V dismiss. */
const ALBUM_GESTURE_PRIORITY = GESTURE_PRIORITY[GESTURE_SURFACE.MODAL_DISMISS] + 20;

function shouldIgnoreAlbumGestureTarget(target) {
  return isInteractiveGestureTarget(target, [
    '[data-player-no-drag]',
    '[data-sheet-no-drag]',
    '#mobile-progress-bar',
  ]);
}

/**
 * Full-player album: horizontal next/prev + vertical dismiss down (INV-SHEET-006).
 * Single hook / single COVER_STACK claim — intent lock chooses axis.
 */
export default function useModalAlbumGestures({
  disabled = false,
  useOwnedSheetDrag = false,
  onSheetDragStart,
  onSheetDragMove,
  onSheetDragSettle,
  onDismissDragging,
  onNextTrack,
  onPreviousTrack,
} = {}) {
  const coverShift = useAnimation();
  const dismissDragStartedRef = useRef(false);

  const resetCoverShift = useCallback(() => {
    coverShift.set({ x: 0 });
    dismissDragStartedRef.current = false;
  }, [coverShift]);

  const ensureDismissDrag = useCallback(() => {
    if (!useOwnedSheetDrag || dismissDragStartedRef.current) return;
    dismissDragStartedRef.current = true;
    onSheetDragStart?.('modal');
  }, [onSheetDragStart, useOwnedSheetDrag]);

  const handleTrackingMove = useCallback(({ dy, absX, absY }) => {
    if (!useOwnedSheetDrag) return;
    if (dy <= 0) return;
    if (absY < 2) return;
    if (absX > absY * 1.05) return;
    ensureDismissDrag();
    onSheetDragMove?.(dy);
  }, [ensureDismissDrag, onSheetDragMove, useOwnedSheetDrag]);

  const handleActiveMove = useCallback(({ dx, dy, intent }) => {
    if (intent === GESTURE_AXIS.HORIZONTAL) {
      coverShift.set({ x: clamp(dx * 0.42, -100, 100) });
      return;
    }
    if (intent === GESTURE_AXIS.VERTICAL && dy > 0 && useOwnedSheetDrag) {
      ensureDismissDrag();
      onSheetDragMove?.(dy);
    }
  }, [coverShift, ensureDismissDrag, onSheetDragMove, useOwnedSheetDrag]);

  const handleCommit = useCallback(({ state, dx, dy, intent }) => {
    onDismissDragging?.(false);
    resetCoverShift();

    if (intent === GESTURE_AXIS.HORIZONTAL) {
      const direction = shouldCommitHorizontalSwipe({
        dx,
        dy,
        velocityX: state.velocityX,
        velocityY: state.velocityY,
      });
      if (direction < 0) onNextTrack?.();
      else if (direction > 0) onPreviousTrack?.();
      return;
    }

    if (intent === GESTURE_AXIS.VERTICAL && dy > 0 && useOwnedSheetDrag) {
      if (shouldCommitVerticalDismiss({ dy, velocityY: state.velocityY })) {
        onSheetDragSettle?.(state.velocityY, dy);
      } else {
        onSheetDragSettle?.(0, 0);
      }
    }
  }, [
    onDismissDragging,
    onNextTrack,
    onPreviousTrack,
    onSheetDragSettle,
    resetCoverShift,
    useOwnedSheetDrag,
  ]);

  const { handlers } = usePointerGestureMachine({
    surfaceId: GESTURE_SURFACE.COVER_STACK,
    profileId: GESTURE_PROFILE.DEFAULT_AXIS,
    priority: ALBUM_GESTURE_PRIORITY,
    capturePolicy: GESTURE_CAPTURE_POLICY.AFTER_INTENT_LOCK,
    claimOnPointerDown: false,
    intentPx: IOS_GESTURE.intentPx,
    dominance: IOS_GESTURE.dominance,
    disabled,
    shouldIgnoreTarget: shouldIgnoreAlbumGestureTarget,
    shouldActivate: ({ event, intent, dx, dy }) => {
      if (intent === GESTURE_AXIS.HORIZONTAL) return true;
      if (intent === GESTURE_AXIS.VERTICAL) {
        return dy > 0 && canSheetDragDismissFromTarget(event.target);
      }
      return false;
    },
    getSurfaceIdForIntent: ({ intent }) => (
      intent === GESTURE_AXIS.HORIZONTAL ? GESTURE_SURFACE.COVER_STACK : GESTURE_SURFACE.MODAL_DISMISS
    ),
    onTrackingMove: handleTrackingMove,
    onIntent: ({ intent }) => {
      if (intent === GESTURE_AXIS.VERTICAL) {
        onDismissDragging?.(true);
        ensureDismissDrag();
      }
    },
    onActiveMove: handleActiveMove,
    onCommit: handleCommit,
    onCancel: ({ intent }) => {
      onDismissDragging?.(false);
      resetCoverShift();
      if (intent === GESTURE_AXIS.VERTICAL && useOwnedSheetDrag) {
        onSheetDragSettle?.(0, 0);
      }
    },
  });

  return { handlers, coverShift };
}
