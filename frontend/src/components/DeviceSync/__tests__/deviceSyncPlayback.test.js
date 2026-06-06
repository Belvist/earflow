import {
    buildSilentShadowSnapshot,
    estimateRemotePositionSec,
    getServerActiveDeviceId,
    isSelfActiveDevice,
    planSilentShadowReconciliation,
    persistPlaybackResumePoint,
    readPlayerDurationSec,
    readPlayerPositionSec,
    readTimelineIsPlaying,
    resolveAuthoritativePlayback,
} from '../deviceSyncPlayback';

describe('device sync playback helpers', () => {
    test('estimates active remote position from authoritative updatedAtMs', () => {
        const nowPlaying = {
            positionSec: 10,
            durationSec: 60,
            isPlaying: true,
            updatedAtMs: 1_000,
        };

        expect(estimateRemotePositionSec(nowPlaying, 3_500)).toBe(12.5);
    });

    test('clamps estimated remote position to duration', () => {
        const nowPlaying = {
            positionSec: 58,
            durationSec: 60,
            isPlaying: true,
            updatedAtMs: 1_000,
        };

        expect(estimateRemotePositionSec(nowPlaying, 10_000)).toBe(60);
    });

    test('reads global timeline play state', () => {
        expect(readTimelineIsPlaying({ isPlaying: true })).toBe(true);
        expect(readTimelineIsPlaying({ isPlaying: false })).toBe(false);
        expect(readTimelineIsPlaying(null)).toBe(false);
    });

    test('prefers fresher authoritative playback snapshot', () => {
        const timeline = { trackId: 'a', stateRevision: 3, updatedAtMs: 1000, positionSec: 10 };
        const nowPlaying = { trackId: 'a', stateRevision: 5, updatedAtMs: 2000, positionSec: 40 };
        expect(resolveAuthoritativePlayback(timeline, nowPlaying)).toMatchObject({
            stateRevision: 5,
            positionSec: 40,
        });
    });

    test('builds a silent snapshot without mutating active server intent', () => {
        const snapshot = buildSilentShadowSnapshot({
            trackId: ' 42 ',
            positionSec: 5,
            durationSec: 30,
            isPlaying: true,
            updatedAtMs: 1_000,
        }, 2_000);

        expect(snapshot).toMatchObject({
            trackId: '42',
            isPlaying: false,
            positionSec: 6,
        });
    });

    test('reads current position and duration from player refs before formatted labels', () => {
        expect(readPlayerPositionSec({
            getCurrentPositionMs: () => 12_345,
            currentTimeRef: { current: 3 },
        })).toBe(12.345);

        expect(readPlayerDurationSec({
            durationRaw: 234,
            duration: '3:54',
        })).toBe(234);
    });

    test('detects active device from nowPlaying and device list', () => {
        expect(isSelfActiveDevice('self', [], { deviceId: 'self' })).toBe(true);
        expect(isSelfActiveDevice('self', [{ id: 'self', isActive: true }], null)).toBe(true);
        expect(isSelfActiveDevice('self', [{ id: 'other', isActive: true }], { deviceId: 'other' })).toBe(false);
        expect(isSelfActiveDevice('self', [{ id: 'other', isActive: true }], { deviceId: 'self' })).toBe(false);
        expect(getServerActiveDeviceId([{ id: 'other', isActive: true }], { deviceId: 'self' })).toBe('other');
        expect(getServerActiveDeviceId([{ id: 'other', isActive: true }], { deviceId: 'other' }, {
            holderDeviceId: 'lease-holder',
        })).toBe('lease-holder');
        expect(isSelfActiveDevice('self', [{ id: 'other', isActive: true }], { deviceId: 'other' }, {
            holderDeviceId: 'self',
        })).toBe(true);
    });

    test('persists resume point with millisecond precision', () => {
        const calls = new Map();
        const storage = {
            setItem: (key, value) => calls.set(key, value),
        };

        persistPlaybackResumePoint('track-a', 9.87654, storage);

        expect(calls.get('lastTrackId')).toBe('track-a');
        expect(calls.get('lastPositionSeconds')).toBe('9.876');
    });

    test('plans deterministic silent shadow reconciliation for drifted local sink', () => {
        const plan = planSilentShadowReconciliation({
            snapshot: {
                trackId: 'track-a',
                positionSec: 21,
                durationSec: 120,
                stateRevision: 5,
            },
            localTrackId: 'track-a',
            localPositionSec: 12,
            previousTrackId: 'track-a',
            previousRevision: 'rev:4',
            revision: 'rev:5',
        });

        expect(plan).toMatchObject({
            trackId: 'track-a',
            revision: 'rev:5',
            remotePositionSec: 21,
            shouldApplyTrack: false,
            shouldProjectPosition: true,
            shouldSeekLocalSink: true,
        });
    });

    test('does not reproject position on revision-only heartbeat', () => {
        const plan = planSilentShadowReconciliation({
            snapshot: { trackId: 'track-a', positionSec: 21, durationSec: 120, stateRevision: 6 },
            localTrackId: 'track-a',
            localPositionSec: 20.5,
            previousTrackId: 'track-a',
            previousRevision: 'rev:5',
            revision: 'rev:6',
        });

        expect(plan).toMatchObject({
            shouldApplyTrack: false,
            shouldProjectPosition: false,
            shouldSeekLocalSink: false,
        });
    });

    test('plans track apply when passive shadow receives a new track', () => {
        const plan = planSilentShadowReconciliation({
            snapshot: { trackId: 'track-b', positionSec: 3, durationSec: 60, stateRevision: 6 },
            localTrackId: 'track-a',
            localPositionSec: 3,
            previousTrackId: 'track-a',
            previousRevision: 'rev:5',
        });

        expect(plan).toMatchObject({
            trackId: 'track-b',
            shouldApplyTrack: true,
            shouldProjectPosition: true,
            shouldSeekLocalSink: false,
        });
    });
});
