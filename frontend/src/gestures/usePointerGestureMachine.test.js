import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { GESTURE_CAPTURE_POLICY, GESTURE_SURFACE } from './gestureContracts';
import { GESTURE_AXIS } from '../utils/gestureIntent';
import { GESTURE_PROFILE } from './gestureProfiles';
import { getGlobalGestureArbiter } from './GestureArbiterProvider';
import { usePointerGestureMachine } from './usePointerGestureMachine';

function TestSurface({ onIntent, onScrollIntent, shouldActivate }) {
  const { handlers } = usePointerGestureMachine({
    surfaceId: GESTURE_SURFACE.PLAYER_SHEET,
    profileId: GESTURE_PROFILE.MINI_PLAYER_OPEN,
    shouldActivate,
    onIntent,
    onScrollIntent,
  });

  return (
    <div
      data-testid="surface"
      {...handlers}
    />
  );
}

function DynamicSurface({ onIntent }) {
  const { handlers } = usePointerGestureMachine({
    surfaceId: GESTURE_SURFACE.PLAYER_SHEET,
    profileId: GESTURE_PROFILE.MINI_PLAYER_OPEN,
    getSurfaceIdForIntent: ({ intent }) => (
      intent === 'horizontal' ? GESTURE_SURFACE.MINI_TRACK_SWIPE : GESTURE_SURFACE.PLAYER_SHEET
    ),
    onIntent,
  });

  return (
    <div
      data-testid="dynamic-surface"
      {...handlers}
    />
  );
}

function TrackingSurface({ onTrackingMove }) {
  const { handlers } = usePointerGestureMachine({
    surfaceId: GESTURE_SURFACE.PLAYER_SHEET,
    profileId: GESTURE_PROFILE.MINI_PLAYER_OPEN,
    capturePolicy: GESTURE_CAPTURE_POLICY.IMMEDIATE,
    intentPx: 12,
    onTrackingMove,
  });

  return (
    <div
      data-testid="tracking-surface"
      {...handlers}
    />
  );
}

function ClaimOnDownSurface() {
  const { handlers } = usePointerGestureMachine({
    surfaceId: GESTURE_SURFACE.PLAYER_SHEET,
    profileId: GESTURE_PROFILE.MINI_PLAYER_OPEN,
    capturePolicy: GESTURE_CAPTURE_POLICY.IMMEDIATE,
    claimOnPointerDown: true,
  });

  return (
    <div
      data-testid="claim-on-down-surface"
      {...handlers}
    />
  );
}

function pointer(surface, type, props) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: props.clientX,
    clientY: props.clientY,
    button: 0,
  });
  Object.defineProperties(event, {
    pointerId: { value: props.pointerId, enumerable: true },
    pointerType: { value: 'touch', enumerable: true },
    isPrimary: { value: true, enumerable: true },
  });
  fireEvent(surface, event);
}

describe('usePointerGestureMachine', () => {
  beforeEach(() => {
    getGlobalGestureArbiter().cancelOwner('test-reset');
  });

  it('locks intent before claiming ownership', () => {
    const onIntent = jest.fn();
    const { getByTestId } = render(<TestSurface onIntent={onIntent} />);
    const surface = getByTestId('surface');

    pointer(surface, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 500 });
    expect(getGlobalGestureArbiter().getOwner(1)).toBe(null);

    pointer(surface, 'pointermove', { pointerId: 1, clientX: 112, clientY: 470 });
    expect(onIntent).toHaveBeenCalledTimes(1);
    expect(getGlobalGestureArbiter().getOwner(1).surfaceId).toBe(GESTURE_SURFACE.PLAYER_SHEET);
  });

  it('does not release mini-bar downward travel to page scroll (INV-SHEET-007)', () => {
    const onScrollIntent = jest.fn();
    const onIntent = jest.fn();
    const { getByTestId } = render(<TestSurface onScrollIntent={onScrollIntent} onIntent={onIntent} />);
    const surface = getByTestId('surface');

    pointer(surface, 'pointerdown', { pointerId: 2, clientX: 100, clientY: 500 });
    pointer(surface, 'pointermove', { pointerId: 2, clientX: 108, clientY: 552 });

    expect(onScrollIntent).not.toHaveBeenCalled();
    expect(onIntent).not.toHaveBeenCalled();
    expect(getGlobalGestureArbiter().getOwner(2)).toBe(null);
  });

  it('does not claim ownership when activation gates reject the gesture', () => {
    const onIntent = jest.fn();
    const { getByTestId } = render(<TestSurface onIntent={onIntent} shouldActivate={() => false} />);
    const surface = getByTestId('surface');

    pointer(surface, 'pointerdown', { pointerId: 3, clientX: 100, clientY: 500 });
    pointer(surface, 'pointermove', { pointerId: 3, clientX: 100, clientY: 450 });

    expect(onIntent).not.toHaveBeenCalled();
    expect(getGlobalGestureArbiter().getOwner(3)).toBe(null);
  });

  it('can choose the active owner after intent classification', () => {
    const onIntent = jest.fn();
    const { getByTestId } = render(<DynamicSurface onIntent={onIntent} />);
    const surface = getByTestId('dynamic-surface');

    pointer(surface, 'pointerdown', { pointerId: 4, clientX: 100, clientY: 500 });
    pointer(surface, 'pointermove', { pointerId: 4, clientX: 180, clientY: 492 });

    expect(onIntent).toHaveBeenCalledTimes(1);
    expect(getGlobalGestureArbiter().getOwner(4).surfaceId).toBe(GESTURE_SURFACE.MINI_TRACK_SWIPE);
  });

  it('locks horizontal intent once mini-bar travel is clearly on X', () => {
    const onIntent = jest.fn();
    const onScrollIntent = jest.fn();
    const { getByTestId } = render(<TestSurface onIntent={onIntent} onScrollIntent={onScrollIntent} />);
    const surface = getByTestId('surface');

    pointer(surface, 'pointerdown', { pointerId: 6, clientX: 100, clientY: 500 });
    pointer(surface, 'pointermove', { pointerId: 6, clientX: 118, clientY: 498 });

    expect(onIntent).toHaveBeenCalledTimes(1);
    expect(onIntent.mock.calls[0][0].intent).toBe(GESTURE_AXIS.HORIZONTAL);
    expect(onScrollIntent).not.toHaveBeenCalled();
    expect(getGlobalGestureArbiter().getOwner(6).surfaceId).toBe(GESTURE_SURFACE.PLAYER_SHEET);
  });

  it('supports immediate pointer capture and pre-intent tracking moves', () => {
    const onTrackingMove = jest.fn();
    const { getByTestId } = render(<TrackingSurface onTrackingMove={onTrackingMove} />);
    const surface = getByTestId('tracking-surface');
    surface.setPointerCapture = jest.fn();

    pointer(surface, 'pointerdown', { pointerId: 5, clientX: 100, clientY: 500 });
    pointer(surface, 'pointermove', { pointerId: 5, clientX: 101, clientY: 496 });

    expect(surface.setPointerCapture).toHaveBeenCalledWith(5);
    expect(onTrackingMove).toHaveBeenCalledTimes(1);
    expect(getGlobalGestureArbiter().getOwner(5)).toBe(null);
  });

  it('can own a captured surface from pointerdown until pointerup', () => {
    const { getByTestId } = render(<ClaimOnDownSurface />);
    const surface = getByTestId('claim-on-down-surface');
    surface.setPointerCapture = jest.fn();
    surface.releasePointerCapture = jest.fn();

    pointer(surface, 'pointerdown', { pointerId: 7, clientX: 100, clientY: 500 });

    expect(surface.setPointerCapture).toHaveBeenCalledWith(7);
    expect(getGlobalGestureArbiter().getOwner(7).surfaceId).toBe(GESTURE_SURFACE.PLAYER_SHEET);

    pointer(surface, 'pointerup', { pointerId: 7, clientX: 100, clientY: 500 });

    expect(surface.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(getGlobalGestureArbiter().getOwner(7)).toBe(null);
  });
});
