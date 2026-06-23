import {
    readActiveRevision,
    readNowPlayingRevision,
    readNowPlayingUpdatedAt,
} from '../deviceSyncRevisionGuard';

describe('device sync revision guard', () => {
    test('reads active revisions as positive integers', () => {
        expect(readActiveRevision('7')).toBe(7);
        expect(readActiveRevision(7.9)).toBe(7);
        expect(readActiveRevision(0)).toBe(0);
        expect(readActiveRevision('bad')).toBe(0);
    });

    test('reads nowPlaying revision', () => {
        expect(readNowPlayingRevision({ stateRevision: 5 })).toBe(5);
        expect(readNowPlayingRevision({ stateRevision: 0 })).toBe(0);
        expect(readNowPlayingRevision(null)).toBe(0);
    });

    test('reads nowPlaying updatedAt timestamp', () => {
        expect(readNowPlayingUpdatedAt({ updatedAtMs: 5_000 })).toBe(5_000);
        expect(readNowPlayingUpdatedAt({ updatedAtMs: 0 })).toBe(0);
        expect(readNowPlayingUpdatedAt(null)).toBe(0);
    });
});
