'use strict';

/**
 * Resample stored peaks to client bar count (linear interpolation).
 * @param {number[]} source
 * @param {number} targetCount
 * @returns {number[]}
 */
function resamplePeaks(source, targetCount) {
  const src = Array.isArray(source) ? source : [];
  const count = Math.max(1, Math.min(512, Number(targetCount) || 128));
  if (!src.length) return [];
  if (src.length === count) return src.slice();

  const out = [];
  for (let i = 0; i < count; i += 1) {
    const t = (i / Math.max(1, count - 1)) * (src.length - 1);
    const i0 = Math.floor(t);
    const i1 = Math.min(src.length - 1, i0 + 1);
    const f = t - i0;
    out.push(src[i0] * (1 - f) + src[i1] * f);
  }
  return out;
}

/**
 * @param {unknown} raw jsonb from DB
 * @returns {number[]|null}
 */
function parseStoredPeaks(raw) {
  if (Array.isArray(raw)) {
    return raw.filter((n) => Number.isFinite(Number(n))).map((n) => Number(n));
  }
  if (raw && typeof raw === 'object' && Array.isArray(raw.peaks)) {
    return raw.peaks.filter((n) => Number.isFinite(Number(n))).map((n) => Number(n));
  }
  return null;
}

module.exports = { resamplePeaks, parseStoredPeaks };
