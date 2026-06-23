import { fallbackPeaksForTrack } from './trackWaveformPeaks';

describe('trackWaveformPeaks', () => {
  it('fallback peaks are stable per track id', () => {
    const a = fallbackPeaksForTrack({ id: 42, duration: 200 }, 64);
    const b = fallbackPeaksForTrack({ id: 42, duration: 200 }, 64);
    const c = fallbackPeaksForTrack({ id: 43, duration: 200 }, 64);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a).toHaveLength(64);
    a.forEach((p) => {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    });
  });
});
