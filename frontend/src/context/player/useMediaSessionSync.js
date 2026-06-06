import { useEffect, useRef } from 'react';

function setPlaybackState(value) {
    try {
        if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
        const v = value === 'playing' || value === 'paused' || value === 'none' ? value : null;
        if (!v) return;
        navigator.mediaSession.playbackState = v;
    } catch {
    }
}

function isSwitching(switchingUntilRef) {
    if (!switchingUntilRef) return false;
    const until = Number(switchingUntilRef.current || 0);
    return Number.isFinite(until) && Date.now() < until;
}

export function useMediaSessionSync({ audioRef, connectorRef, userWantsPlaybackRef, isSeekingRef, switchingUntilRef }) {
    const boundAudioRef = useRef(null);
    const boundConnectorRef = useRef(null);
    const connectorUnsubRef = useRef(null);
    const cleanupAudioRef = useRef(null);
    const seekGuardUntilRef = useRef(0);

    useEffect(() => {
        if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
            return undefined;
        }

        const isSeekGuarded = () => Date.now() < seekGuardUntilRef.current;

        const armSeekGuard = () => {
            seekGuardUntilRef.current = Date.now() + 1500;
        };

        const onPlaying = () => {
            seekGuardUntilRef.current = 0;
            setPlaybackState('playing');
        };

        const onPause = () => {
            if (isSwitching(switchingUntilRef)) return;
            if (userWantsPlaybackRef?.current) return;
            if (isSeekingRef?.current) return;
            if (isSeekGuarded()) return;
            setPlaybackState('paused');
        };

        const onSeeking = () => {
            armSeekGuard();
        };

        const onSeeked = () => {
            armSeekGuard();
            setPlaybackState('playing');
        };

        const onEnded = () => {
            if (isSwitching(switchingUntilRef)) return;
            setPlaybackState('paused');
        };

        const onWaitingOrStalled = () => {
            if (userWantsPlaybackRef?.current === true && !isSwitching(switchingUntilRef) && !isSeekingRef?.current) {
                setPlaybackState('playing');
            }
        };

        const unbindConnector = () => {
            if (connectorUnsubRef.current) {
                try { connectorUnsubRef.current(); } catch { }
                connectorUnsubRef.current = null;
            }
            boundConnectorRef.current = null;
        };

        const bindConnector = (connector) => {
            if (!connector || typeof connector.on !== 'function') { unbindConnector(); return; }
            if (boundConnectorRef.current === connector) return;
            unbindConnector();

            boundConnectorRef.current = connector;
            connectorUnsubRef.current = connector.on('state', (state) => {
                if (state === 'playing' || state === 'loading' || state === 'buffering' || state === 'seeking') {
                    setPlaybackState('playing');
                }
            });
        };

        const unbindAudioExtended = () => {
            if (cleanupAudioRef.current) {
                try { cleanupAudioRef.current(); } catch { }
                cleanupAudioRef.current = null;
            }
            boundAudioRef.current = null;
        };

        const bindAudioExtended = (audio) => {
            if (!audio) { unbindAudioExtended(); return; }
            if (boundAudioRef.current === audio) return;
            unbindAudioExtended();

            boundAudioRef.current = audio;
            audio.addEventListener('playing', onPlaying);
            audio.addEventListener('pause', onPause);
            audio.addEventListener('ended', onEnded);
            audio.addEventListener('seeking', onSeeking);
            audio.addEventListener('seeked', onSeeked);
            audio.addEventListener('waiting', onWaitingOrStalled);
            audio.addEventListener('stalled', onWaitingOrStalled);

            if (!audio.paused) {
                setPlaybackState('playing');
            }

            cleanupAudioRef.current = () => {
                audio.removeEventListener('playing', onPlaying);
                audio.removeEventListener('pause', onPause);
                audio.removeEventListener('ended', onEnded);
                audio.removeEventListener('seeking', onSeeking);
                audio.removeEventListener('seeked', onSeeked);
                audio.removeEventListener('waiting', onWaitingOrStalled);
                audio.removeEventListener('stalled', onWaitingOrStalled);
            };
        };

        bindAudioExtended(audioRef?.current);
        bindConnector(connectorRef?.current);

        const pollId = setInterval(() => {
            const nextAudio = audioRef?.current;
            if (nextAudio !== boundAudioRef.current) bindAudioExtended(nextAudio);

            const nextConnector = connectorRef?.current;
            if (nextConnector !== boundConnectorRef.current) bindConnector(nextConnector);
        }, 1000);

        return () => {
            clearInterval(pollId);
            unbindAudioExtended();
            unbindConnector();
        };
    }, [audioRef, connectorRef, isSeekingRef, switchingUntilRef, userWantsPlaybackRef]);
}
