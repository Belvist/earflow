import type { MutableRefObject, RefObject } from 'react';
import { useEffect, useLayoutEffect, useRef } from 'react';

import { PLAYBACK_ENGINES } from '../context/player/constants';
import type { ApiClientLike, LoudnessInfo } from './types';
import { PlaybackConnector, type ConnectorEvents } from './PlaybackConnector';
import type { PlayerStore } from '../player-core/PlayerStore';
import { setPlaybackWakeLock, disposeWakeLock } from '../utils/wakeLock';
import { connectorStateToLocalOutputState } from './localOutputState';

type Params = {
    apiClient: ApiClientLike;
    audioRef: RefObject<HTMLAudioElement>;
    connectorRef: MutableRefObject<PlaybackConnector | null>;
    getDestinationNode: () => AudioNode | undefined;

    setPlaybackEngine: (_engine: string) => void;
    setIsPlaying: (_value: boolean) => void;
    setIsBuffering: (_value: boolean) => void;
    setLocalOutputState?: (_value: string) => void;
    setDuration: (_seconds: number) => void;
    markPlaybackError: (_code: string) => void;

    rebuildGraph: () => void;
    restoreAudioVolume?: () => void;

    currentTimeRef?: MutableRefObject<number>;
    store?: PlayerStore;
    trackLoudnessRef?: MutableRefObject<LoudnessInfo | null>;
    getQualityPreference?: () => string;

    onPlaying?: (_trackId: string | null) => void;
    onEnded?: (_endedTrackId: string | null) => void;
    onFatalError?: (_code: string) => void;
    onSeekStart?: () => void;
    onSeeked?: () => void;
    shouldSyncConnectorIsPlaying?: () => boolean;
};

export function usePlaybackConnectorBridge(params: Params): void {
    const lastEndedRef = useRef<{ trackId: string; atMs: number }>({ trackId: '', atMs: 0 });
    const lastTrackIdRef = useRef<string>('');
    const durationRef = useRef(0);
    const lastAudioElRef = useRef<HTMLAudioElement | null>(null);
    const lastBufferingRef = useRef(false);

    const useIsoLayoutEffect = globalThis.window === undefined ? useEffect : useLayoutEffect;

    useIsoLayoutEffect(() => {
        const audio = params.audioRef.current;
        if (!audio) return;

        const prevAudio = lastAudioElRef.current;
        lastAudioElRef.current = audio;

        if (params.connectorRef.current && prevAudio && prevAudio !== audio) {
            const old = params.connectorRef.current;
            params.connectorRef.current = null;
            old.stop({ clearTrack: true }).catch(() => undefined);
        }

        params.connectorRef.current ??= new PlaybackConnector({
            apiClient: params.apiClient,
            audio,
            getDestinationNode: params.getDestinationNode,
            getQualityPreference: params.getQualityPreference,
        });

        const connector = params.connectorRef.current;
        if (!connector) return;

        const unsubs: Array<() => void> = [];

        const syncLoudness = (): void => {
            const ref = params.trackLoudnessRef;
            if (!ref) return;
            const next = connector.getLoudness();
            const prev = ref.current;
            if (next === prev) return;
            if (next?.inputLufs === prev?.inputLufs && next?.targetLufs === prev?.targetLufs) return;
            ref.current = next;
            params.rebuildGraph();
        };

        const canSyncPlaybackUi = (): boolean => (
            typeof params.shouldSyncConnectorIsPlaying !== 'function'
            || params.shouldSyncConnectorIsPlaying()
        );

        const handleState: ConnectorEvents['state'] = (state) => {
            const outputState = connectorStateToLocalOutputState(state);
            if (outputState) {
                params.setLocalOutputState?.(outputState);
            }
            const syncPlaybackUi = canSyncPlaybackUi();
            const nextBuffering = state === 'buffering' || state === 'loading';
            if (lastBufferingRef.current !== nextBuffering) {
                lastBufferingRef.current = nextBuffering;
                params.setIsBuffering(nextBuffering);
                params.store?.patch({ isBuffering: nextBuffering });
            }

            if (state === 'ended') {
                const trackId = connector.getLastEndedTrackId() || connector.getActiveTrackId() || connector.getTrack()?.id || '';
                const now = Date.now();
                const guard = lastEndedRef.current;
                if (trackId && guard.trackId === trackId && now - guard.atMs < 1500) {
                    return;
                }
                lastEndedRef.current = { trackId, atMs: now };

                if (typeof params.onEnded === 'function') {
                    params.onEnded(trackId ? String(trackId) : null);
                    return;
                }

                if (syncPlaybackUi) {
                    params.setIsPlaying(false);
                }
                return;
            }

            if (state === 'playing' || state === 'loading' || state === 'buffering' || state === 'seeking') {
                if (syncPlaybackUi) {
                    params.setIsPlaying(true);
                    params.store?.patch({ isPlaying: true });
                }
                void setPlaybackWakeLock(true);
            }

            if (state === 'playing' || state === 'buffering') {
                params.restoreAudioVolume?.();
            }

            if (state === 'playing') {
                syncLoudness();
                const trackId = connector.getActiveTrackId() || connector.getTrack()?.id || null;
                params.onPlaying?.(trackId ? String(trackId) : null);
            }

            if (state === 'paused' || state === 'idle' || state === 'error') {
                if (syncPlaybackUi) {
                    params.setIsPlaying(false);
                    params.store?.patch({ isPlaying: false });
                }
                void setPlaybackWakeLock(false);
            }
        };

        const handleProtocol: ConnectorEvents['protocol'] = (protocol) => {
            if (protocol == null) {
                return;
            }
            if (protocol === 'direct') {
                params.setPlaybackEngine(PLAYBACK_ENGINES.DIRECT);
            } else if (protocol === 'hls') {
                params.setPlaybackEngine(PLAYBACK_ENGINES.HLS);
            } else {
                params.setPlaybackEngine(PLAYBACK_ENGINES.LEGACY);
            }
        };

        const handleTrack: ConnectorEvents['track'] = (track) => {
            if (!track) return;

            const hasId = track.id !== undefined && track.id !== null;
            const nextId = hasId ? String(track.id) : '';
            if (nextId && lastTrackIdRef.current === nextId) {
                return;
            }
            lastTrackIdRef.current = nextId;

            if (params.trackLoudnessRef) {
                params.trackLoudnessRef.current = null;
            }

            durationRef.current = 0;
            if (params.currentTimeRef) params.currentTimeRef.current = 0;
            params.setDuration(0);
            params.setPlaybackEngine(PLAYBACK_ENGINES.DIRECT);
            params.rebuildGraph();
        };

        const handleTime: ConnectorEvents['time'] = (seconds) => {
            const t = Number(seconds);
            if (!Number.isFinite(t) || t < 0) return;
            if (audio.seeking) return;
            if (params.currentTimeRef) {
                params.currentTimeRef.current = t;
            }
        };

        const handleDuration: ConnectorEvents['duration'] = (seconds) => {
            const d = Number(seconds);
            if (!Number.isFinite(d) || d <= 0) return;
            durationRef.current = d;
            params.setDuration(d);
            params.store?.patch({ duration: d });
        };

        const handleError: ConnectorEvents['error'] = (error) => {
            const code = error && typeof error.message === 'string' && error.message ? error.message : 'PLAYBACK_FAILED';
            params.markPlaybackError(code);
            params.onFatalError?.(code);
        };

        unsubs.push(
            connector.on('state', handleState),
            connector.on('protocol', handleProtocol),
            connector.on('track', handleTrack),
            connector.on('time', handleTime),
            connector.on('duration', handleDuration),
            connector.on('error', handleError),
        );

        const handleAudioSeeking = (): void => {
            params.onSeekStart?.();
        };

        const handleAudioSeeked = (): void => {
            params.onSeeked?.();
        };

        audio.addEventListener('seeking', handleAudioSeeking, { passive: true });
        audio.addEventListener('seeked', handleAudioSeeked, { passive: true });

        return () => {
            for (const fn of unsubs) {
                try { fn(); } catch { }
            }
            audio.removeEventListener('seeking', handleAudioSeeking);
            audio.removeEventListener('seeked', handleAudioSeeked);
            disposeWakeLock();
        };
    }, [
        params.apiClient,
        params.audioRef,
        params.connectorRef,
        params.currentTimeRef,
        params.getDestinationNode,
        params.markPlaybackError,
        params.onEnded,
        params.onFatalError,
        params.onPlaying,
        params.onSeeked,
        params.onSeekStart,
        params.rebuildGraph,
        params.restoreAudioVolume,
        params.setDuration,
        params.setIsBuffering,
        params.setIsPlaying,
        params.setPlaybackEngine,
        params.store,
        params.shouldSyncConnectorIsPlaying,
    ]);

    useEffect(() => {
        return () => {
            const connector = params.connectorRef.current;
            params.connectorRef.current = null;
            if (!connector) return;
            connector.stop({ clearTrack: true }).catch(() => undefined);
        };
    }, [params.connectorRef]);
}
