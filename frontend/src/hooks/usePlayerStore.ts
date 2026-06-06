import { useSyncExternalStore } from 'react';
import type { PlayerStore, PlayerStoreSnapshot } from '../player-core/PlayerStore';

const EMPTY_SNAPSHOT: PlayerStoreSnapshot = {
    isPlaying: false,
    isBuffering: false,
    isSeeking: false,
    currentTrackIndex: 0,
    currentTime: 0,
    duration: 0,
    fsmState: 'IDLE',
    volume: 1,
    playbackRate: 1,
    preservePitch: true,
    eqEnabled: false,
    eqGains: Object.freeze([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    repeatMode: 'all',
    shuffleEnabled: false,
    queueSource: 'auto',
    queueName: '',
    playbackEngine: 'legacy',
    lastErrorCode: null,
};

export function usePlayerStore(store: PlayerStore | null): PlayerStoreSnapshot {
    return useSyncExternalStore(
        (listener) => store ? store.subscribe(listener) : () => { },
        () => store ? store.getSnapshot() : EMPTY_SNAPSHOT,
        () => store ? store.getSnapshot() : EMPTY_SNAPSHOT,
    );
}
