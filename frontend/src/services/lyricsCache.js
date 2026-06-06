import apiClient from '../api/client';
import { normalizeLyricTextForDisplay } from '../utils/lyricsText';

const RETRY_DELAY_MS = 3000;
const MAX_RETRIES = 2;
const CACHE_MAX_SIZE = 60;

function normalizeLines(rawLines) {
    const list = Array.isArray(rawLines) ? rawLines : [];
    return list
        .map((l) => {
            const line = l && typeof l === 'object' ? l : null;
            const rawText = line && typeof line.text === 'string' ? line.text : '';
            const text = normalizeLyricTextForDisplay(rawText);
            const startTime = Number(line?.startTime);
            const endTime = Number(line?.endTime);
            const words = Array.isArray(line?.words) ? line.words : [];
            return {
                text,
                startTime: Number.isFinite(startTime) ? Math.max(0, startTime) : 0,
                endTime: Number.isFinite(endTime) ? Math.max(0, endTime) : 0,
                words: words
                    .map((w) => {
                        const ww = w && typeof w === 'object' ? w : null;
                        const wtRaw = ww && typeof ww.text === 'string' ? ww.text : '';
                        const wt = normalizeLyricTextForDisplay(wtRaw);
                        const ws = Number(ww?.startTime);
                        const we = Number(ww?.endTime);
                        return {
                            text: wt,
                            ...(Number.isFinite(ws) ? { startTime: Math.max(0, ws) } : {}),
                            ...(Number.isFinite(we) ? { endTime: Math.max(0, we) } : {}),
                        };
                    })
                    .filter((w) => w?.text),
            };
        })
        .filter((l) => l && (l.text || (l.words?.length > 0)));
}

function normalizeResponse(sid, raw) {
    const lines = normalizeLines(raw?.lines);
    const lyrics = raw && typeof raw === 'object'
        ? { ...raw, lines }
        : { songId: Number(sid) || sid, language: 'ru', lines };
    return { lyrics, hasLyrics: lines.length > 0 };
}

const cache = new Map();
const inflight = new Map();
const listeners = new Set();
let version = 0;

function evictOldest() {
    if (cache.size <= CACHE_MAX_SIZE) return;
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
}

function emit() {
    version += 1;
    for (const fn of listeners) {
        try { fn(); } catch { /* listener error isolated */ }
    }
}

function getSnapshot(sid) {
    if (!sid) return { loading: false, lyrics: null, hasLyrics: false };
    const entry = cache.get(sid);
    if (entry) return { loading: false, ...entry };
    if (inflight.has(sid)) return { loading: true, lyrics: null, hasLyrics: false };
    return { loading: false, lyrics: null, hasLyrics: false };
}

async function fetchLyrics(sid, signal) {
    const raw = await apiClient.getLyrics(sid, { signal });
    if (signal.aborted) return null;
    return normalizeResponse(sid, raw);
}

function request(sid) {
    if (!sid) return;
    if (cache.has(sid)) return;
    if (inflight.has(sid)) return;

    const ctrl = new AbortController();
    inflight.set(sid, ctrl);
    emit();

    (async () => {
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
            if (ctrl.signal.aborted) return;
            try {
                const result = await fetchLyrics(sid, ctrl.signal);
                if (ctrl.signal.aborted) return;
                if (result) {
                    cache.set(sid, result);
                    evictOldest();
                    inflight.delete(sid);
                    emit();
                    return;
                }
            } catch {
                if (ctrl.signal.aborted) return;
                if (attempt < MAX_RETRIES) {
                    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
                }
            }
        }
        inflight.delete(sid);
        emit();
    })();
}

function cancel(sid) {
    const ctrl = inflight.get(sid);
    if (!ctrl) return;
    try { ctrl.abort(); } catch { /* safe */ }
    inflight.delete(sid);
}

function subscribe(fn) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}

function getVersion() {
    return version;
}

function invalidate(sid) {
    if (sid) {
        cancel(sid);
        cache.delete(sid);
        emit();
    }
}

export const lyricsCache = {
    getSnapshot,
    request,
    cancel,
    subscribe,
    getVersion,
    invalidate,
};
