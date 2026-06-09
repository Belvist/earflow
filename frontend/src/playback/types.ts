export type PlaybackProtocol = 'hls' | 'direct';

export type ConnectorState =
    | 'idle'
    | 'loading'
    | 'playing'
    | 'paused'
    | 'buffering'
    | 'seeking'
    | 'ended'
    | 'error';

export type TrackLike = {
    id: string | number;
    durationSeconds?: number;
    duration_seconds?: number;
    duration?: number;
};

export type NormalizedTrack = {
    id: string;
    durationSeconds: number | null;
};

export type HlsSessionResponse = {
    masterUrl: string;
    expiresAtMs: number | null;
    sessionId?: string;
    playbackToken?: string;
    tokenExpiresAtMs?: number | null;
};

export type LoudnessInfo = {
    inputLufs: number | null;
    targetLufs: number;
};

export type QualityOption = {
    tag: string;
    bitrate: number;
    codec?: string;
    url: string;
    mime: string;
    loudness?: LoudnessInfo | null;
};

export type DirectSessionResponse = {
    url: string;
    masterUrl?: string;
    manifestUrl?: string;
    sessionId?: string;
    playbackToken?: string;
    tokenExpiresAtMs?: number | null;
    sessionExpiresAtMs?: number | null;
    expiresAtMs: number | null;
    mime: string | null;
    qualities?: QualityOption[] | null;
};

export type ApiClientLike = {
    baseUrl?: string;
    streamingBaseUrl?: string;
    getSongHlsSession: (_songId: string | number, _options?: { signal?: AbortSignal }) => Promise<HlsSessionResponse>;
    getSongDirectSession: (_songId: string | number, _options?: { signal?: AbortSignal }) => Promise<DirectSessionResponse>;
    refreshSongDirectSession?: (_sessionId: string, _options?: { signal?: AbortSignal; trackId?: string | number }) => Promise<DirectSessionResponse>;
    getAccessToken?: () => string;
    refreshSession?: (_options?: { signal?: AbortSignal }) => Promise<boolean>;
};

export type SessionEventMap = {
    time: (_seconds: number) => void;
    duration: (_seconds: number) => void;
    ended: () => void;
    buffering: (_isBuffering: boolean) => void;
    error: (_error: Error) => void;
};

export interface PlaybackSession {
    readonly protocol: PlaybackProtocol;
    readonly trackId: string;

    load(_signal: AbortSignal): Promise<void>;
    preloadSession?(_signal: AbortSignal): Promise<void>;
    play(): Promise<void>;
    pause(): Promise<void>;
    seek(_seconds: number): Promise<void>;
    destroy(): Promise<void>;

    setVolume(_volume: number): void;
    setPlaybackRate(_rate: number): void;

    getCurrentTime(): number;
    getDuration(): number;
    isPlaying(): boolean;

    getLoudness(): LoudnessInfo | null;
    getQualities(): QualityOption[] | null;

    on<E extends keyof SessionEventMap>(_event: E, _listener: SessionEventMap[E]): () => void;
}

export function normalizeTrack(input: TrackLike): NormalizedTrack {
    const rawId = input?.id;
    const id = rawId === null || rawId === undefined ? '' : String(rawId);

    const rawDuration = (() => {
        if (typeof input?.durationSeconds === 'number') return input.durationSeconds;
        if (typeof input?.duration_seconds === 'number') return input.duration_seconds;
        if (typeof input?.duration === 'number') return input.duration;
        return null;
    })();

    const durationSeconds =
        rawDuration != null && Number.isFinite(Number(rawDuration)) && Number(rawDuration) > 0
            ? Math.round(Number(rawDuration))
            : null;

    return { id, durationSeconds };
}

export function clamp01(value: number): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return 1;
    return Math.max(0, Math.min(1, n));
}

export function clampPlaybackRate(value: number): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return 1;
    return Math.max(0.5, Math.min(2, n));
}
