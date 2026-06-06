import {
    POSITION_DRIFT_PUSH_SEC,
    markNowPlayingSnapshotPublished,
    shouldPublishNowPlayingSnapshot,
} from '../nowPlayingPublishPolicy';

describe('now-playing publish policy', () => {
    const baseSnapshot = {
        trackId: 'track-1',
        isPlaying: true,
        positionSec: 10,
    };

    test('publishes first snapshot and stores publish metadata without owning state revision', () => {
        const last = {
            lastAtMs: 0,
            lastTrackId: null,
            lastIsPlaying: null,
            lastPositionSec: -1,
        };

        expect(shouldPublishNowPlayingSnapshot(last, baseSnapshot, 1_000)).toBe(true);
        markNowPlayingSnapshotPublished(last, baseSnapshot, 1_000);
        expect(last).toMatchObject({
            lastAtMs: 1_000,
            lastTrackId: 'track-1',
            lastIsPlaying: true,
            lastPositionSec: 10,
        });
    });

    test('does not treat normal playback progress as a jump', () => {
        const last = {
            lastAtMs: 1_000,
            lastTrackId: 'track-1',
            lastIsPlaying: true,
            lastPositionSec: 10,
        };

        expect(shouldPublishNowPlayingSnapshot(last, {
            ...baseSnapshot,
            positionSec: 12,
        }, 3_000)).toBe(false);
    });

    test('does not publish for steady playback without an event or drift (no periodic push)', () => {
        const last = {
            lastAtMs: 1_000,
            lastTrackId: 'track-1',
            lastIsPlaying: true,
            lastPositionSec: 10,
        };

        const oneHour = 60 * 60 * 1_000;
        expect(shouldPublishNowPlayingSnapshot(last, {
            ...baseSnapshot,
            positionSec: 10 + oneHour / 1000,
        }, 1_000 + oneHour)).toBe(false);
    });

    test('publishes real seek drift before the periodic checkpoint', () => {
        const last = {
            lastAtMs: 1_000,
            lastTrackId: 'track-1',
            lastIsPlaying: true,
            lastPositionSec: 10,
        };

        expect(shouldPublishNowPlayingSnapshot(last, {
            ...baseSnapshot,
            positionSec: 10 + POSITION_DRIFT_PUSH_SEC + 5,
        }, 2_000)).toBe(true);
    });

    test('publishes pause event immediately and stays silent while paused without further events', () => {
        const last = {
            lastAtMs: 1_000,
            lastTrackId: 'track-1',
            lastIsPlaying: true,
            lastPositionSec: 10,
        };

        const pausedSnapshot = {
            ...baseSnapshot,
            isPlaying: false,
            positionSec: 11,
        };

        expect(shouldPublishNowPlayingSnapshot(last, pausedSnapshot, 2_000)).toBe(true);

        markNowPlayingSnapshotPublished(last, pausedSnapshot, 2_000);

        const oneHour = 60 * 60 * 1_000;
        expect(shouldPublishNowPlayingSnapshot(last, pausedSnapshot, 2_000 + oneHour)).toBe(false);
    });
});
