import { useContext } from 'react';
import { PlayerStoreContext } from '../context/PlayerContext';
import { usePlayerStore } from './usePlayerStore';
import type { PlayerStore, PlayerStoreSnapshot } from '../player-core/PlayerStore';

export function usePlayerStoreSnapshot(): PlayerStoreSnapshot {
    const store = useContext(PlayerStoreContext) as PlayerStore | null;
    return usePlayerStore(store);
}
