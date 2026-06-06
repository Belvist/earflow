import { useEffect } from 'react';
import { getGlobalGestureArbiter } from './GestureArbiterProvider';
import { isPointerInMiniPlayerGestureZone } from './miniPlayerGestureZone';

const CAPTURE_OPTS = { capture: true, passive: false };

/**
 * iOS: block native pan-x on underlying rails while mini holds an exclusive pointer.
 */
export function useExclusiveMiniTouchMoveGuard() {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    const onTouchMove = (event) => {
      if (!getGlobalGestureArbiter().hasExclusiveMiniPointer()) return;
      if (event.cancelable) {
        event.preventDefault();
      }
    };

    document.addEventListener('touchmove', onTouchMove, CAPTURE_OPTS);
    return () => {
      document.removeEventListener('touchmove', onTouchMove, CAPTURE_OPTS);
    };
  }, []);
}

/**
 * Block native pan-x on rails when finger moves inside mini-bar bbox.
 * touchstart is NOT blocked — preventDefault there kills pointerdown on iOS.
 */
export function useHorizontalScrollMiniZoneGuard(scrollRef) {
  useEffect(() => {
    const el = scrollRef?.current;
    if (!el) return undefined;

    const onTouchMove = (event) => {
      const touch = event.touches?.[0];
      if (!touch) return;
      if (!isPointerInMiniPlayerGestureZone({
        clientX: touch.clientX,
        clientY: touch.clientY,
        target: event.target,
      })) {
        return;
      }
      if (getGlobalGestureArbiter().hasExclusiveMiniPointer()) return;
      if (event.cancelable) {
        event.preventDefault();
      }
    };

    el.addEventListener('touchmove', onTouchMove, CAPTURE_OPTS);
    return () => {
      el.removeEventListener('touchmove', onTouchMove, CAPTURE_OPTS);
    };
  }, [scrollRef]);
}
