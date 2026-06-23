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

function buildSearchQuery({ title, artist }) {
    const t = clampString(title, 200);
    const a = clampString(artist, 200);
    return clampString(`${t} ${a}`.trim(), 300);
}

function shouldRetryStatus(status) {
    const st = Number(status);
    return st === 429 || (st >= 500 && st <= 599);
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithTimeout(url, { headers, timeoutMs }) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        return await fetch(url, { method: 'GET', headers, signal: ctrl.signal });
    } finally {
        clearTimeout(t);
    }
}

function decodeHtmlEntities(input) {
    const s = typeof input === 'string' ? input : '';
    if (!s) return '';

    const named = s
        .replaceAll('&amp;', '&')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&#39;', "'")
        .replaceAll('&#x27;', "'");

    return named.replaceAll(/&#(\d+);/g, (_, n) => {
        const code = Number(n);
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
        try {
            return String.fromCodePoint(code);
        } catch {
            return '';
        }
    }).replaceAll(/&#x([0-9a-fA-F]+);/g, (_, hx) => {
        const code = Number.parseInt(hx, 16);
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
        try {
            return String.fromCodePoint(code);
        } catch {
            return '';
        }
    });
}

function stripHtmlToText(html) {
    const src = typeof html === 'string' ? html : '';
    if (!src) return '';

    const withBreaks = src
        .replaceAll(/<br\s*\/?\s*>/gi, '\n')
        .replaceAll(/<\/p\s*>/gi, '\n')
        .replaceAll(/<\/div\s*>/gi, '\n');

    const noTags = withBreaks.replaceAll(/<[^>]+>/g, '');
    const decoded = decodeHtmlEntities(noTags);

    return decoded
        .replaceAll('\r\n', '\n')
        .replaceAll('\r', '\n')
        .replaceAll(/\n{3,}/g, '\n\n')
        .trim();
}

function extractLyricsFromGeniusHtml(html) {
    const src = typeof html === 'string' ? html : '';
    if (!src) return '';

    const chunks = [];
    const re = /<div[^>]*data-lyrics-container="true"[^>]*>([\s\S]*?)<\/div>/gi;
    for (const match of src.matchAll(re)) {
        const part = stripHtmlToText(match[1]);
        if (part) chunks.push(part);
        if (chunks.length >= 40) break;
    }

    if (chunks.length === 0) return '';
    const joined = chunks.join('\n').replaceAll(/\n{3,}/g, '\n\n').trim();
    return clampString(joined, 50_000);
}

class GeniusClient {
    constructor(opts = {}) {
        this.accessToken = clampString(opts.accessToken, 300);
        this.baseUrl = clampString(opts.baseUrl, 300) || 'https://api.genius.com';
        this.timeoutMs = normalizePositiveInt(opts.timeoutMs) || 8000;
        this.userAgent = clampString(opts.userAgent, 160) || 'earflow-lyrics-service/1.0';
    }

    async _fetchJsonWithRetry(url, headers) {
        const maxAttempts = 3;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            const res = await fetchWithTimeout(url, { headers, timeoutMs: this.timeoutMs });
            if (shouldRetryStatus(res.status) && attempt < maxAttempts) {
                await sleepMs(200 * attempt);
                continue;
            }
            if (!res.ok) return null;
            try {
                return await res.json();
            } catch {
                return null;
            }
        }
        return null;
    }

    _pickFirstHit(data) {
        const hits = Array.isArray(data?.response?.hits) ? data.response.hits : [];
        for (const hit of hits) {
            const result = hit?.result;
            if (!result || typeof result !== 'object') continue;
            const id = normalizePositiveInt(result.id);
            const songUrl = clampString(result.url, 1000);
            if (id && songUrl) return { id, url: songUrl };
        }
        return null;
    }

    async searchSong({ title, artist }) {
        const q = buildSearchQuery({ title, artist });
        if (!q || !this.accessToken) return null;

        const url = `${this.baseUrl}/search?q=${encodeURIComponent(q)}`;
        const headers = {
            Accept: 'application/json',
            Authorization: `Bearer ${this.accessToken}`,
            'User-Agent': this.userAgent,
        };

        const data = await this._fetchJsonWithRetry(url, headers);
        return data ? this._pickFirstHit(data) : null;
    }

    async fetchLyricsTextByUrl(url) {
        const u = clampString(url, 1000);
        if (!u) return '';

        const headers = {
            Accept: 'text/html',
            'User-Agent': this.userAgent,
        };

        const res = await fetchWithTimeout(u, { headers, timeoutMs: this.timeoutMs });
        if (!res.ok) return '';

        let html;
        try {
            html = await res.text();
        } catch {
            return '';
        }

        return extractLyricsFromGeniusHtml(html);
    }
}

module.exports = {
    GeniusClient,
};
