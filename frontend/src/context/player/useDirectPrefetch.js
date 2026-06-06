import { useEffect, useRef } from 'react';

function abortSafe(ctrl) {
    try { ctrl.abort(); } catch { }
}

export const useDirectPrefetch = ({
    apiClient,
    isAuthenticated,
    usePlaybackConnector,
    playbackEngine,
    currentTimeRef,
    duration,
    effectiveTracks,
    currentTrackIndex,
    repeatMode,
    isSeekingRef,
    switchingUntilRef,
}) => {
    const inFlightRef = useRef(null);
    const eagerTimerRef = useRef(null);
    const batchTimerRef = useRef(null);

    useEffect(() => {
        if (inFlightRef.current) {
            abortSafe(inFlightRef.current);
            inFlightRef.current = null;
        }
    }, [currentTrackIndex, effectiveTracks]);

    useEffect(() => {
        return () => {
            if (inFlightRef.current) {
                abortSafe(inFlightRef.current);
                inFlightRef.current = null;
            }
            if (eagerTimerRef.current) {
                clearTimeout(eagerTimerRef.current);
                eagerTimerRef.current = null;
            }
            if (batchTimerRef.current) {
                clearTimeout(batchTimerRef.current);
                batchTimerRef.current = null;
            }
        };
    }, []);

    void apiClient;
    void isAuthenticated;
    void usePlaybackConnector;
    void playbackEngine;
    void currentTimeRef;
    void duration;
    void repeatMode;
    void isSeekingRef;
    void switchingUntilRef;
};
