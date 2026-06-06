const MAX_EVENTS = 800;

const events = [];
let sequence = 0;
let state = {};
const invariantViolations = [];

function isDiagnosticsEnabled() {
  if (typeof window === 'undefined') return false;
  if (process.env.NODE_ENV !== 'production') return true;
  try {
    return new URLSearchParams(window.location.search).has('gestureDebug');
  } catch {
    return false;
  }
}

function getNow() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return Math.round(performance.now() * 100) / 100;
  }
  return Date.now();
}

function exposeDiagnostics() {
  if (!isDiagnosticsEnabled()) return;
  window.__earflowGestureDiagnostics = {
    getEvents: () => events.slice(),
    getState: () => ({ ...state }),
    getInvariantViolations: () => invariantViolations.slice(),
    getSnapshot: () => ({ state: { ...state }, events: events.slice(), invariantViolations: invariantViolations.slice() }),
    clear: () => {
      events.length = 0;
      invariantViolations.length = 0;
      state = {};
    },
  };
}

export function recordInteractionEvent(type, payload = {}) {
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

export function updateInteractionState(payload = {}) {
  if (!isDiagnosticsEnabled()) return null;
  state = {
    ...state,
    ...payload,
    updatedAt: getNow(),
  };
  exposeDiagnostics();
  return state;
}

export function assertInteractionInvariant(name, condition, payload = {}) {
  if (!isDiagnosticsEnabled()) return true;
  if (condition) return true;
  const violation = recordInteractionEvent('gesture:invariant-violation', {
    invariant: name,
    ...payload,
  });
  if (violation) {
    invariantViolations.push(violation);
    if (invariantViolations.length > MAX_EVENTS) {
      invariantViolations.splice(0, invariantViolations.length - MAX_EVENTS);
    }
  }
  exposeDiagnostics();
  return false;
}

export function clearInteractionDiagnostics() {
  if (!isDiagnosticsEnabled()) return;
  events.length = 0;
  invariantViolations.length = 0;
  state = {};
  exposeDiagnostics();
}
