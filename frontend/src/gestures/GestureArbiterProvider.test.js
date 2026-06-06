import { getGlobalGestureArbiter } from './GestureArbiterProvider';
import { GESTURE_SURFACE } from './gestureContracts';

describe('GestureArbiterProvider', () => {
  beforeEach(() => {
    getGlobalGestureArbiter().cancelOwner('test-reset');
  });

  it('tracks independent owners per pointerId', () => {
    const arbiter = getGlobalGestureArbiter();

    expect(arbiter.tryClaim({
      surfaceId: GESTURE_SURFACE.PLAYLIST_SCROLL,
      pointerId: 1,
      reason: 'test',
    })).toBe(true);
    expect(arbiter.tryClaim({
      surfaceId: GESTURE_SURFACE.PLAYER_SHEET,
      pointerId: 2,
      reason: 'test',
    })).toBe(true);

    expect(arbiter.getOwner(1).surfaceId).toBe(GESTURE_SURFACE.PLAYLIST_SCROLL);
    expect(arbiter.getOwner(2).surfaceId).toBe(GESTURE_SURFACE.PLAYER_SHEET);
    expect(arbiter.getActiveOwners()).toHaveLength(2);
  });

  it('rejects lower-priority owners on the same pointerId', () => {
    const arbiter = getGlobalGestureArbiter();

    expect(arbiter.tryClaim({
      surfaceId: GESTURE_SURFACE.SEEK,
      pointerId: 1,
      reason: 'test',
    })).toBe(true);
    expect(arbiter.tryClaim({
      surfaceId: GESTURE_SURFACE.MODAL_DISMISS,
      pointerId: 1,
      reason: 'test',
    })).toBe(false);
    expect(arbiter.getOwner(1).surfaceId).toBe(GESTURE_SURFACE.SEEK);
  });

  it('allows concurrent seek and cover on different pointerIds', () => {
    const arbiter = getGlobalGestureArbiter();

    expect(arbiter.tryClaim({
      surfaceId: GESTURE_SURFACE.PLAYER_SHEET,
      pointerId: 9,
      reason: 'pointer-down',
      exclusive: true,
    })).toBe(true);
    expect(arbiter.tryClaim({
      surfaceId: GESTURE_SURFACE.SEEK,
      pointerId: 9,
      reason: 'seek-pointer-down',
    })).toBe(false);
    expect(arbiter.tryClaim({
      surfaceId: GESTURE_SURFACE.COVER_STACK,
      pointerId: 10,
      reason: 'cover-intent',
    })).toBe(true);
    expect(arbiter.tryClaim({
      surfaceId: GESTURE_SURFACE.MINI_TRACK_SWIPE,
      pointerId: 9,
      reason: 'horizontal',
      allowSamePointerTransfer: true,
    })).toBe(true);
    expect(arbiter.getOwner(9).surfaceId).toBe(GESTURE_SURFACE.MINI_TRACK_SWIPE);
    expect(arbiter.getOwner(9).exclusive).toBe(true);
    expect(arbiter.getOwner(10).surfaceId).toBe(GESTURE_SURFACE.COVER_STACK);
  });

  it('releases only the requested pointer slot', () => {
    const arbiter = getGlobalGestureArbiter();

    arbiter.tryClaim({ surfaceId: GESTURE_SURFACE.SEEK, pointerId: 1, reason: 'test' });
    arbiter.tryClaim({ surfaceId: GESTURE_SURFACE.PLAYER_SHEET, pointerId: 2, reason: 'test' });

    arbiter.release({ surfaceId: GESTURE_SURFACE.SEEK, pointerId: 1, reason: 'test' });

    expect(arbiter.getOwner(1)).toBe(null);
    expect(arbiter.getOwner(2).surfaceId).toBe(GESTURE_SURFACE.PLAYER_SHEET);
  });

  it('releaseStaleMiniOwners clears leaked mini claims except the active pointer', () => {
    const arbiter = getGlobalGestureArbiter();

    arbiter.tryClaim({
      surfaceId: GESTURE_SURFACE.PLAYER_SHEET,
      pointerId: 7,
      reason: 'pointer-down',
      exclusive: true,
    });
    arbiter.tryClaim({
      surfaceId: GESTURE_SURFACE.MINI_TRACK_SWIPE,
      pointerId: 8,
      reason: 'pointer-down',
      exclusive: true,
    });

    expect(arbiter.hasExclusiveMiniPointer()).toBe(true);

    arbiter.releaseStaleMiniOwners(8, 'test');

    expect(arbiter.getOwner(7)).toBe(null);
    expect(arbiter.getOwner(8).surfaceId).toBe(GESTURE_SURFACE.MINI_TRACK_SWIPE);
    expect(arbiter.hasExclusiveMiniPointer(8)).toBe(true);
    expect(arbiter.hasExclusiveMiniPointer()).toBe(true);
  });
});
