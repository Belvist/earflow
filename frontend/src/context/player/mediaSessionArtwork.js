const EXT_TO_MIME = Object.freeze({
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.avif': 'image/avif',
    '.gif': 'image/gif',
});

const DEFAULT_MIME = 'image/jpeg';

const ARTWORK_SIZES = Object.freeze(['256x256', '512x512']);

const PRELOAD_TIMEOUT_MS = 2500;

const preloadCache = new Map();
const PRELOAD_CACHE_MAX = 32;

export function getArtworkMimeType(url) {
    if (typeof url !== 'string' || !url) return DEFAULT_MIME;
    try {
        const parsed = new URL(url, 'http://_');
        const path = String(parsed.pathname || '').toLowerCase();
        for (const ext of Object.keys(EXT_TO_MIME)) {
            if (path.endsWith(ext)) return EXT_TO_MIME[ext];
        }
    } catch {
    }
    const lower = String(url).toLowerCase();
    const qIdx = lower.indexOf('?');
    const head = qIdx === -1 ? lower : lower.slice(0, qIdx);
    for (const ext of Object.keys(EXT_TO_MIME)) {
        if (head.endsWith(ext)) return EXT_TO_MIME[ext];
    }
    return DEFAULT_MIME;
}

export function buildArtworkEntries(url) {
    if (typeof url !== 'string' || !url) return [];
    const type = getArtworkMimeType(url);
    return ARTWORK_SIZES.map((sizes) => ({ src: url, sizes, type }));
}

function touchCacheEntry(key) {
    if (!preloadCache.has(key)) return;
    const value = preloadCache.get(key);
    preloadCache.delete(key);
    preloadCache.set(key, value);
}

function storeCacheEntry(key, value) {
    if (preloadCache.has(key)) preloadCache.delete(key);
    preloadCache.set(key, value);
    while (preloadCache.size > PRELOAD_CACHE_MAX) {
        const firstKey = preloadCache.keys().next().value;
        if (firstKey === undefined) break;
        preloadCache.delete(firstKey);
    }
}

export function preloadArtwork(url, { timeoutMs = PRELOAD_TIMEOUT_MS } = {}) {
    if (typeof url !== 'string' || !url) {
        return Promise.resolve(false);
    }
    if (typeof window === 'undefined' || typeof Image !== 'function') {
        return Promise.resolve(true);
    }

    if (preloadCache.has(url)) {
        touchCacheEntry(url);
        const value = preloadCache.get(url);
        if (value && typeof value.then === 'function') return value;
        return Promise.resolve(!!value);
    }

    const promise = new Promise((resolve) => {
        let settled = false;
        let timerId = 0;

        const finalize = (ok) => {
            if (settled) return;
            settled = true;
            if (timerId) {
                try { clearTimeout(timerId); } catch { }
                timerId = 0;
            }
            try {
                img.onload = null;
                img.onerror = null;
                img.onabort = null;
            } catch { }
            storeCacheEntry(url, !!ok);
            resolve(!!ok);
        };

        const img = new Image();
        try {
            img.decoding = 'async';
        } catch { }
        try {
            img.loading = 'eager';
        } catch { }
        try {
            img.referrerPolicy = 'no-referrer';
        } catch { }

        img.onload = () => finalize(true);
        img.onerror = () => finalize(false);
        img.onabort = () => finalize(false);

        try {
            img.src = url;
        } catch {
            finalize(false);
            return;
        }

        try {
            timerId = setTimeout(() => finalize(false), Math.max(500, Math.min(10_000, Number(timeoutMs) || PRELOAD_TIMEOUT_MS)));
        } catch {
        }
    });

    storeCacheEntry(url, promise);
    promise.then((ok) => storeCacheEntry(url, !!ok), () => storeCacheEntry(url, false));
    return promise;
}

export function resolveAlbumLabel(track, queueName) {
    const rawAlbum = track && typeof track.album === 'string' ? track.album.trim() : '';
    if (rawAlbum) return rawAlbum.slice(0, 255);

    const rawRelease = track && typeof track.release === 'string' ? track.release.trim() : '';
    if (rawRelease) return rawRelease.slice(0, 255);

    const rawQueue = typeof queueName === 'string' ? queueName.trim() : '';
    return rawQueue ? rawQueue.slice(0, 255) : '';
}
