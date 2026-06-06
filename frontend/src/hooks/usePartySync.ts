import { useSyncExternalStore } from 'react';
import type { PartySync, PartySyncSnapshot } from '../player-core/PartySync';

const EMPTY: PartySyncSnapshot = {
    connectionState: 'disconnected',
    party: null,
    isHost: false,
    userId: null,
    playback: {
        trackId: null,
        trackTitle: null,
        trackArtist: null,
        trackCover: null,
        trackDuration: 0,
        isPlaying: false,
        position: 0,
        serverTimestamp: 0,
        stateRevision: 0,
    },
    participants: [],
    participantCount: 0,
    queue: [],
    permissions: {
        guestsCanChangePlayback: false,
        guestsCanAddToQueue: true,
        guestsCanSkip: false,
        guestsCanRemoveFromQueue: false,
    },
    error: null,
};

export function usePartySync(sync: PartySync | null): PartySyncSnapshot {
    return useSyncExternalStore(
        (listener) => sync ? sync.subscribe(listener) : () => {},
        () => sync ? sync.getSnapshot() : EMPTY,
        () => sync ? sync.getSnapshot() : EMPTY,
    );
}
