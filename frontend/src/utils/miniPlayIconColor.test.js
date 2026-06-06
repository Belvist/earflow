import { miniPlayIconColor } from './miniPlayIconColor';

describe('miniPlayIconColor', () => {
  it('returns light icon on dark background', () => {
    expect(miniPlayIconColor('rgba(18, 12, 14, 0.96)')).toBe('rgba(255, 255, 255, 0.94)');
  });

  it('returns dark icon on light background', () => {
    expect(miniPlayIconColor('rgba(240, 240, 240, 1)')).toBe('rgba(18, 18, 18, 0.92)');
  });

  it('falls back to light icon when background unknown', () => {
    expect(miniPlayIconColor(null)).toBe('rgba(255, 255, 255, 0.94)');
  });
});
