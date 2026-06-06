import { useEffect, useRef } from 'react';
import { isIosSafari } from '../../utils/platform';

function isSwitching(switchingUntilRef) {
    if (!switchingUntilRef) return false;
    const until = Number(switchingUntilRef.current || 0);
    return Number.isFinite(until) && Date.now() < until;
}

export function useIosProcessedSinkRemoteSync({ audioRef, sinkAudioRef, userWantsPlaybackRef, switchingUntilRef, pausePlayback, resumePlayback }) {
    const boundAudioRef = useRef(null);
    const boundSinkRef = useRef(null);
    const cleanupAudioRef = useRef(null);
    const cleanupSinkRef = useRef(null);
    const lastActionAtMsRef = useRef(0);

    useEffect(() => {
        if (!isIosSafari()) {
            return undefined;
        }

        const canProcess = () => {
            const sink = sinkAudioRef?.current;
            if (!sink) return false;
            try {
                return !!sink.srcObject;
            } catch {
                return false;
            }
        };

        const markAction = () => {
            lastActionAtMsRef.current = Date.now();
        };

        const shouldRateLimit = () => {
            const last = Number(lastActionAtMsRef.current || 0);
            const now = Date.now();
            return last > 0 && now - last < 350;
        };

        const bindAudio = (audio) => {
            if (!audio) {
                if (cleanupAudioRef.current) {
                    try { cleanupAudioRef.current(); } catch { }
                    cleanupAudioRef.current = null;
                }
                boundAudioRef.current = null;
                return;
            }

            if (boundAudioRef.current === audio) return;

            if (cleanupAudioRef.current) {
                try { cleanupAudioRef.current(); } catch { }
                cleanupAudioRef.current = null;
            }
            boundAudioRef.current = audio;

            const onPlaying = () => {
                if (!canProcess()) return;
                const sink = sinkAudioRef?.current;
                if (!sink) return;
                const sinkPaused = (() => {
                    try { return sink.paused === true; } catch { return true; }
                })();
                if (!sinkPaused) return;
                sink.play().catch(() => undefined);
            };

            const onPause = () => {
                if (!canProcess()) return;
                if (userWantsPlaybackRef?.current) return;
                const sink = sinkAudioRef?.current;
                if (!sink) return;
                try {
                    sink.pause();
                } catch {
                }
            };

            audio.addEventListener('playing', onPlaying);
            audio.addEventListener('pause', onPause);

            cleanupAudioRef.current = () => {
                audio.removeEventListener('playing', onPlaying);
                audio.removeEventListener('pause', onPause);
            };
        };

        const bindSink = (sink) => {
            if (!sink) {
                if (cleanupSinkRef.current) {
                    try { cleanupSinkRef.current(); } catch { }
                    cleanupSinkRef.current = null;
                }
                boundSinkRef.current = null;
                return;
            }

            if (boundSinkRef.current === sink) return;

            if (cleanupSinkRef.current) {
                try { cleanupSinkRef.current(); } catch { }
                cleanupSinkRef.current = null;
            }
            boundSinkRef.current = sink;

            const onSinkPause = () => {
                if (!canProcess()) return;
                if (isSwitching(switchingUntilRef)) return;
                if (!userWantsPlaybackRef?.current) return;
                if (shouldRateLimit()) return;

                const audio = audioRef?.current;
                const mainPlaying = (() => {
                    try { return audio ? audio.paused !== true : false; } catch { return false; }
                })();
                if (!mainPlaying) return;

                markAction();
                if (typeof pausePlayback === 'function') {
                    pausePlayback();
                }
            };

            const onSinkPlay = () => {
                if (!canProcess()) return;
                if (isSwitching(switchingUntilRef)) return;
                if (userWantsPlaybackRef?.current) return;
                if (shouldRateLimit()) return;

                const audio = audioRef?.current;
                const mainPaused = (() => {
                    try { return audio ? audio.paused === true : true; } catch { return true; }
                })();
                if (!mainPaused) return;

                markAction();
                if (typeof resumePlayback === 'function') {
                    resumePlayback();
                }
            };

            sink.addEventListener('pause', onSinkPause);
            sink.addEventListener('play', onSinkPlay);
            sink.addEventListener('playing', onSinkPlay);

            cleanupSinkRef.current = () => {
                sink.removeEventListener('pause', onSinkPause);
                sink.removeEventListener('play', onSinkPlay);
                sink.removeEventListener('playing', onSinkPlay);
            };
        };

        bindAudio(audioRef?.current);
        bindSink(sinkAudioRef?.current);

        const w = typeof window !== 'undefined' ? window : null;
        if (!w) {
            return () => {
                bindSink(null);
                bindAudio(null);
            };
        }

        const pollId = w.setInterval(() => {
            const nextAudio = audioRef?.current;
            if (nextAudio !== boundAudioRef.current) bindAudio(nextAudio);

            const nextSink = sinkAudioRef?.current;
            if (nextSink !== boundSinkRef.current) bindSink(nextSink);
        }, 800);

        return () => {
            w.clearInterval(pollId);
            bindSink(null);
            bindAudio(null);
        };
    }, [audioRef, pausePlayback, resumePlayback, sinkAudioRef, switchingUntilRef, userWantsPlaybackRef]);
}
