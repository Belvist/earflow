import { useCallback, useEffect, useRef } from 'react';
import { getSharedAudioContext } from '../../utils/audioContextFactory';
import { isIosSafari } from '../../utils/platform';
import { AudioGraph } from '../../player-core/AudioGraph';

const FIXED_PREAMP_DB = 3;
const FIXED_PREAMP_LINEAR = Math.pow(10, FIXED_PREAMP_DB / 20);

const safeDisconnect = (node) => {
    if (!node) return;
    try {
        if (typeof node.disconnect === 'function') {
            node.disconnect();
        }
    } catch {
    }
};

const safeDisconnectAll = (nodes) => {
    const arr = Array.isArray(nodes) ? nodes : [];
    for (const n of arr) {
        safeDisconnect(n);
    }
};

export const useAudioEngine = (state, userSettings) => {
    const {
        audioRef,
        audioCtxRef,
        playbackEngine,
        volume,
        eqEnabled,
        eqGains,
        userGestureEverRef,
        switchingUntilRef,
    } = state;

    const processedSinkAudioRef = useRef(null);
    const mediaStreamDestRef = useRef(null);

    const audioGraphRef = useRef(null);
    if (!audioGraphRef.current) audioGraphRef.current = new AudioGraph();

    const sourceRef = useRef(null);
    const preampGainRef = useRef(null);
    const gainNodeRef = useRef(null);
    const fadeGainNodeRef = useRef(null);
    const fadeTargetRef = useRef(1);
    const filtersRef = useRef([]);
    const graphCtxRef = useRef(null);
    const graphAudioElRef = useRef(null);
    const processedSinkActiveRef = useRef(false);
    const nativeOutputActiveRef = useRef(true);
    const nativeFadeTimerRef = useRef(0);
    const nativeFadeSeqRef = useRef(0);
    const nativeFadeHoldUntilRef = useRef(0);
    const safeVolRef = useRef(1);
    const lastTopologyKeyRef = useRef('');

    const rampGain = (gainNode, ctx, target, rampMs = 10) => {
        if (!gainNode || !ctx || ctx.state !== 'running') {
            if (gainNode) try { gainNode.gain.value = target; } catch { }
            return;
        }
        const t0 = ctx.currentTime;
        const cur = gainNode.gain.value;
        if (Math.abs(cur - target) < 0.0001) return;
        try {
            gainNode.gain.cancelScheduledValues(t0);
            gainNode.gain.setValueAtTime(Number.isFinite(cur) ? cur : 1, t0);
            const dur = Math.max(0, rampMs) / 1000;
            if (dur <= 0) {
                gainNode.gain.setValueAtTime(target, t0);
            } else {
                gainNode.gain.linearRampToValueAtTime(target, t0 + dur);
            }
        } catch {
            try { gainNode.gain.value = target; } catch { }
        }
    };
    const getNativeOutputVolume = useCallback((fallbackVolume) => {
        const until = Number(nativeFadeHoldUntilRef.current || 0);
        if (Number.isFinite(until) && Date.now() <= until && nativeOutputActiveRef.current === true) return 0;
        return fallbackVolume;
    }, []);
    const eqFreqs = [60, 170, 310, 600, 1000, 10000, 16000];
    const eqIndexMap = [0, 1, 2, 3, 4, 7, 9];

    const computeEqHeadroomGain = useCallback((gains) => {
        const arr = Array.isArray(gains) ? gains : [];
        const maxBoostDb = Math.max(0, ...arr.map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0)));
        const headroomDb = 1.5;
        return Math.pow(10, -(maxBoostDb + headroomDb) / 20);
    }, []);

    const getEffectiveEqGains = useCallback(() => {
        const src = Array.isArray(eqGains) ? eqGains : [];
        return eqIndexMap.map((idx) => {
            const g = Number(src[idx] ?? 0);
            return Number.isFinite(g) ? Math.max(-12, Math.min(12, g)) : 0;
        });
    }, [eqGains]);

    const ensureAudioContext = useCallback(
        (allowCreate = false) => {
            if (typeof window === 'undefined') return false;

            const hasActivation =
                allowCreate ||
                userGestureEverRef.current ||
                (typeof navigator !== 'undefined' && navigator.userActivation?.hasBeenActive);

            if (!audioCtxRef.current && !hasActivation) return false;

            if (!audioCtxRef.current) {
                try {
                    const sharedCtx = getSharedAudioContext(allowCreate || userGestureEverRef.current);
                    if (!sharedCtx) return false;
                    audioCtxRef.current = sharedCtx;
                } catch {
                    return false;
                }
            }

            if (audioCtxRef.current && audioCtxRef.current.state === 'closed') {
                audioCtxRef.current = null;
                try {
                    const sharedCtx = getSharedAudioContext(allowCreate || userGestureEverRef.current);
                    if (!sharedCtx) return false;
                    audioCtxRef.current = sharedCtx;
                } catch {
                    return false;
                }
            }

            if (graphCtxRef.current && audioCtxRef.current && graphCtxRef.current !== audioCtxRef.current) {
                sourceRef.current = null;
                gainNodeRef.current = null;
                fadeGainNodeRef.current = null;
                filtersRef.current = [];
                fadeTargetRef.current = 1;

                try {
                    if (mediaStreamDestRef?.current) {
                        mediaStreamDestRef.current = null;
                    }
                } catch {
                }
                try {
                    if (processedSinkAudioRef?.current) {
                        processedSinkAudioRef.current.srcObject = null;
                    }
                } catch {
                }
            }

            if (audioCtxRef.current.state === 'suspended' && hasActivation) {
                audioCtxRef.current.resume().catch(() => { });
            }

            return true;
        },
        [audioCtxRef, mediaStreamDestRef, processedSinkAudioRef, userGestureEverRef]
    );

    const rebuildGraph = useCallback(() => {
        const audio = audioRef.current;
        const ctx = audioCtxRef.current;
        if (!audio) return;

        const vol = Number(volume);
        const safeVol = Number.isFinite(vol) ? Math.max(0, Math.min(1, vol)) : 1;
        safeVolRef.current = safeVol;

        if (!ctx) {
            nativeOutputActiveRef.current = true;
            return;
        }

        if (graphAudioElRef.current && graphAudioElRef.current !== audio) {
            sourceRef.current = null;
        }
        graphAudioElRef.current = audio;

        if (graphCtxRef.current && graphCtxRef.current !== ctx) {
            sourceRef.current = null;
            preampGainRef.current = null;
            gainNodeRef.current = null;
            fadeGainNodeRef.current = null;
            filtersRef.current = [];
            fadeTargetRef.current = 1;
            if (mediaStreamDestRef?.current) {
                try {
                    mediaStreamDestRef.current = null;
                } catch {
                }
            }
        }
        graphCtxRef.current = ctx;

        const effectiveEqEnabled = isIosSafari() ? false : eqEnabled;
        const needsWebAudio = effectiveEqEnabled;
        const ios = isIosSafari();
        const forceNativeForIosNoWebAudio = ios && !needsWebAudio;
        const hasActivation =
            userGestureEverRef.current ||
            (typeof navigator !== 'undefined' && navigator.userActivation?.hasBeenActive);

        if (forceNativeForIosNoWebAudio) {
            const src0 = sourceRef.current;
            safeDisconnect(sourceRef.current);
            safeDisconnectAll(filtersRef.current);
            safeDisconnect(preampGainRef.current);
            safeDisconnect(gainNodeRef.current);
            safeDisconnect(fadeGainNodeRef.current);
            nativeOutputActiveRef.current = true;

            if (src0) {
                if (ctx.state === 'suspended' && hasActivation) {
                    try { ctx.resume().catch(() => undefined); } catch { }
                }
                try { src0.connect(ctx.destination); } catch { }
            }

            processedSinkActiveRef.current = false;
            try {
                audio.muted = false;
            } catch {
            }
            try {
                audio.volume = getNativeOutputVolume(safeVol);
            } catch {
            }
            return;
        }

        const topologyKey = [
            effectiveEqEnabled ? 'q' : '',
            forceNativeForIosNoWebAudio ? 'f' : '',
            ios ? 'i' : '',
            sourceRef.current ? 's' : '',
        ].join('');

        const sameTopology =
            lastTopologyKeyRef.current === topologyKey &&
            graphAudioElRef.current === audio &&
            graphCtxRef.current === ctx &&
            sourceRef.current &&
            gainNodeRef.current;

        if (sameTopology && ctx.state === 'running') {
            const mainGain = gainNodeRef.current;
            const mainGainTarget = (effectiveEqEnabled ? computeEqHeadroomGain(getEffectiveEqGains()) : 1.0) * safeVol;
            rampGain(mainGain, ctx, mainGainTarget, 10);

            if (effectiveEqEnabled) {
                const filters = filtersRef.current;
                if (Array.isArray(filters) && filters.length === eqFreqs.length) {
                    const effectiveGains = getEffectiveEqGains();
                    for (let i = 0; i < filters.length; i++) {
                        const safe = Number(effectiveGains[i] ?? 0);
                        try { filters[i].gain.value = safe; } catch { }
                    }
                }
            }

            safeVolRef.current = safeVol;
            try {
                audio.volume = sourceRef.current ? 1 : getNativeOutputVolume(safeVol);
            } catch { }
            return;
        }

        lastTopologyKeyRef.current = topologyKey;

        if (needsWebAudio && ctx.state === 'suspended' && hasActivation) {
            try {
                ctx.resume()
                    .then(() => {
                        try {
                            rebuildGraph();
                        } catch {
                        }
                    })
                    .catch(() => undefined);
            } catch {
            }
        }

        if (needsWebAudio && ctx.state !== 'running') {
            nativeOutputActiveRef.current = true;
            try {
                audio.muted = false;
            } catch {
            }
            try {
                audio.volume = sourceRef.current ? 1 : getNativeOutputVolume(safeVol);
            } catch {
            }
            return;
        }

        if (!sourceRef.current) {
            try {
                sourceRef.current = ctx.createMediaElementSource(audio);
            } catch (e) {
                const name = e && typeof e === 'object' ? e.name : '';
                if (name !== 'InvalidStateError') {
                    sourceRef.current = null;
                }
            }
        }

        const src = sourceRef.current;
        nativeOutputActiveRef.current = !src;

        if (!preampGainRef.current) {
            preampGainRef.current = ctx.createGain();
            preampGainRef.current.gain.value = FIXED_PREAMP_LINEAR;
        }

        if (!gainNodeRef.current) {
            gainNodeRef.current = ctx.createGain();
        }
        const mainGain = gainNodeRef.current;
        const preamp = preampGainRef.current;

        if (src) try { src.disconnect(); } catch { }
        filtersRef.current.forEach((f) => { try { f.disconnect(); } catch { } });
        if (preamp) try { preamp.disconnect(); } catch { }
        if (mainGain) try { mainGain.disconnect(); } catch { }
        if (fadeGainNodeRef.current) try { fadeGainNodeRef.current.disconnect(); } catch { }

        let chainStart = null;

        if (effectiveEqEnabled) {
            const existing = Array.isArray(filtersRef.current) ? filtersRef.current : [];
            if (existing.length !== eqFreqs.length) {
                const created = eqFreqs.map((freq) => {
                    const f = ctx.createBiquadFilter();
                    f.type = 'peaking';
                    f.frequency.value = freq;
                    f.Q.value = 1;
                    f.gain.value = 0;
                    return f;
                });
                filtersRef.current = created;
            }

            const filters = filtersRef.current;
            const effectiveGains = getEffectiveEqGains();
            for (let i = 0; i < filters.length; i++) {
                const safe = Number(effectiveGains[i] ?? 0);
                try {
                    filters[i].gain.value = safe;
                } catch {
                }
            }

            for (let i = 0; i < filters.length - 1; i++) {
                try {
                    filters[i].connect(filters[i + 1]);
                } catch {
                }
            }
            chainStart = filters[0];
        }

        const connectToOutput = (node) => {
            if (!node) return;
            if (chainStart) {
                node.connect(chainStart);
            } else if (preamp) {
                node.connect(preamp);
            } else {
                node.connect(mainGain);
            }
        };

        if (src) {
            connectToOutput(src);
        }

        if (chainStart && preamp) {
            const lastFilter = filtersRef.current[filtersRef.current.length - 1];
            lastFilter.connect(preamp);
        } else if (chainStart) {
            const lastFilter = filtersRef.current[filtersRef.current.length - 1];
            lastFilter.connect(mainGain);
        }

        if (preamp) {
            try { preamp.connect(mainGain); } catch { }
        }

        const mainGainTarget = (effectiveEqEnabled ? computeEqHeadroomGain(getEffectiveEqGains()) : 1.0) * safeVol;
        rampGain(mainGain, ctx, mainGainTarget, 10);

        if (!fadeGainNodeRef.current) {
            fadeGainNodeRef.current = ctx.createGain();
            fadeGainNodeRef.current.gain.value = 1;
            fadeTargetRef.current = 1;
        }
        const fadeGain = fadeGainNodeRef.current;

        try { mainGain.connect(fadeGain); } catch { }

        const shouldUseProcessedSink =
            typeof ctx.createMediaStreamDestination === 'function' &&
            isIosSafari() &&
            effectiveEqEnabled;

        processedSinkActiveRef.current = shouldUseProcessedSink;
        safeVolRef.current = safeVol;

        if (!shouldUseProcessedSink) {
            try {
                audio.muted = false;
            } catch {
            }
            try {
                audio.volume = sourceRef.current ? 1 : getNativeOutputVolume(safeVol);
            } catch {
            }
            const sink0 = processedSinkAudioRef?.current;
            if (sink0) {
                try { sink0.pause(); } catch { }
                try { sink0.srcObject = null; } catch { }
            }
            if (mediaStreamDestRef?.current) {
                try {
                    mediaStreamDestRef.current = null;
                } catch {
                }
            }
            if (ctx.state === 'suspended') {
                const hasActivationForFallback =
                    userGestureEverRef.current ||
                    (typeof navigator !== 'undefined' && navigator.userActivation?.hasBeenActive);
                if (hasActivationForFallback) {
                    try {
                        ctx.resume().catch(() => undefined);
                    } catch {
                    }
                }
            }
            try { fadeGain.disconnect(); } catch { }
            try { fadeGain.connect(ctx.destination); } catch { }
            return;
        }

        const hasActivationForSink =
            userGestureEverRef.current ||
            (typeof navigator !== 'undefined' && navigator.userActivation?.hasBeenActive);

        if (!hasActivationForSink) {
            try {
                audio.muted = false;
            } catch {
            }
            try { fadeGain.disconnect(); } catch { }
            try {
                fadeGain.connect(ctx.destination);
            } catch {
            }
            return;
        }

        if (!mediaStreamDestRef.current || mediaStreamDestRef.current.context !== ctx) {
            mediaStreamDestRef.current = ctx.createMediaStreamDestination();
        }
        const dest = mediaStreamDestRef.current;

        try { fadeGain.disconnect(); } catch { }
        try { fadeGain.connect(dest); } catch { }

        if (!processedSinkAudioRef.current && typeof document !== 'undefined') {
            const sink = document.createElement('audio');
            sink.autoplay = false;
            sink.playsInline = true;
            sink.preload = 'auto';
            sink.controls = false;
            sink.style.display = 'none';
            try { document.body.appendChild(sink); } catch { }
            processedSinkAudioRef.current = sink;
        }

        const sink = processedSinkAudioRef.current;
        if (sink) {
            try {
                if (sink.srcObject !== dest.stream) {
                    sink.srcObject = dest.stream;
                }
            } catch {
            }

            try {
                sink.playbackRate = 1;
            } catch {
            }

            try { sink.volume = 1; } catch { }

            sink.play()
                .then(() => {
                    const sinkPlayingNow = (() => {
                        try { return sink.paused !== true; } catch { return false; }
                    })();
                    const isCurrentSink = (() => {
                        try { return processedSinkAudioRef?.current === sink; } catch { return false; }
                    })();
                    const sinkStillActive = (() => {
                        try { return processedSinkActiveRef.current === true; } catch { return false; }
                    })();
                    const shouldMuteNow =
                        sinkPlayingNow &&
                        isCurrentSink &&
                        sinkStillActive &&
                        shouldUseProcessedSink &&
                        eqEnabled &&
                        ctx.state === 'running' &&
                        !!sourceRef.current;
                    if (!shouldMuteNow) return;
                    try { audio.muted = true; } catch { }
                })
                .catch(() => {
                    processedSinkActiveRef.current = false;
                    try {
                        audio.muted = false;
                    } catch {
                    }
                    try {
                        audio.volume = sourceRef.current ? 1 : getNativeOutputVolume(safeVol);
                    } catch {
                    }
                    try { fadeGain.disconnect(); } catch { }
                    try {
                        fadeGain.connect(ctx.destination);
                    } catch {
                    }
                });
        }

        const sinkPlaying = (() => {
            const s = processedSinkAudioRef?.current;
            if (!s) return false;
            try {
                return s.paused !== true;
            } catch {
                return false;
            }
        })();

        const shouldMuteAudioEl =
            shouldUseProcessedSink &&
            eqEnabled &&
            ctx.state === 'running' &&
            !!sourceRef.current &&
            sinkPlaying;
        try {
            audio.muted = !!shouldMuteAudioEl;
        } catch {
        }
    }, [audioRef, audioCtxRef, mediaStreamDestRef, processedSinkAudioRef, eqEnabled, userSettings, playbackEngine, computeEqHeadroomGain, getEffectiveEqGains, getNativeOutputVolume, volume]);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const w = typeof window === 'undefined' ? null : window;
        if (!w) return;

        const isVisible = () => {
            try {
                return typeof document === 'undefined' ? true : document.visibilityState === 'visible';
            } catch {
                return true;
            }
        };

        const isSwitching = () => {
            const until = Number(switchingUntilRef?.current || 0);
            return Number.isFinite(until) && Date.now() < until;
        };

        const onSeeking = () => {
            if (!isVisible()) return;
            if (isSwitching()) return;
            if (processedSinkActiveRef.current !== true) return;
            try {
                audio.muted = false;
            } catch {
            }
            try {
                audio.volume = sourceRef.current ? 1 : getNativeOutputVolume(safeVolRef.current);
            } catch {
            }
        };

        const onSeeked = () => {
            if (!isVisible()) return;
            if (isSwitching()) return;
            if (processedSinkActiveRef.current !== true) return;
            const sink = processedSinkAudioRef?.current;
            if (sink) {
                sink.play()
                    .then(() => {
                        try {
                            audio.muted = true;
                        } catch {
                        }
                    })
                    .catch(() => {
                        try {
                            audio.muted = false;
                        } catch {
                        }
                    });
                return;
            }
            try {
                audio.muted = true;
            } catch {
            }
        };

        audio.addEventListener('seeking', onSeeking);
        audio.addEventListener('seeked', onSeeked);

        let boundSink = null;
        let bindPollId = 0;
        let sinkPauseFallbackTimerId = 0;

        const fallbackToNative = () => {
            if (isSwitching()) return;
            processedSinkActiveRef.current = false;
            try {
                audio.muted = false;
            } catch {
            }
            try {
                audio.volume = getNativeOutputVolume(safeVolRef.current);
            } catch {
            }
            const sink = processedSinkAudioRef?.current;
            if (sink) {
                try { sink.pause(); } catch { }
                try { sink.srcObject = null; } catch { }
            }
        };

        const clearSinkPauseFallbackTimer = () => {
            if (!sinkPauseFallbackTimerId) return;
            try {
                w.clearTimeout(sinkPauseFallbackTimerId);
            } catch {
            }
            sinkPauseFallbackTimerId = 0;
        };

        const shouldFallbackNow = () => {
            if (processedSinkActiveRef.current !== true) return false;
            if (isSwitching()) return false;

            const mainPlaying = (() => {
                try { return audio.paused !== true; } catch { return false; }
            })();
            if (!mainPlaying) return false;

            const mainMuted = (() => {
                try { return audio.muted === true; } catch { return false; }
            })();
            if (!mainMuted) return false;

            const sink = processedSinkAudioRef?.current;
            if (!sink) return true;

            const sinkPlaying = (() => {
                try { return sink.paused !== true; } catch { return false; }
            })();
            return !sinkPlaying;
        };

        const scheduleFallbackToNativeAfterPause = () => {
            clearSinkPauseFallbackTimer();
            sinkPauseFallbackTimerId = w.setTimeout(() => {
                sinkPauseFallbackTimerId = 0;
                if (!isVisible()) return;
                if (isSwitching()) return;
                if (!shouldFallbackNow()) return;
                fallbackToNative();
            }, 250);
        };

        const onSinkPause = () => {
            if (!isVisible()) return;
            if (isSwitching()) return;
            if (!shouldFallbackNow()) return;
            scheduleFallbackToNativeAfterPause();
        };

        const onSinkFailure = () => {
            if (!isVisible()) return;
            clearSinkPauseFallbackTimer();
            if (!shouldFallbackNow()) return;
            fallbackToNative();
        };

        const bindToSink = (nextSink) => {
            if (boundSink === nextSink) return;
            if (boundSink) {
                try { boundSink.removeEventListener('pause', onSinkPause); } catch { }
                try { boundSink.removeEventListener('ended', onSinkFailure); } catch { }
                try { boundSink.removeEventListener('error', onSinkFailure); } catch { }
                try { boundSink.removeEventListener('stalled', onSinkFailure); } catch { }
            }
            boundSink = nextSink || null;
            if (boundSink) {
                try { boundSink.addEventListener('pause', onSinkPause); } catch { }
                try { boundSink.addEventListener('ended', onSinkFailure); } catch { }
                try { boundSink.addEventListener('error', onSinkFailure); } catch { }
                try { boundSink.addEventListener('stalled', onSinkFailure); } catch { }
            }
        };

        bindToSink(processedSinkAudioRef?.current || null);
        bindPollId = w.setInterval(() => {
            bindToSink(processedSinkAudioRef?.current || null);
        }, 800);

        const onVisibility = () => {
            try {
                if (typeof document === 'undefined') return;
            } catch {
                return;
            }

            const visibleNow = (() => {
                try {
                    return typeof document === 'undefined' ? true : document.visibilityState === 'visible';
                } catch {
                    return true;
                }
            })();

            if (visibleNow) {
                const ctx = audioCtxRef?.current;
                if (ctx && ctx.state === 'suspended') {
                    const hasAct =
                        userGestureEverRef?.current ||
                        (typeof navigator !== 'undefined' && navigator.userActivation?.hasBeenActive);
                    if (hasAct) {
                        ctx.resume().catch(() => { });
                    }
                }

                if (processedSinkActiveRef.current !== true) return;

                const mainPlaying = (() => {
                    try { return audio.paused !== true; } catch { return false; }
                })();
                if (!mainPlaying) return;

                const mainMuted = (() => {
                    try { return audio.muted === true; } catch { return false; }
                })();
                if (!mainMuted) return;

                const sink = processedSinkAudioRef?.current;
                if (!sink) {
                    fallbackToNative();
                    return;
                }

                const sinkPaused = (() => {
                    try { return sink.paused === true; } catch { return true; }
                })();
                if (!sinkPaused) return;

                sink.play()
                    .then(() => {
                        try {
                            audio.muted = true;
                        } catch {
                        }
                    })
                    .catch(() => {
                        fallbackToNative();
                    });
                return;
            }

            return;
        };

        try {
            if (typeof document !== 'undefined') {
                document.addEventListener('visibilitychange', onVisibility);
            }
        } catch {
        }

        let ctxStateUnsub = null;
        const bindCtxStateWatch = () => {
            if (ctxStateUnsub) return;
            const ctx = audioCtxRef?.current;
            if (!ctx || typeof ctx.addEventListener !== 'function') return;

            const onStateChange = () => {
                const c = audioCtxRef?.current;
                if (!c || c !== ctx) return;
                if (c.state !== 'suspended') return;

                const mainPlaying = (() => {
                    try { return audio.paused !== true; } catch { return false; }
                })();
                if (!mainPlaying) return;

                const hasAct =
                    userGestureEverRef?.current ||
                    (typeof navigator !== 'undefined' && navigator.userActivation?.hasBeenActive);
                if (!hasAct) return;

                c.resume().catch(() => undefined);
            };

            try {
                ctx.addEventListener('statechange', onStateChange);
                ctxStateUnsub = () => {
                    try { ctx.removeEventListener('statechange', onStateChange); } catch { }
                    ctxStateUnsub = null;
                };
            } catch { }
        };

        bindCtxStateWatch();
        const ctxPollId = w.setInterval(() => {
            if (!ctxStateUnsub) bindCtxStateWatch();
        }, 3000);

        return () => {
            audio.removeEventListener('seeking', onSeeking);
            audio.removeEventListener('seeked', onSeeked);

            if (bindPollId) {
                try { w.clearInterval(bindPollId); } catch { }
                bindPollId = 0;
            }

            if (ctxPollId) {
                try { w.clearInterval(ctxPollId); } catch { }
            }
            if (ctxStateUnsub) ctxStateUnsub();

            clearSinkPauseFallbackTimer();
            bindToSink(null);

            try {
                if (typeof document !== 'undefined') {
                    document.removeEventListener('visibilitychange', onVisibility);
                }
            } catch {
            }
        };
    }, [audioRef, getNativeOutputVolume, processedSinkAudioRef]);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const enforceNativeSilenceHold = () => {
            const until = Number(nativeFadeHoldUntilRef.current || 0);
            if (!Number.isFinite(until) || Date.now() > until) return;
            if (nativeOutputActiveRef.current !== true) return;
            try { audio.volume = 0; } catch { }
        };

        audio.addEventListener('loadstart', enforceNativeSilenceHold);
        audio.addEventListener('loadedmetadata', enforceNativeSilenceHold);
        audio.addEventListener('canplay', enforceNativeSilenceHold);
        audio.addEventListener('play', enforceNativeSilenceHold);
        audio.addEventListener('playing', enforceNativeSilenceHold);

        return () => {
            audio.removeEventListener('loadstart', enforceNativeSilenceHold);
            audio.removeEventListener('loadedmetadata', enforceNativeSilenceHold);
            audio.removeEventListener('canplay', enforceNativeSilenceHold);
            audio.removeEventListener('play', enforceNativeSilenceHold);
            audio.removeEventListener('playing', enforceNativeSilenceHold);
        };
    }, [audioRef]);

    const clearNativeFadeTimer = useCallback(() => {
        const id = nativeFadeTimerRef.current;
        nativeFadeTimerRef.current = 0;
        nativeFadeSeqRef.current += 1;
        if (!id || typeof window === 'undefined') return;
        try { window.clearTimeout(id); } catch { }
    }, []);

    const rampNativeVolume = useCallback((target, rampMs = 80) => {
        const audio = audioRef.current;
        if (!audio) return;

        const next = Number(target);
        if (!Number.isFinite(next)) return;

        const clamped = Math.max(0, Math.min(1, next));
        const w = typeof window === 'undefined' ? null : window;
        clearNativeFadeTimer();

        const startRaw = Number(audio.volume);
        const start = Number.isFinite(startRaw) ? Math.max(0, Math.min(1, startRaw)) : safeVolRef.current;
        const dur = Math.max(0, Number(rampMs) || 0);
        if (!w || dur <= 0 || Math.abs(start - clamped) < 0.0001) {
            try { audio.volume = clamped; } catch { }
            return;
        }

        const seq = nativeFadeSeqRef.current;
        const startedAt = typeof w.performance?.now === 'function' ? w.performance.now() : Date.now();
        const tick = () => {
            if (nativeFadeSeqRef.current !== seq) return;
            const now = typeof w.performance?.now === 'function' ? w.performance.now() : Date.now();
            const p = Math.max(0, Math.min(1, (now - startedAt) / dur));
            const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
            const value = start + (clamped - start) * eased;
            try { audio.volume = Math.max(0, Math.min(1, value)); } catch { }
            if (p >= 1) {
                nativeFadeTimerRef.current = 0;
                return;
            }
            nativeFadeTimerRef.current = w.setTimeout(tick, 16);
        };

        tick();
    }, [audioRef, clearNativeFadeTimer]);

    const setFadeGain = useCallback((target, rampMs = 80) => {
        const ctx = audioCtxRef.current;
        const node = fadeGainNodeRef.current;
        const next = Number(target);
        if (!Number.isFinite(next)) return;

        const clamped = Math.max(0, Math.min(1, next));
        if (!ctx || !node || nativeOutputActiveRef.current === true || ctx.state === 'closed') {
            fadeTargetRef.current = clamped;
            return false;
        }

        const t0 = ctx.currentTime;
        const prevTarget = Number(fadeTargetRef.current);
        if (Number.isFinite(prevTarget) && Math.abs(prevTarget - clamped) < 0.0001) return true;
        fadeTargetRef.current = clamped;

        const dur = Math.max(0, Number(rampMs) || 0) / 1000;
        try {
            const current = Number(node.gain.value);
            node.gain.cancelScheduledValues(t0);
            node.gain.setValueAtTime(Number.isFinite(current) ? current : 1, t0);
            if (dur <= 0) {
                node.gain.setValueAtTime(clamped, t0);
                return true;
            }
            node.gain.linearRampToValueAtTime(clamped, t0 + dur);
        } catch {
        }
        return true;
    }, [audioCtxRef]);

    const fadeOut = useCallback((rampMs = 80) => {
        const usedGraph = setFadeGain(0, rampMs);
        if (!usedGraph) rampNativeVolume(0, rampMs);
    }, [rampNativeVolume, setFadeGain]);

    const fadeIn = useCallback((rampMs = 80) => {
        nativeFadeHoldUntilRef.current = 0;
        const usedGraph = setFadeGain(1, rampMs);
        if (!usedGraph) {
            rampNativeVolume(safeVolRef.current, rampMs);
            return;
        }
        clearNativeFadeTimer();
        const audio = audioRef.current;
        if (audio && sourceRef.current && nativeOutputActiveRef.current !== true) {
            try { audio.volume = 1; } catch { }
        }
    }, [audioRef, clearNativeFadeTimer, rampNativeVolume, setFadeGain]);

    const primeFadeFromSilence = useCallback(() => {
        const ctx = audioCtxRef.current;
        const node = fadeGainNodeRef.current;
        if (!ctx || !node || nativeOutputActiveRef.current === true || ctx.state === 'closed') {
            fadeTargetRef.current = 0;
            nativeFadeHoldUntilRef.current = Date.now() + 5_000;
            rampNativeVolume(0, 0);
            return;
        }
        nativeFadeHoldUntilRef.current = 0;
        const t0 = ctx.currentTime;
        try {
            node.gain.cancelScheduledValues(t0);
            node.gain.setValueAtTime(0, t0);
            fadeTargetRef.current = 0;
        } catch {
        }
    }, [audioCtxRef, rampNativeVolume]);

    useEffect(() => () => {
        clearNativeFadeTimer();
    }, [clearNativeFadeTimer]);

    const applyEqSettings = useCallback(() => {
        const ctx = audioCtxRef.current;
        if (!ctx) return;
        const effectiveEqEnabled = isIosSafari() ? false : eqEnabled;
        const mainGain = gainNodeRef.current;
        if (mainGain) {
            const vol = Number(volume);
            const safeVol = Number.isFinite(vol) ? Math.max(0, Math.min(1, vol)) : 1;
            rampGain(mainGain, ctx, (effectiveEqEnabled ? computeEqHeadroomGain(getEffectiveEqGains()) : 1.0) * safeVol, 10);
        }
        const audio = audioRef?.current;
        if (audio) {
            const targetVolume = sourceRef.current && nativeOutputActiveRef.current !== true ? 1 : getNativeOutputVolume(safeVolRef.current);
            try { audio.volume = targetVolume; } catch { }
        }
        if (!effectiveEqEnabled) return;
        const filters = filtersRef.current;
        if (!Array.isArray(filters) || filters.length !== eqFreqs.length) return;
        const effectiveGains = getEffectiveEqGains();
        for (let i = 0; i < filters.length; i++) {
            const safe = Number(effectiveGains[i] ?? 0);
            try {
                filters[i].gain.value = safe;
            } catch {
            }
        }
    }, [audioCtxRef, eqEnabled, computeEqHeadroomGain, getEffectiveEqGains, getNativeOutputVolume, playbackEngine, volume]);

    const restoreAudioVolume = useCallback(() => {
        const audio = audioRef?.current;
        if (!audio) return;
        const vol = Number(volume);
        const safeVol = Number.isFinite(vol) ? Math.max(0, Math.min(1, vol)) : 1;
        safeVolRef.current = safeVol;
        try { audio.volume = sourceRef.current && nativeOutputActiveRef.current !== true ? 1 : getNativeOutputVolume(safeVol); } catch { }
    }, [audioRef, getNativeOutputVolume, volume]);

    return {
        ensureAudioContext,
        rebuildGraph,
        applyEqSettings,
        fadeOut,
        fadeIn,
        primeFadeFromSilence,
        restoreAudioVolume,
        processedSinkAudioRef,
        sourceRef,
        gainNodeRef,
        fadeGainNodeRef,
        filtersRef,
        audioGraph: audioGraphRef.current,
    };
};
