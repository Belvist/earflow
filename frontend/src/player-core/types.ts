import type { PlaybackProtocol, TrackLike } from '../playback/types';
import type { PlayerStore } from './PlayerStore';

export type RepeatMode = 'off' | 'all' | 'one';

export type QueueSource = 'auto' | 'library' | 'liked' | 'custom';

export type CustomQueueMeta =
    | { type: 'playlist'; playlistId: string }
    | null;

export type QueueAdapter = {
    getTracks: () => ReadonlyArray<TrackLike>;
    getIndex: () => number;
    setIndex: (index: number) => void;
    getRepeatMode: () => RepeatMode;
};

export type QueueControlAdapter = {
    setQueueSource: (source: QueueSource) => void;
    setQueueName: (name: string) => void;
    setCustomQueue: (tracks: ReadonlyArray<TrackLike>) => void;
    setCustomQueueMeta: (meta: CustomQueueMeta) => void;
    syncQueueSnapshot?: (tracks: ReadonlyArray<TrackLike>) => void;
};

export type IntentAdapter = {
    getWanted: () => boolean;
    setWanted: (wanted: boolean) => void;
    setSeeking?: (isSeeking: boolean) => void;
};

export type AudioEngineAdapter = {
    ensureAudioContext: (requiresGesture: boolean) => void;
    rebuildGraph: () => void;
    primeFadeFromSilence?: () => void;
    fadeIn?: (ms: number) => void;
    fadeOut?: (ms: number) => void;
    setSwitchingUntil?: (untilMs: number) => void;
    applyMetadataEager?: (track: TrackLike) => void;
};

export type PlaybackAdapter = {
    getActiveTrackId: () => string | null;
    getProtocol?: () => PlaybackProtocol | null;
    play: (track: TrackLike, options?: { startAtSeconds?: number }) => Promise<void>;
    resume: () => Promise<void>;
    pause: () => Promise<void>;
    seek: (seconds: number) => Promise<void>;
    hardReset?: (reason: string) => Promise<void>;
};

export type TrackCatalogAdapter = {
    fetchTrackById: (id: string, signal: AbortSignal) => Promise<TrackLike | null>;
};

export type AuthAdapter = {
    isAuthenticated: () => boolean;
};

export type SettingsAdapter = {
    getAutoplayEnabled: () => boolean;
};

export type QueueExhaustedResult = {
    tracks: ReadonlyArray<TrackLike>;
    queueName?: string;
} | null;

export type PlayerCoreDeps = {
    queue: QueueAdapter;
    settings?: SettingsAdapter;
    queueControl: QueueControlAdapter;
    intent: IntentAdapter;
    audio: AudioEngineAdapter;
    playback: PlaybackAdapter;
    catalog: TrackCatalogAdapter;
    auth: AuthAdapter;
    store?: PlayerStore;
    onQueueExhausted?: () => Promise<QueueExhaustedResult>;
    prefetchSessionsFor?: (trackIds: number[]) => void;
};
