import { GESTURE_SURFACE } from './gestureContracts';
import { evaluateGestureClaim } from './gestureDelegates';

describe('gestureDelegates', () => {
  it('does not block claims across different pointerIds at policy layer', () => {
    const verdict = evaluateGestureClaim({
      active: {
        pointerId: 1,
        surfaceId: GESTURE_SURFACE.SEEK,
        priority: 700,
        exclusive: false,
      },
      next: {
        pointerId: 2,
        surfaceId: GESTURE_SURFACE.COVER_STACK,
        priority: 440,
        allowSamePointerTransfer: false,
      },
    });
    expect(verdict.allowed).toBe(true);
  });

  it('blocks seek from replacing exclusive mini on same pointer', () => {
    const verdict = evaluateGestureClaim({
      active: {
        pointerId: 9,
        surfaceId: GESTURE_SURFACE.PLAYER_SHEET,
        priority: 600,
        exclusive: true,
      },
      next: {
        pointerId: 9,
        surfaceId: GESTURE_SURFACE.SEEK,
        priority: 700,
        allowSamePointerTransfer: false,
      },
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('mini-exclusive-blocked');
  });

  it('allows mini surface transfer on same pointer', () => {
    const verdict = evaluateGestureClaim({
      active: {
        pointerId: 9,
        surfaceId: GESTURE_SURFACE.PLAYER_SHEET,
        priority: 600,
        exclusive: true,
      },
      next: {
        pointerId: 9,
        surfaceId: GESTURE_SURFACE.MINI_TRACK_SWIPE,
        priority: 450,
        allowSamePointerTransfer: true,
      },
    });
    expect(verdict.allowed).toBe(true);
  });
});
