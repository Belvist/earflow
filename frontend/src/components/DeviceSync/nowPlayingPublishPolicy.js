export const POSITION_DRIFT_PUSH_SEC = 2;

function asFiniteNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function expectedPositionSec(last, nowMs) {
    if (!last || !last.lastAtMs) return null;
    const base = asFiniteNumber(last.lastPositionSec, NaN);
    if (!Number.isFinite(base)) return null;
    if (last.lastIsPlaying !== true) return base;
    const elapsedSec = Math.max(0, (asFiniteNumber(nowMs) - asFiniteNumber(last.lastAtMs)) / 1000);
    return base + elapsedSec;
}

/**
 * Event-driven publish policy (Spotify Connect-like). The active device only
 * announces its now-playing snapshot on real events:
 *   - track change
 *   - play/pause toggle
 *   - position drift over POSITION_DRIFT_PUSH_SEC (covers user-initiated seek
 *     until seek becomes a server-side intent)
 *
 * No periodic "still-here" pushes: idle position is extrapolated on every
 * receiver from `serverPositionSec + (now - serverUpdatedAtMs)` while
 * `isPlaying` is true. This drops the per-active-device 4s/30s push storm.
 */
export function shouldPublishNowPlayingSnapshot(last, snapshot, nowMs = Date.now()) {
    if (!snapshot || !snapshot.trackId) return false;

    const previous = last || {};
    const trackChanged = previous.lastTrackId !== snapshot.trackId;
    const playStateChanged = previous.lastIsPlaying !== snapshot.isPlaying;
    if (trackChanged || playStateChanged) return true;

    const expected = expectedPositionSec(previous, nowMs);
    if (expected === null) return false;
    const actual = Math.max(0, asFiniteNumber(snapshot.positionSec, 0));
    return Math.abs(actual - expected) >= POSITION_DRIFT_PUSH_SEC;
}

export function markNowPlayingSnapshotPublished(last, snapshot, nowMs = Date.now()) {
    if (!last || !snapshot) return;
    last.lastAtMs = nowMs;
    last.lastTrackId = snapshot.trackId;
    last.lastIsPlaying = snapshot.isPlaying;
    last.lastPositionSec = Math.max(0, asFiniteNumber(snapshot.positionSec, 0));
}
