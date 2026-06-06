const getRuntimeOrigin = () => {
    try {
        if (typeof window === 'undefined') return '';
        return window.location?.origin || '';
    } catch {
        return '';
    }
};

const deriveSafeDefaultOrigin = () => {
    const fallback = 'https://api.earflow.ru';

    try {
        const origin = String(runtimeOrigin || '').trim();
        if (!origin) return fallback;

        const u = new URL(origin);
        const host = (u.hostname || '').toLowerCase();
        if (!host) return fallback;

        const sameOriginAllowed = host === 'localhost'
            || host === '127.0.0.1'
            || host === '0.0.0.0';

        return sameOriginAllowed ? u.origin : fallback;
    } catch {
        return fallback;
    }
};

const deriveSafeDefaultStreamingOrigin = () => {
    try {
        const origin = String(runtimeOrigin || '').trim();
        if (origin) {
            const u = new URL(origin);
            const host = (u.hostname || '').toLowerCase();
            if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') {
                return u.origin;
            }
        }
    } catch {
    }
    return 'https://strmhaha.earflow.ru';
};

const normalizeConfiguredBaseUrl = (raw) => {
    const cleaned = String(raw || '').trim().replace(/\/+$/, '');
    if (!cleaned) return '';

    const withoutApiSuffix = cleaned.endsWith('/api') ? cleaned.slice(0, -4) : cleaned;
    if (!withoutApiSuffix || withoutApiSuffix.startsWith('/')) return '';

    try {
        const u = new URL(withoutApiSuffix);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
        return u.origin;
    } catch {
        return '';
    }
};

export const runtimeOrigin = getRuntimeOrigin();

const getRuntimeConfigValue = (key) => {
    try {
        if (typeof window === 'undefined') return '';
        const cfg = window.__EARFLOW_RUNTIME_CONFIG__;
        if (!cfg || typeof cfg !== 'object') return '';
        const v = cfg[key];
        return typeof v === 'string' ? v : '';
    } catch {
        return '';
    }
};

const rawConfiguredBaseUrl = (getRuntimeConfigValue('apiBaseUrl') || process.env.REACT_APP_API_URL || '').trim();
const rawConfiguredStreamingUrl = (
    getRuntimeConfigValue('streamingBaseUrl')
    || process.env.REACT_APP_STREAMING_API_URL
    || process.env.REACT_APP_STREAMING_URL
    || ''
).trim();

const rawEnableDirectStream = (getRuntimeConfigValue('enableDirectStream') || process.env.REACT_APP_ENABLE_DIRECT_STREAM || '').trim();

const normalizedBaseUrl = normalizeConfiguredBaseUrl(rawConfiguredBaseUrl);
const normalizedStreamingUrl = normalizeConfiguredBaseUrl(rawConfiguredStreamingUrl);

const safeDefaultOrigin = deriveSafeDefaultOrigin();
const safeDefaultStreamingOrigin = deriveSafeDefaultStreamingOrigin();

export const API_BASE_URL = normalizedBaseUrl || safeDefaultOrigin;
export const STREAMING_BASE_URL = normalizedStreamingUrl || safeDefaultStreamingOrigin;

export const ENABLE_DIRECT_STREAM = (() => {
    const v = String(rawEnableDirectStream || '').trim().toLowerCase();
    if (!v) return true;
    if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
    return true;
})();

// Device Sync feature flag (Spotify Connect-like). Runtime-first so ops can
// toggle without a fresh build: the docker entrypoint injects
// `window.__EARFLOW_RUNTIME_CONFIG__.deviceSyncEnabled`; dev falls back to
// `REACT_APP_DEVICE_SYNC_ENABLED`. Default — OFF.
const rawDeviceSyncEnabled = (getRuntimeConfigValue('deviceSyncEnabled') || process.env.REACT_APP_DEVICE_SYNC_ENABLED || '').trim();

export const DEVICE_SYNC_ENABLED = (() => {
    const v = String(rawDeviceSyncEnabled || '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
})();
