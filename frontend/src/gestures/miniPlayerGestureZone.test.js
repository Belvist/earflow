import { GESTURE_SURFACE } from './gestureContracts';
import {
  isPointerInMiniPlayerGestureZone,
  shouldDeferToMiniPlayerGesture,
} from './miniPlayerGestureZone';

describe('miniPlayerGestureZone', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('detects touches inside the mini gesture zone', () => {
    const bar = document.createElement('div');
    bar.setAttribute('data-mini-gesture-zone', 'true');
    bar.getBoundingClientRect = () => ({
      left: 10,
      right: 310,
      top: 700,
      bottom: 760,
      width: 300,
      height: 60,
    });
    document.body.appendChild(bar);

    expect(isPointerInMiniPlayerGestureZone({
      clientX: 120,
      clientY: 730,
      target: bar,
    })).toBe(true);
    expect(isPointerInMiniPlayerGestureZone({
      clientX: 120,
      clientY: 500,
      target: document.body,
    })).toBe(false);
  });

  it('defers non-mini surfaces when the pointer is in the mini zone', () => {
    const bar = document.createElement('div');
    bar.setAttribute('data-mini-gesture-zone', 'true');
    document.body.appendChild(bar);

    expect(shouldDeferToMiniPlayerGesture({
      surfaceId: GESTURE_SURFACE.COVER_STACK,
      clientX: 40,
      clientY: 20,
      target: bar,
      pointerId: 3,
    })).toBe(true);
    expect(shouldDeferToMiniPlayerGesture({
      surfaceId: GESTURE_SURFACE.PLAYER_SHEET,
      clientX: 40,
      clientY: 20,
      target: bar,
      pointerId: 3,
    })).toBe(false);
  });
});
