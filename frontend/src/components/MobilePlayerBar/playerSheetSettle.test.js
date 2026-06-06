import {
  PLAYER_SHEET,
  choosePlayerSheetSnap,
  dragYFromMiniPull,
  getPlayerSheetClosedY,
  progressToSheetY,
  shouldSnapOpen,
  yToSheetProgress,
} from '../../utils/playerSheetPhysics';

/**
 * Regression: partial mini-bar swipe must snap open or closed — never leave
 * progress in (0.08, 0.92) without animation target.
 */
describe('player sheet settle decisions', () => {
  const height = 800;
  const closedY = getPlayerSheetClosedY(height);

  it('snaps open above progress threshold', () => {
    const y = progressToSheetY(0.5, height);
    expect(choosePlayerSheetSnap({ y, height })).toBe(PLAYER_SHEET.open);
    expect(yToSheetProgress(y, height)).toBeGreaterThanOrEqual(PLAYER_SHEET.snapOpenProgress);
  });

  it('snaps closed below progress threshold', () => {
    const y = progressToSheetY(0.2, height);
    expect(choosePlayerSheetSnap({ y, height, velocityY: 0, travelY: -20 })).toBe(closedY);
  });

  it('snaps open on fast upward flick from low progress', () => {
    const y = progressToSheetY(0.15, height);
    expect(choosePlayerSheetSnap({
      y,
      height,
      velocityY: -900,
      travelY: -80,
    })).toBe(PLAYER_SHEET.open);
  });

  it('snaps open on deliberate upward pull without fast flick velocity', () => {
    const y = progressToSheetY(0.22, height);
    expect(choosePlayerSheetSnap({
      y,
      height,
      velocityY: -420,
      travelY: -180,
    })).toBe(PLAYER_SHEET.open);
  });

  it('closed Y matches layout formula used during drag', () => {
    expect(closedY).toBeGreaterThan(PLAYER_SHEET.open);
    expect(yToSheetProgress(closedY, height)).toBe(0);
    expect(yToSheetProgress(0, height)).toBe(1);
  });

  it('dragYFromMiniPull moves up from closed anchor', () => {
    const y = dragYFromMiniPull(closedY, -120, height);
    expect(y).toBeLessThan(closedY);
    expect(y).toBeGreaterThanOrEqual(PLAYER_SHEET.open);
  });

  it('shouldSnapOpen delegates to choosePlayerSheetSnap', () => {
    const midY = progressToSheetY(0.5, height);
    expect(shouldSnapOpen({ y: midY, height, velocityY: 0, travelY: -60 })).toBe(true);
    expect(shouldSnapOpen({ y: progressToSheetY(0.2, height), height, velocityY: 0, travelY: -10 })).toBe(false);
  });
});
