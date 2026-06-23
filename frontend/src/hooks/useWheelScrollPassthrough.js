import { useEffect } from 'react';

const WHEEL_OPTS = { passive: true };

/**
 * Horizontal rails: map vertical wheel to scrollLeft when the rail can still scroll.
 * Does not call preventDefault (avoids Chrome passive-listener warnings and React delegation conflicts).
 * Vertical page scroll when the rail is at an edge relies on overscroll-behavior-y: auto on the scroller.
 */
export function useWheelScrollPassthrough(scrollRef) {
  useEffect(() => {
    const el = scrollRef?.current;
    if (!el) return undefined;

    const onWheel = (event) => {
      const { deltaX, deltaY } = event;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);
      if (absY <= absX && absX > 2) return;

      const maxScroll = el.scrollWidth - el.clientWidth;
      if (maxScroll <= 1) return;

      const atStart = el.scrollLeft <= 1;
      const atEnd = el.scrollLeft >= maxScroll - 1;
      const goingRight = deltaY > 0;
      const goingLeft = deltaY < 0;

      if ((goingRight && !atEnd) || (goingLeft && !atStart)) {
        el.scrollLeft += deltaY;
      }
    };

    el.addEventListener('wheel', onWheel, WHEEL_OPTS);
    return () => el.removeEventListener('wheel', onWheel, WHEEL_OPTS);
  }, [scrollRef]);
}

export default useWheelScrollPassthrough;
