export const PLAYER_STATUSES = Object.freeze({
    IDLE: 'IDLE',
    LOADING: 'LOADING',
    PLAYING: 'PLAYING',
    BUFFERING: 'BUFFERING',
    STALLED: 'STALLED',
    ERROR: 'ERROR',
});

export const REPEAT_MODES = {
    OFF: 'off',
    ALL: 'all',
    ONE: 'one',
};

export const QUEUE_SOURCES = {
    AUTO: 'auto',
    LIBRARY: 'library',
    LIKED: 'liked',
    CUSTOM: 'custom',
};

export const PLAYBACK_ENGINES = {
    LEGACY: 'legacy',
    HLS: 'hls',
    DIRECT: 'direct',
};

export const AUDIO_QUALITY = {
    AUTO: 'auto',
    LOW: 'low',
    HIGH: 'high',
};

export const CROSSFADE_STEPS = 20;
export const MAX_HISTORY_SIZE = 100;
