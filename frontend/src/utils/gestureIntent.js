export const GESTURE_AXIS = Object.freeze({
  HORIZONTAL: 'horizontal',
  VERTICAL: 'vertical',
  SCROLL: 'scroll',
  DISMISS: 'dismiss',
  IGNORE: 'ignore',
});

/** Spotify/iOS-like thresholds — tuned for flick commits and shorter deliberate swipes. */
export const IOS_GESTURE = Object.freeze({
  intentPx: 10,
  dominance: 1.32,
  swipeDistancePx: 52,
  swipeVelocityPx: 380,
  swipeMinTravelPx: 14,
  swipeFlickTravelPx: 10,
  dismissDistancePx: 96,
  dismissVelocityPx: 680,
  sheetDetentPx: 48,
  sheetDetentVelocityPx: 420,
  /** Mini-bar direction lock (Spotify-style): X = track, upward Y = expand. */
  miniDirectionLockPx: 14,
  miniHorizontalDominance: 1.15,
  miniVerticalDominance: 0.85,
  miniExpandDistancePx: 80,
  miniExpandVelocityPx: 700,
});

export function isPrimaryPointerEvent(event) {
  if (!event) return false;
  if (event.isPrimary === false) return false;
  if (event.pointerType === 'mouse' && event.button !== 0) return false;
  return true;
}

export function isInteractiveGestureTarget(target, extraSelectors = []) {
  if (!target || !(target instanceof Element)) return false;
  const selectors = [
    'button',
    'a',
    'input',
    'textarea',
    'select',
    '[role="button"]',
    '[contenteditable="true"]',
    ...extraSelectors,
  ];
  return Boolean(target.closest(selectors.join(', ')));
}

export function getPointerVelocity(current, previous, elapsedMs) {
  const dt = Math.max(1, Number(elapsedMs) || 1);
  return ((Number(current) - Number(previous)) / dt) * 1000;
}

export function classifyAxisIntent({
  dx,
  dy,
  intentPx = IOS_GESTURE.intentPx,
  dominance = IOS_GESTURE.dominance,
  verticalSign = 0,
} = {}) {
  const x = Number(dx) || 0;
  const y = Number(dy) || 0;
  const absX = Math.abs(x);
  const absY = Math.abs(y);

  if (Math.max(absX, absY) < intentPx) return null;
  if (absX > absY * dominance) return GESTURE_AXIS.HORIZONTAL;
  if (absY > absX * dominance) {
    if (verticalSign > 0 && y <= 0) return GESTURE_AXIS.SCROLL;
    if (verticalSign < 0 && y >= 0) return GESTURE_AXIS.SCROLL;
    return GESTURE_AXIS.VERTICAL;
  }
  return GESTURE_AXIS.SCROLL;
}

export function getPageScrollMetrics() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { scrollY: 0, maxScrollY: 0 };
  }
  const scrollEl = document.scrollingElement || document.documentElement;
  const body = document.body;
  const lockedTop = body?.style?.position === 'fixed' && body.style.top
    ? Math.abs(Number.parseInt(body.style.top, 10) || 0)
    : null;
  const scrollY = lockedTop != null
    ? lockedTop
    : Math.max(0, window.scrollY || window.pageYOffset || 0);
  const maxScrollY = Math.max(0, (scrollEl?.scrollHeight || 0) - window.innerHeight);
  return { scrollY, maxScrollY };
}

export function classifyMiniPlayerOpenIntent({
  dx,
  dy,
  intentPx = IOS_GESTURE.intentPx,
  scrollY,
  maxScrollY,
} = {}) {
  const x = Number(dx) || 0;
  const y = Number(dy) || 0;
  const absX = Math.abs(x);
  const absY = Math.abs(y);
  const travel = Math.max(absX, absY);

  if (travel < intentPx) return null;

  const metrics = scrollY != null && maxScrollY != null
    ? { scrollY: Number(scrollY) || 0, maxScrollY: Number(maxScrollY) || 0 }
    : getPageScrollMetrics();
  const canScrollDown = metrics.maxScrollY - metrics.scrollY > 6;
  const canScrollUp = metrics.scrollY > 6;

  const isOpening = y < 0;

  // Keep tracking short upward pulls on a scrollable page — decide open vs scroll on commit.
  if (isOpening && canScrollDown && absY >= intentPx && absY < 38 && absY > absX * 0.92) {
    return null;
  }

  // Downward drags while page can scroll up — release to native scroll.
  if (!isOpening && canScrollUp && absY >= intentPx && absY > absX * 0.9) {
    return GESTURE_AXIS.SCROLL;
  }

  if (isOpening && absY >= Math.max(canScrollDown ? 38 : 10, absX * 0.52)) {
    return GESTURE_AXIS.VERTICAL;
  }

  if (absX >= Math.max(26, absY * 1.35)) {
    return GESTURE_AXIS.HORIZONTAL;
  }

  if (travel >= 48 && absY > absX * 1.55 && !isOpening) {
    return GESTURE_AXIS.SCROLL;
  }

  return null;
}

/**
 * Mini-bar uses touch-action:none — page scroll metrics must not steal vertical opens
 * (INV-SHEET-007). Direction lock: upward Y expands sheet, dominant X switches tracks.
 */
export function classifyMiniBarSheetIntent(input = {}) {
  const x = Number(input.dx) || 0;
  const y = Number(input.dy) || 0;
  const absX = Math.abs(x);
  const absY = Math.abs(y);
  const travel = Math.max(absX, absY);
  const lockPx = Number(input.intentPx) || IOS_GESTURE.intentPx;
  const dirLockPx = IOS_GESTURE.miniDirectionLockPx;

  if (travel < lockPx) return null;

  if (y < 0 && absY >= dirLockPx && absY > absX * IOS_GESTURE.miniVerticalDominance) {
    return GESTURE_AXIS.VERTICAL;
  }

  if (absX >= dirLockPx && absX > absY * IOS_GESTURE.miniHorizontalDominance) {
    return GESTURE_AXIS.HORIZONTAL;
  }

  return null;
}

export function shouldCommitHorizontalSwipe({
  dx,
  dy,
  velocityX,
  distancePx = IOS_GESTURE.swipeDistancePx,
  velocityPx = IOS_GESTURE.swipeVelocityPx,
  minTravelPx = IOS_GESTURE.swipeMinTravelPx,
  flickTravelPx = IOS_GESTURE.swipeFlickTravelPx,
  dominance = IOS_GESTURE.dominance,
} = {}) {
  const x = Number(dx) || 0;
  const y = Number(dy) || 0;
  const vx = Number(velocityX) || 0;
  const absX = Math.abs(x);
  const absY = Math.abs(y);
  const absVx = Math.abs(vx);

  if (absX <= absY * dominance) return 0;

  if (absVx >= velocityPx && absX >= flickTravelPx) {
    return x < 0 || vx < 0 ? -1 : 1;
  }

  if (absX >= distancePx && absX >= minTravelPx) {
    return x < 0 ? -1 : 1;
  }

  return 0;
}

export function shouldCommitVerticalDismiss({
  dy,
  velocityY,
  distancePx = IOS_GESTURE.dismissDistancePx,
  velocityPx = IOS_GESTURE.dismissVelocityPx,
} = {}) {
  const y = Number(dy) || 0;
  const vy = Number(velocityY) || 0;
  if (y <= 0) return false;
  return y >= distancePx || vy >= velocityPx;
}

/** Queue / sheet detent: positive = expand up, negative = collapse or close down. */
export function shouldCommitVerticalSheetDetent({
  dy,
  dx = 0,
  velocityY = 0,
  distancePx = IOS_GESTURE.sheetDetentPx,
  velocityPx = IOS_GESTURE.sheetDetentVelocityPx,
  flickTravelPx = IOS_GESTURE.swipeFlickTravelPx,
  dominance = IOS_GESTURE.dominance,
} = {}) {
  const y = Number(dy) || 0;
  const x = Number(dx) || 0;
  const vy = Number(velocityY) || 0;
  const diff = -y;
  const absDiff = Math.abs(diff);
  const absX = Math.abs(x);
  const absVy = Math.abs(vy);

  if (absDiff <= absX * dominance) return 0;
  if (absDiff < flickTravelPx && absVy < velocityPx) return 0;

  if (diff > 0 && (absDiff >= distancePx || absVy >= velocityPx)) return 1;
  if (diff < 0 && (absDiff >= distancePx || absVy >= velocityPx)) return -1;
  return 0;
}
