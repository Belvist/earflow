import { renderHook } from '@testing-library/react';
import { getGlobalGestureArbiter } from './GestureArbiterProvider';
import { GESTURE_SURFACE } from './gestureContracts';
import { useExclusiveMiniTouchMoveGuard } from './useMiniPlayerNativeTouchGuard';

describe('useMiniPlayerNativeTouchGuard', () => {
  beforeEach(() => {
    getGlobalGestureArbiter().cancelOwner('test-reset');
  });

  it('blocks touchmove while an exclusive mini pointer is active', () => {
    renderHook(() => useExclusiveMiniTouchMoveGuard());

    const preventDefault = jest.fn();
    const event = new Event('touchmove', { cancelable: true });
    event.preventDefault = preventDefault;

    document.dispatchEvent(event);
    expect(preventDefault).not.toHaveBeenCalled();

    getGlobalGestureArbiter().tryClaim({
      surfaceId: GESTURE_SURFACE.PLAYER_SHEET,
      pointerId: 42,
      reason: 'pointer-down',
      exclusive: true,
    });

    document.dispatchEvent(event);
    expect(preventDefault).toHaveBeenCalled();
  });
});
