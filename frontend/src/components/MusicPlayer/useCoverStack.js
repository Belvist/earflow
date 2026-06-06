import { useMemo } from 'react';
import apiClient from '../../api/client';

export default function useCoverStack(tracks, currentTrackIndex) {
    const safeTracks = useMemo(() => {
        return Array.isArray(tracks) ? tracks : [];
    }, [tracks]);

    const idx = Number.isFinite(currentTrackIndex) ? currentTrackIndex : 0;

    return useMemo(() => {
        const len = safeTracks.length;
        const at = (offset) => {
            if (len < 1) return null;
            return safeTracks[(idx + offset) % len] || null;
        };

        const currentTrack = len > 0 ? (safeTracks[idx] || safeTracks[0] || null) : null;
        const track2 = at(1);
        const track3 = at(2);
        const track4 = at(3);
        const track5 = at(4);

        const coverUrls = {
            main: currentTrack ? apiClient.getCoverUrl(currentTrack, false) : null,
            layer2: track2 ? apiClient.getCoverUrl(track2, false) : null,
            layer3: track3 ? apiClient.getCoverUrl(track3, false) : null,
            layer4: track4 ? apiClient.getCoverUrl(track4, false) : null,
            layer5: track5 ? apiClient.getCoverUrl(track5, false) : null,
        };

        return {
            currentTrack,
            track2,
            track3,
            track4,
            track5,
            coverUrls,
        };
    }, [idx, safeTracks]);
}
