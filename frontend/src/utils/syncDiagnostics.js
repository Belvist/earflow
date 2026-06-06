const MAX_EVENTS = 1000;

const events = [];
let sequence = 0;
let state = {};

function isDiagnosticsEnabled() {
    return typeof window !== 'undefined' && process.env.NODE_ENV !== 'production';
}

function getNow() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return Math.round(performance.now() * 100) / 100;
    }
    return Date.now();
}

function exposeDiagnostics() {
    if (!isDiagnosticsEnabled()) return;
    window.__earflowSyncDiagnostics = {
        getEvents: () => events.slice(),
        getState: () => ({ ...state }),
        getSnapshot: () => ({ state: { ...state }, events: events.slice() }),
        clear: () => {
            events.length = 0;
            state = {};
        },
    };
}

export function recordSyncEvent(type, payload = {}) {
    if (!isDiagnosticsEnabled()) return null;
    const entry = {
        id: ++sequence,
        at: getNow(),
        type,
        ...payload,
    };
    events.push(entry);
    if (events.length > MAX_EVENTS) {
        events.splice(0, events.length - MAX_EVENTS);
    }
    exposeDiagnostics();
    return entry;
}

export function updateSyncDiagnosticsState(payload = {}) {
    if (!isDiagnosticsEnabled()) return null;
    state = {
        ...state,
        ...payload,
        updatedAt: getNow(),
    };
    exposeDiagnostics();
    return state;
}

export function clearSyncDiagnostics() {
    if (!isDiagnosticsEnabled()) return;
    events.length = 0;
    state = {};
    exposeDiagnostics();
}
