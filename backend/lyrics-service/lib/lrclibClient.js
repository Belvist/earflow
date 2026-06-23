'use strict';

function clampString(value, maxLen) {
    const s = typeof value === 'string' ? value : '';
    const t = s.trim();
    if (!t) return '';
    return t.length > maxLen ? t.slice(0, maxLen) : t;
}

function normalizePositiveInt(value) {
    const n = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function toQuery(params) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) {
        if (v === null || v === undefined) continue;
        const s = String(v).trim();
        if (!s) continue;
        usp.set(k, s);
    }
    const qs = usp.toString();
    return qs ? `?${qs}` : '';
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

function isAbortError(e) {
    const name = e && typeof e === 'object' ? e.name : '';
    const msg = e && typeof e === 'object' && typeof e.message === 'string' ? e.message : '';
    return name === 'AbortError' || /aborted/i.test(msg);
}

function isNetworkError(e) {
    return e instanceof TypeError;
}

function shouldRetryStatus(status) {
    const st = Number(status);
    return st === 429 || (st >= 500 && st <= 599);
}

async function fetchJsonAttempt({ url, userAgent, timeoutMs }) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'User-Agent': userAgent,
            },
            signal: ctrl.signal,
        });
        return res;
    } finally {
        clearTimeout(t);
    }
}

class LrcLibClient {
    constructor(opts = {}) {
        this.baseUrl = clampString(opts.baseUrl, 300) || 'https://lrclib.net/api';
        this.userAgent = clampString(opts.userAgent, 160) || 'earflow-lyrics-service/1.0';
        this.timeoutMs = normalizePositiveInt(opts.timeoutMs) || 8000;
    }

    async _fetchJson(path, params) {
        const url = `${this.baseUrl}${path}${toQuery(params)}`;
        const maxAttempts = 3;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                const res = await fetchJsonAttempt({ url, userAgent: this.userAgent, timeoutMs: this.timeoutMs });
                if (res.status === 404) {
                    return { ok: false, status: 404, data: null };
                }

                if (shouldRetryStatus(res.status) && attempt < maxAttempts) {
                    await sleepMs(200 * attempt);
                    continue;
                }

                const ct = (res.headers.get('content-type') || '').toLowerCase();
                const json = ct.includes('application/json') ? await res.json().catch(() => null) : null;
                return { ok: res.ok, status: res.status, data: json };
            } catch (e) {
                if (attempt < maxAttempts && (isAbortError(e) || isNetworkError(e))) {
                    await sleepMs(200 * attempt);
                    continue;
                }
                throw e;
            }
        }

        return { ok: false, status: 0, data: null };
    }

    async getCachedLyrics({ trackName, artistName, albumName, durationSeconds }) {
        const dur = normalizePositiveInt(durationSeconds);
        const tn = clampString(trackName, 200);
        const an = clampString(artistName, 200);
        const al = clampString(albumName, 200);
        if (!tn || !an || !dur) return null;

        const res = await this._fetchJson('/get-cached', {
            track_name: tn,
            artist_name: an,
            ...(al ? { album_name: al } : {}),
            duration: dur,
        });

        if (res.status === 0 || res.status === 429 || (res.status >= 500 && res.status <= 599)) {
            throw new Error(`LRCLIB_HTTP_${res.status || 0}`);
        }

        if (!res.ok || res.status !== 200) return null;
        return res.data && typeof res.data === 'object' ? res.data : null;
    }

    async searchLyrics({ trackName, artistName, albumName }) {
        const tn = clampString(trackName, 200);
        if (!tn) return [];

        const an = clampString(artistName, 200);
        const al = clampString(albumName, 200);

        const res = await this._fetchJson('/search', {
            track_name: tn,
            ...(an ? { artist_name: an } : {}),
            ...(al ? { album_name: al } : {}),
        });

        if (res.status === 0 || res.status === 429 || (res.status >= 500 && res.status <= 599)) {
            throw new Error(`LRCLIB_HTTP_${res.status || 0}`);
        }

        if (!res.ok || res.status !== 200) return [];
        return Array.isArray(res.data) ? res.data : [];
    }

    async getLyricsById(lrclibId) {
        const id = normalizePositiveInt(lrclibId);
        if (!id) return null;

        const res = await this._fetchJson(`/get/${id}`, {});
        if (res.status === 0 || res.status === 429 || (res.status >= 500 && res.status <= 599)) {
            throw new Error(`LRCLIB_HTTP_${res.status || 0}`);
        }
        if (!res.ok || res.status !== 200) return null;
        return res.data && typeof res.data === 'object' ? res.data : null;
    }
}

module.exports = {
    LrcLibClient,
};
