export function normalizeGenreKey(value) {
    if (!value || typeof value !== 'string') return null;
    const trimmed = value.trim().toLowerCase();
    if (!trimmed || trimmed.length > 100) return null;
    return trimmed;
}

export function clampPlaybackRate(value) {
    const rate = Number(value);
    if (!Number.isFinite(rate)) return 1;
    return Math.min(2, Math.max(0.5, rate));
}

export function formatTime(time) {
    const t = Number(time);
    if (!Number.isFinite(t) || t < 0) return "0:00";
    const minutes = Math.floor(t / 60);
    const seconds = Math.floor(t % 60);
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function parseDurationSeconds(value) {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') {
        return Number.isFinite(value) && value > 0 ? value : 0;
    }
    const raw = String(value).trim();
    if (!raw) return 0;
    if (/^\d+(?::\d{1,2}){1,2}$/.test(raw)) {
        const parts = raw.split(':').map((p) => Number.parseInt(p, 10));
        if (parts.some((p) => !Number.isFinite(p) || p < 0)) return 0;
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Fallback duration from track metadata when audio element has not reported duration yet. */
export function resolveTrackDurationSeconds(track) {
    if (!track || typeof track !== 'object') return 0;
    const seconds =
        parseDurationSeconds(track.durationSeconds) ||
        parseDurationSeconds(track.duration_seconds) ||
        parseDurationSeconds(track.duration_sec) ||
        parseDurationSeconds(track.duration);
    if (seconds > 0) return seconds;
    const ms = Number(track.durationMs ?? track.duration_ms);
    return Number.isFinite(ms) && ms > 0 ? ms / 1000 : 0;
}
