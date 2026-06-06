const DEFAULT_AUTH_ORIGIN = 'https://auth.earflow.ru';
const RECENT_LOGOUT_KEY = 'earflow:auth:recent_logout_at';
// Browser history/bfcache can restore protected pages minutes after explicit logout.
const RECENT_LOGOUT_SUPPRESS_MS = 30 * 60_000;

const getAuthOrigin = () => {
    const raw = typeof process !== 'undefined' ? process.env.REACT_APP_AUTH_ORIGIN : '';
    const candidate = typeof raw === 'string' ? raw.trim() : '';
    if (!candidate) return DEFAULT_AUTH_ORIGIN;
    try {
        const u = new URL(candidate);
        if (!u.origin || u.origin === 'null') return DEFAULT_AUTH_ORIGIN;
        return u.origin;
    } catch {
        return DEFAULT_AUTH_ORIGIN;
    }
};

export const sanitizeReturnTo = (raw) => {
    const fallback = 'https://earflow.ru/';
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) return fallback;

    try {
        const u = new URL(value);
        const host = u.hostname.toLowerCase();
        const isHttps = u.protocol === 'https:';

        if (host === 'auth.earflow.ru') {
            return fallback;
        }

        if (isHttps && (host === 'earflow.ru' || host.endsWith('.earflow.ru'))) {
            return u.toString();
        }

        if (!process.env.NODE_ENV || process.env.NODE_ENV !== 'production') {
            if ((u.protocol === 'http:' || u.protocol === 'https:') && (host === 'localhost' || host === '127.0.0.1')) {
                return u.toString();
            }
        }

        return fallback;
    } catch {
        return fallback;
    }
};

export const buildReturnToFromCurrentLocation = () => {
    if (typeof window === 'undefined') {
        return 'https://earflow.ru/';
    }
    return sanitizeReturnTo(window.location.href);
};

export const markRecentLogout = () => {
    try {
        if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem(RECENT_LOGOUT_KEY, String(Date.now()));
        }
    } catch {
    }
};

export const clearRecentLogout = () => {
    try {
        if (typeof sessionStorage !== 'undefined') {
            sessionStorage.removeItem(RECENT_LOGOUT_KEY);
        }
    } catch {
    }
};

export const shouldSuppressAuthRedirectAfterLogout = () => {
    try {
        if (typeof sessionStorage === 'undefined') return false;
        const raw = sessionStorage.getItem(RECENT_LOGOUT_KEY);
        const at = Number.parseInt(String(raw || ''), 10);
        if (!Number.isFinite(at) || at <= 0) return false;
        const age = Date.now() - at;
        if (age >= 0 && age <= RECENT_LOGOUT_SUPPRESS_MS) return true;
        sessionStorage.removeItem(RECENT_LOGOUT_KEY);
        return false;
    } catch {
        return false;
    }
};

export const redirectToAuth = (options = {}) => {
    if (typeof window === 'undefined') return;

    const opts = options && typeof options === 'object' ? options : {};
    const reason = opts.reason && typeof opts.reason === 'string' ? opts.reason.slice(0, 64) : '';
    if (!['require_auth', 'auth_lost', 'session_lost'].includes(reason)) {
        clearRecentLogout();
    }

    const authOrigin = getAuthOrigin();
    const returnTo = sanitizeReturnTo(opts.returnTo || buildReturnToFromCurrentLocation());
    const path = typeof opts.path === 'string' && opts.path.trim() ? opts.path.trim() : '/login';
    const url = new URL(path, authOrigin);
    url.searchParams.set('return_to', returnTo);

    if (reason) {
        url.searchParams.set('reason', reason);
    }

    const replace = opts.replace !== false;
    if (replace && typeof window.location.replace === 'function') {
        window.location.replace(url.toString());
        return;
    }
    window.location.assign(url.toString());
};

export const isAuthDomain = () => {
    if (typeof window === 'undefined') return false;
    const host = String(window.location.hostname || '').toLowerCase();
    return host === 'auth.earflow.ru';
};
