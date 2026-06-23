export const LOCAL_OUTPUT_STATES = Object.freeze({
    IDLE: 'IDLE',
    ACTIVE: 'ACTIVE',
    SUSPENDED: 'SUSPENDED',
    BUFFERING: 'BUFFERING',
    INTERRUPTED: 'INTERRUPTED',
    REVOKED: 'REVOKED',
    LOST: 'LOST',
    ERROR: 'ERROR',
});

const KNOWN_STATES = new Set(Object.values(LOCAL_OUTPUT_STATES));

export function normalizeLocalOutputState(value, fallback = LOCAL_OUTPUT_STATES.IDLE) {
    const state = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if (KNOWN_STATES.has(state)) return state;
    return fallback;
}

export function connectorStateToLocalOutputState(state) {
    switch (state) {
        case 'playing':
            return LOCAL_OUTPUT_STATES.ACTIVE;
        case 'loading':
        case 'buffering':
        case 'seeking':
            return LOCAL_OUTPUT_STATES.BUFFERING;
        case 'paused':
        case 'idle':
        case 'ended':
            return LOCAL_OUTPUT_STATES.IDLE;
        case 'error':
            return LOCAL_OUTPUT_STATES.ERROR;
        default:
            return null;
    }
}
