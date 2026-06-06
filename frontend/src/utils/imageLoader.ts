/**
 * Result of a canvas-safe image load.
 *
 * `image` can be drawn to a canvas and its pixel data read via
 * `getImageData()` without triggering a SecurityError.
 *
 * `revoke()` must be called once the image is no longer needed so that
 * any underlying object URL is released. It is always safe to call.
 */
export type ImageLoadResult = {
    image: HTMLImageElement;
    revoke: () => void;
};

/**
 * Load an image so that canvas pixel operations are permitted.
 *
 * The browser caches plain `<img>` requests separately from CORS requests.
 * If the page already loaded the cover as a regular `<img src=...>`, a
 * later `<img crossOrigin="anonymous">` for the same URL may be served
 * from the cached non-CORS entry and produce a tainted canvas. To avoid
 * that we try two independent strategies:
 *
 *  1. `fetch` → `Blob` → `URL.createObjectURL`. Blob URLs are always
 *     same-origin from the canvas' perspective, so `getImageData()` is
 *     permitted as long as the fetch itself succeeds (which only needs
 *     standard CORS on the image endpoint).
 *  2. `<img crossOrigin="anonymous">` with a cache-busting query string.
 *     This forces a fresh HTTP request, bypassing any cached non-CORS
 *     entry, and stores the response in the CORS-enabled image cache.
 *
 * Returns `null` if both strategies fail. Callers must treat that as
 * "unknown color" and fall back to their default styling.
 */
export async function loadImageForCanvas(url: string): Promise<ImageLoadResult | null> {
    if (!url) return null;

    const viaFetch = await loadViaFetch(url);
    if (viaFetch) return viaFetch;

    const viaCrossOriginImage = await loadViaCrossOriginImage(url);
    if (viaCrossOriginImage) return viaCrossOriginImage;

    return null;
}

async function loadViaFetch(url: string): Promise<ImageLoadResult | null> {
    if (typeof fetch !== 'function') return null;
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;

    let response: Response;
    try {
        response = await fetch(url, {
            method: 'GET',
            mode: 'cors',
            credentials: 'omit',
            cache: 'default',
            redirect: 'follow',
            referrerPolicy: 'no-referrer',
        });
    } catch {
        return null;
    }

    if (!response.ok) return null;

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (contentType && !contentType.startsWith('image/')) return null;

    let blob: Blob;
    try {
        blob = await response.blob();
    } catch {
        return null;
    }
    if (!blob || blob.size === 0) return null;

    const objectUrl = URL.createObjectURL(blob);
    try {
        const image = await decodeImage(objectUrl, null);
        return {
            image,
            revoke: () => {
                try { URL.revokeObjectURL(objectUrl); } catch { /* already revoked */ }
            },
        };
    } catch {
        try { URL.revokeObjectURL(objectUrl); } catch { /* already revoked */ }
        return null;
    }
}

async function loadViaCrossOriginImage(url: string): Promise<ImageLoadResult | null> {
    if (typeof Image === 'undefined') return null;

    const bustedUrl = appendQueryParam(url, '_accent', '1');
    try {
        const image = await decodeImage(bustedUrl, 'anonymous');
        return { image, revoke: () => undefined };
    } catch {
        return null;
    }
}

function decodeImage(src: string, crossOrigin: '' | 'anonymous' | 'use-credentials' | null): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        if (crossOrigin !== null) {
            img.crossOrigin = crossOrigin;
        }
        img.decoding = 'async';

        const cleanup = () => {
            img.onload = null;
            img.onerror = null;
        };
        img.onload = () => { cleanup(); resolve(img); };
        img.onerror = () => { cleanup(); reject(new Error('IMG_LOAD_FAILED')); };

        img.src = src;
    });
}

function appendQueryParam(url: string, key: string, value: string): string {
    const encodedKey = encodeURIComponent(key);
    const encodedValue = encodeURIComponent(value);
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}${encodedKey}=${encodedValue}`;
}
