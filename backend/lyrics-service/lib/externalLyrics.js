'use strict';

const db = require('./database');
const { plainTextToSyncedLines } = require('./plainLyrics');
const { GeniusClient } = require('./geniusClient');

function parsePositiveInt(value) {
    const n = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function clampDurationMs(v, minMs, maxMs) {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    const ms = Math.floor(n);
    if (ms < minMs) return minMs;
    if (ms > maxMs) return maxMs;
    return ms;
}

const NOT_FOUND_TTL_MS = (() => {
    const v = clampDurationMs(process.env.LYRICS_EXTERNAL_NOT_FOUND_TTL_MS, 60_000, 30 * 24 * 60 * 60 * 1000);
    return v ?? 7 * 24 * 60 * 60 * 1000;
})();

function shouldSkipByCache(cache) {
    const c = cache && typeof cache === 'object' ? cache : null;
    if (!c) return false;

    const now = Date.now();
    const retryAfterAtRaw = c.retryAfterAt instanceof Date ? c.retryAfterAt.getTime() : null;
    const lastAttemptAt = c.lastAttemptAt instanceof Date ? c.lastAttemptAt.getTime() : null;
    const status = typeof c.status === 'string' ? c.status : '';

    const boundedRetryAfterAt = (() => {
        if (!retryAfterAtRaw) return null;
        if (!lastAttemptAt) return retryAfterAtRaw;
        if (status !== 'not_found') return retryAfterAtRaw;
        const cap = lastAttemptAt + NOT_FOUND_TTL_MS;
        return Math.min(retryAfterAtRaw, cap);
    })();

    if (boundedRetryAfterAt && now < boundedRetryAfterAt) return true;

    if (status === 'not_found' && lastAttemptAt && now - lastAttemptAt < NOT_FOUND_TTL_MS) {
        return true;
    }

    if (status === 'error' && lastAttemptAt && now - lastAttemptAt < 10 * 60 * 1000) {
        return true;
    }

    return false;
}

function clampString(value, maxLen) {
    const s = typeof value === 'string' ? value : '';
    const t = s.trim();
    if (!t) return '';
    return t.length > maxLen ? t.slice(0, maxLen) : t;
}

const geniusClient = (() => {
    const token = clampString(process.env.GENIUS_ACCESS_TOKEN, 400);
    if (!token) return null;
    return new GeniusClient({
        accessToken: token,
        baseUrl: process.env.GENIUS_BASE_URL,
        timeoutMs: process.env.LYRICS_EXTERNAL_TIMEOUT_MS,
        userAgent: process.env.LYRICS_EXTERNAL_USER_AGENT,
    });
})();

async function fetchFromGenius(meta) {
    if (!geniusClient) return null;
    const title = typeof meta?.title === 'string' ? meta.title : '';
    const artist = typeof meta?.artist === 'string' ? meta.artist : '';
    const hit = await geniusClient.searchSong({ title, artist });
    if (!hit) return null;
    const text = await geniusClient.fetchLyricsTextByUrl(hit.url);
    if (!text) return null;
    return { id: hit.id, url: hit.url, plainText: text };
}

async function getOrFetchLyrics({ songId }) {
    const sid = parsePositiveInt(songId);
    if (!sid) return null;

    const existing = await db.getLyricsBySongId(sid);
    if (existing) return existing;

    const cache = await db.getLyricsExternalCache(sid);
    if (shouldSkipByCache(cache)) return null;

    if (!geniusClient) return null;

    const meta = await db.getSongMetadata(sid);
    if (!meta) return null;

    let payload;
    try {
        payload = await fetchFromGenius(meta);
    } catch (e) {
        const now = new Date();
        const retryAfterAt = new Date(now.getTime() + 10 * 60 * 1000);
        await db.upsertLyricsExternalCache({
            songId: sid,
            provider: 'genius',
            status: 'error',
            retryAfterAt,
            lastError: e && typeof e === 'object' && typeof e.message === 'string' ? e.message : 'external_fetch_failed',
        });
        return null;
    }

    const plainText = payload && typeof payload === 'object' ? payload.plainText : '';
    if (!plainText) {
        const now = new Date();
        const retryAfterAt = new Date(now.getTime() + NOT_FOUND_TTL_MS);
        await db.upsertLyricsExternalCache({
            songId: sid,
            provider: 'genius',
            status: 'not_found',
            retryAfterAt,
            lastError: null,
        });
        return null;
    }

    const lines = plainTextToSyncedLines({ plainText, durationSeconds: meta.duration });
    if (!Array.isArray(lines) || lines.length === 0) {
        const now = new Date();
        const retryAfterAt = new Date(now.getTime() + NOT_FOUND_TTL_MS);
        await db.upsertLyricsExternalCache({
            songId: sid,
            provider: 'genius',
            status: 'not_found',
            retryAfterAt,
            lastError: null,
        });
        return null;
    }

    const externalId = payload && payload.id != null ? String(payload.id) : null;
    const stored = await db.createLyrics({
        songId: sid,
        lines,
        language: 'und',
        createdBy: null,
        source: 'genius',
        externalProvider: 'genius',
        externalId,
        externalFetchedAt: new Date(),
    });

    await db.upsertLyricsExternalCache({
        songId: sid,
        provider: 'genius',
        status: 'ok',
        retryAfterAt: null,
        lastError: null,
    });

    return stored;
}

module.exports = {
    getOrFetchLyrics,
};
