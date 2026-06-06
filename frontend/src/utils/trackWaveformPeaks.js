/**
 * Decorative hero waveform fallback when API peaks are pending/unavailable.
 * Real peaks: GET /api/songs/:id/waveform (transcode-worker → database-service).
 */

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Stable placeholder per track (DECISIONS: decorative waveform, not client decode). */
export function fallbackPeaksForTrack(track, barCount = 128) {
  const id = track?.id ?? track?.song_id ?? '';
  const dur = Number(track?.duration) || 0;
  const seed = hashSeed(`${id}:${dur}`);
  const out = [];
  for (let i = 0; i < barCount; i += 1) {
    const t = (seed + i * 2654435761) >>> 0;
    const n1 = (t % 1000) / 1000;
    const n2 = ((t >>> 10) % 1000) / 1000;
    const h = 0.18 + 0.82 * Math.max(n1, n2 * 0.85);
    out.push(h);
  }
  return out;
}
