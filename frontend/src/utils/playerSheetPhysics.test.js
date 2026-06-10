import {
  PLAYER_SHEET,
  applySheetDragResistance,
  choosePlayerSheetSnap,
  getPlayerSheetClosedY,
  progressToSheetY,
  rubberBandSheetY,
  shapeSheetSnapVelocity,
  shapeSheetVelocity,
  sheetYForPullDistance,
  yToSheetProgress,
} from './playerSheetPhysics';

describe('playerSheetPhysics', () => {
  it('maps sheet y and progress without layout state', () => {
    expect(getPlayerSheetClosedY(800)).toBe(684);
    expect(yToSheetProgress(684, 800)).toBe(0);
    expect(yToSheetProgress(0, 800)).toBe(1);
    expect(progressToSheetY(0.25, 800)).toBe(513);
  });

  it('rubber-bands beyond both sheet limits', () => {
    expect(rubberBandSheetY(-120, 800)).toBeGreaterThan(-120);
    expect(rubberBandSheetY(920, 800)).toBeLessThan(920);
    expect(rubberBandSheetY(920, 800)).toBeGreaterThan(684);
  });

  it('keeps opening drag attached and damps auxiliary resistance only', () => {
    expect(applySheetDragResistance(400, 800)).toBe(400);
    expect(applySheetDragResistance(720, 800)).toBeLessThan(720);
    expect(sheetYForPullDistance(596, 800)).toBe(88);
    expect(sheetYForPullDistance(684, 800)).toBe(PLAYER_SHEET.open);
    expect(sheetYForPullDistance(800, 800)).toBeLessThan(PLAYER_SHEET.open);
    expect(sheetYForPullDistance(920, 800)).toBeGreaterThan(-120);
  });

  it('shapes sheet velocity by target direction', () => {
    expect(shapeSheetVelocity(-3200, 'open')).toBeGreaterThan(-PLAYER_SHEET.openVelocityOutputMax);
    expect(shapeSheetVelocity(3200, 'close')).toBeLessThan(PLAYER_SHEET.closeVelocityOutputMax);
    expect(shapeSheetVelocity(1000, 'open')).toBe(180);
  });

  it('drops outward velocity at sheet boundaries during snap', () => {
    expect(shapeSheetSnapVelocity({ currentY: -8, targetY: PLAYER_SHEET.open, velocityY: -2200 })).toBe(0);
    expect(shapeSheetSnapVelocity({ currentY: 684, targetY: 684, velocityY: 2200 })).toBe(0);
    expect(shapeSheetSnapVelocity({ currentY: 80, targetY: PLAYER_SHEET.open, velocityY: -900 })).toBeLessThan(0);
  });

  it('snaps open by progress or upward velocity', () => {
    expect(choosePlayerSheetSnap({ y: 360, height: 800 })).toBe(PLAYER_SHEET.open);
    expect(choosePlayerSheetSnap({ y: 620, height: 800, velocityY: -900, travelY: -64 })).toBe(PLAYER_SHEET.open);
  });

  it('snaps closed by low progress or downward velocity', () => {
    expect(choosePlayerSheetSnap({ y: 620, height: 800 })).toBe(684);
    expect(choosePlayerSheetSnap({ y: 260, height: 800, velocityY: 900, travelY: 72 })).toBe(684);
  });
});
