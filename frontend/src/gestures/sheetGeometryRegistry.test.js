import {
  getBottomSheetGeometry,
  getMobileChromeOffsetPx,
  getPlayerSheetGeometry,
  pickBottomSheetSnapTarget,
} from './sheetGeometryRegistry';

describe('sheetGeometryRegistry', () => {
  it('uses the same mobile chrome offset as the app shell', () => {
    expect(getMobileChromeOffsetPx()).toBe(92);
    expect(getPlayerSheetGeometry(800).closedY).toBe(684);
  });

  it('derives bottom sheet height and snap targets from one geometry snapshot', () => {
    const geometry = getBottomSheetGeometry({
      viewportHeight: 800,
      bottomOffsetPx: 114,
      topInsetPx: 12,
      snapPoints: [0.5, 0.9],
    });

    expect(geometry.sheetHeight).toBe(674);
    expect(geometry.snapYs).toEqual([337, 67]);
    expect(pickBottomSheetSnapTarget({
      currentY: 320,
      velocityY: 0,
      snapYs: geometry.snapYs,
      hiddenY: geometry.hiddenY,
    })).toEqual({ targetY: 337, close: false });
  });
});
