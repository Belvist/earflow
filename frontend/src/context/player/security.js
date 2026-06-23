import { normalizeGenreKey, formatTime } from './playbackRateUtils';

/**
 * Validates track metadata to ensure integrity and prevent data leakage.
 * @param {object} track Raw track data from API.
 * @returns {object|null} Validated track object.
 */
export function validateTrack(track) {
    if (!track || typeof track !== 'object') return null;

    const parseDurationSeconds = (value) => {
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) return Math.round(n);

        if (typeof value === 'string') {
            const m = value.trim().match(/^(\d+):(\d{1,2})$/);
            if (m) {
                const mm = Number(m[1]);
                const ss = Number(m[2]);
                if (Number.isFinite(mm) && mm >= 0 && Number.isFinite(ss) && ss >= 0 && ss < 60) {
                    return mm * 60 + ss;
                }
            }
        }

        return 0;
    };

    const durationSeconds =
        typeof track.durationSeconds === 'number' ? track.durationSeconds :
            typeof track.duration_seconds === 'number' ? track.duration_seconds :
                parseDurationSeconds(track.duration);

    const durationLabel = typeof track.duration === 'string' && track.duration.includes(':')
        ? track.duration
        : formatTime(durationSeconds);

    return {
        id: track.id ? String(track.id) : null,
        title: String(track.title || 'Unknown Title').slice(0, 255),
        artist: String(track.artist || 'Unknown Artist').slice(0, 255),
        duration: durationLabel,
        durationSeconds,
        genre: normalizeGenreKey(track.genre),
        album: typeof track.album === 'string' ? track.album.slice(0, 255) : (track.album ? String(track.album).slice(0, 255) : ''),
        cover_path: track.cover_path || track.coverPath || track.cover || null,
        updated_at: track.updated_at || null,
        reason: typeof track.reason === 'string' ? track.reason.slice(0, 200) : undefined,
    };
}

/**
 * Safely extracts the access token from the API client.
 * @param {object} apiClient API client instance.
 * @returns {string} The access token or an empty string.
 */
export function getSecureToken(apiClient) {
    if (typeof apiClient?.getAccessToken === 'function') {
        const token = apiClient.getAccessToken();
        return typeof token === 'string' ? token : '';
    }
    return '';
}

/**
 * Sanitizes URLs to prevent injection or invalid protocol usage.
 * @param {string} url The URL to sanitize.
 * @returns {string} Sanitized URL or empty string.
 */
export function sanitizeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    const allowedProtocols = ['http://', 'https://', 'data:audio/'];
    return allowedProtocols.some(p => url.startsWith(p)) ? url : '';
}
