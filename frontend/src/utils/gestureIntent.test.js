import {
  GESTURE_AXIS,
  IOS_GESTURE,
  classifyAxisIntent,
  classifyMiniBarSheetIntent,
  classifyMiniPlayerOpenIntent,
  shouldCommitHorizontalSwipe,
  shouldCommitVerticalDismiss,
  shouldCommitVerticalSheetDetent,
} from './gestureIntent';

describe('gestureIntent', () => {
  it('keeps vertical scroll separate from horizontal swipe', () => {
    expect(classifyAxisIntent({ dx: 18, dy: 64 })).toBe(GESTURE_AXIS.VERTICAL);
    expect(classifyAxisIntent({ dx: 64, dy: 18 })).toBe(GESTURE_AXIS.HORIZONTAL);
    expect(classifyAxisIntent({ dx: 32, dy: 28 })).toBe(GESTURE_AXIS.SCROLL);
  });

  it('does not commit diagonal swipes; velocity flicks commit with short travel', () => {
    expect(shouldCommitHorizontalSwipe({ dx: 72, dy: 58, velocityX: 900 })).toBe(0);
    expect(shouldCommitHorizontalSwipe({ dx: 16, dy: 2, velocityX: 1200 })).toBe(1);
    expect(shouldCommitHorizontalSwipe({ dx: 6, dy: 1, velocityX: 1400 })).toBe(0);
  });

  it('prioritizes upward mini-player opens over playlist-like diagonal swipes', () => {
    expect(classifyMiniPlayerOpenIntent({ dx: 42, dy: -34, scrollY: 900, maxScrollY: 900 })).toBe(GESTURE_AXIS.VERTICAL);
    expect(classifyMiniPlayerOpenIntent({ dx: 96, dy: -18 })).toBe(GESTURE_AXIS.HORIZONTAL);
    expect(classifyMiniPlayerOpenIntent({ dx: 24, dy: 28 })).toBe(null);
    expect(classifyMiniPlayerOpenIntent({ dx: 24, dy: 52 })).toBe(GESTURE_AXIS.SCROLL);
    expect(classifyMiniPlayerOpenIntent({ dx: 18, dy: 0 })).toBe(null);
    expect(classifyMiniPlayerOpenIntent({ dx: 36, dy: 4 })).toBe(GESTURE_AXIS.HORIZONTAL);
    expect(classifyMiniPlayerOpenIntent({ dx: 20, dy: 80 })).toBe(GESTURE_AXIS.SCROLL);
  });

  it('mini-bar sheet intent ignores page scroll (touch-action none surface)', () => {
    expect(classifyMiniBarSheetIntent({
      dx: 4,
      dy: 24,
    })).not.toBe(GESTURE_AXIS.SCROLL);
    expect(classifyMiniBarSheetIntent({
      dx: 4,
      dy: -24,
    })).toBe(GESTURE_AXIS.VERTICAL);
    expect(classifyMiniBarSheetIntent({ dx: 4, dy: 60 })).toBe(null);
    expect(classifyMiniBarSheetIntent({ dx: 80, dy: 8 })).toBe(GESTURE_AXIS.HORIZONTAL);
  });

  it('mini-bar direction lock prefers dominant axis at commit', () => {
    expect(classifyMiniBarSheetIntent({ dx: 20, dy: -40 })).toBe(GESTURE_AXIS.VERTICAL);
    expect(classifyMiniBarSheetIntent({ dx: 72, dy: -12 })).toBe(GESTURE_AXIS.HORIZONTAL);
    expect(classifyMiniBarSheetIntent({ dx: 8, dy: -8 })).toBe(null);
  });

  it('prefers page scroll over short mini-bar pulls when the page can still move', () => {
    expect(classifyMiniPlayerOpenIntent({
      dx: 4,
      dy: -24,
      scrollY: 120,
      maxScrollY: 900,
    })).toBe(null);
    expect(classifyMiniPlayerOpenIntent({
      dx: 4,
      dy: 24,
      scrollY: 120,
      maxScrollY: 900,
    })).toBe(GESTURE_AXIS.SCROLL);
    expect(classifyMiniPlayerOpenIntent({
      dx: 4,
      dy: -52,
      scrollY: 120,
      maxScrollY: 900,
    })).toBe(GESTURE_AXIS.VERTICAL);
    expect(classifyMiniPlayerOpenIntent({
      dx: 4,
      dy: -24,
      scrollY: 894,
      maxScrollY: 900,
    })).toBe(GESTURE_AXIS.VERTICAL);
  });

  it('commits deliberate horizontal swipes by distance or velocity', () => {
    expect(shouldCommitHorizontalSwipe({ dx: -IOS_GESTURE.swipeDistancePx, dy: 8, velocityX: 0 })).toBe(-1);
    expect(shouldCommitHorizontalSwipe({ dx: 36, dy: 4, velocityX: IOS_GESTURE.swipeVelocityPx + 20 })).toBe(1);
  });

  it('commits only downward dismiss gestures', () => {
    expect(shouldCommitVerticalDismiss({ dy: IOS_GESTURE.dismissDistancePx, velocityY: 0 })).toBe(true);
    expect(shouldCommitVerticalDismiss({ dy: 32, velocityY: IOS_GESTURE.dismissVelocityPx + 20 })).toBe(true);
    expect(shouldCommitVerticalDismiss({ dy: -160, velocityY: 1200 })).toBe(false);
  });

  it('commits queue sheet detents by distance or upward/downward flick', () => {
    expect(shouldCommitVerticalSheetDetent({ dy: -IOS_GESTURE.sheetDetentPx, dx: 2 })).toBe(1);
    expect(shouldCommitVerticalSheetDetent({ dy: IOS_GESTURE.sheetDetentPx, dx: 2 })).toBe(-1);
    expect(shouldCommitVerticalSheetDetent({ dy: -20, dx: 0, velocityY: -IOS_GESTURE.sheetDetentVelocityPx - 40 })).toBe(1);
    expect(shouldCommitVerticalSheetDetent({ dy: -8, dx: 0, velocityY: -120 })).toBe(0);
  });
});
