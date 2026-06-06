import { useCallback, useState } from 'react';

/**
 * @description Pure state holder for party mode.
 * All sync logic lives in usePartyPlaybackBridge.
 * This hook only provides the partyMode/partyInfo state
 * and enter/exit/playTrack actions consumed by PlayerContext.
 */
export const usePartyManager = (state, { playTrackById }) => {
    const { audioRef, setIsPlaying } = state;
    const [partyMode, setPartyMode] = useState(false);
    const [partyInfo, setPartyInfo] = useState(null);

    const enterPartyMode = useCallback((partyId, isHost) => {
        setPartyMode(true);
        setPartyInfo({ partyId, isHost });
        if (!isHost) {
            audioRef.current?.pause();
            setIsPlaying(false);
        }
    }, [audioRef, setIsPlaying]);

    const exitPartyMode = useCallback(() => {
        const wasHost = !!partyInfo?.isHost;
        setPartyMode(false);
        setPartyInfo(null);
        if (!wasHost) {
            audioRef.current?.pause();
            setIsPlaying(false);
        }
    }, [audioRef, partyInfo?.isHost, setIsPlaying]);

    const playPartyTrack = useCallback((track) => {
        if (!partyMode || !partyInfo?.isHost || !track?.id) return false;
        return playTrackById(track.id, true);
    }, [partyMode, partyInfo, playTrackById]);

    return {
        partyMode,
        partyInfo,
        enterPartyMode,
        exitPartyMode,
        playPartyTrack
    };
};
