const SW_VERSION = 'v3.3.4-ios-nav-no-cache-v20';
const STATIC_CACHE = `static-${SW_VERSION}`;

const OFFLINE_FALLBACK_URL = '/offline.html';

const STATIC_ASSETS = [
    '/manifest.json',
    '/favicon.ico',
    '/favicon.svg',
    '/favicon-16x16.png',
    '/favicon-32x32.png',
    '/favicon-192.png',
    '/favicon-512.png',
    OFFLINE_FALLBACK_URL,
];

function isIosWebKit() {
    try {
        const ua = String(self?.navigator?.userAgent || '');
        const isAppleMobile = /iP(ad|hone|od)/.test(ua);
        const isWebKit = /AppleWebKit\//.test(ua);
        return isAppleMobile && isWebKit;
    } catch {
        return false;
    }
}

function isSameOrigin(url) {
    return url.origin === self.location.origin;
}

function isHttp(url) {
    return url.protocol === 'http:' || url.protocol === 'https:';
}

function shouldBypass(request, url) {
    if (request.method !== 'GET') return true;
    if (!isHttp(url)) return true;
    if (!isSameOrigin(url)) return true;

    if (url.pathname.startsWith('/api/')) return true;
    if (url.pathname.startsWith('/ws')) return true;
    if (url.pathname.startsWith('/socket.io/')) return true;
    if (url.pathname.startsWith('/media/')) return true;
    if (url.pathname.startsWith('/covers/')) return true;

    const range = request.headers.get('range');
    if (range) return true;

    const accept = request.headers.get('accept') || '';
    if (accept.includes('application/octet-stream')) return true;

    if (request.destination === 'audio') return true;

    const p = url.pathname.toLowerCase();
    if (p.endsWith('.mp3') || p.endsWith('.m4a') || p.endsWith('.wav') || p.endsWith('.flac')) return true;

    return false;
}

async function staleWhileRevalidate(request) {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(request);
    const networkTask = fetch(request)
        .then((resp) => {
            if (resp && resp.status === 200 && resp.type !== 'opaque') {
                cache.put(request, resp.clone()).catch(() => { });
            }
            return resp;
        })
        .catch(() => null);

    if (cached) return cached;
    const fromNetwork = await networkTask;
    if (fromNetwork) return fromNetwork;
    return Response.error();
}

async function networkFirst(request) {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(request);

    const fetchWithTimeout = async () => {
        if (isIosWebKit() || typeof AbortController !== 'function') {
            return await fetch(request, { cache: 'no-cache' });
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);
        try {
            return await fetch(request, {
                signal: controller.signal,
                cache: 'no-cache'
            });
        } finally {
            clearTimeout(timeoutId);
        }
    };

    try {
        const resp = await fetchWithTimeout();
        if (resp && resp.status === 200 && resp.type !== 'opaque') {
            cache.put(request, resp.clone()).catch(() => { });
        }
        return resp;
    } catch (e) {
        if (cached) return cached;
        const offlineFallback = await cache.match(OFFLINE_FALLBACK_URL);
        if (offlineFallback) {
            return new Response(offlineFallback.body, {
                status: 503,
                statusText: 'Offline',
                headers: { 'Content-Type': 'text/html; charset=utf-8' },
            });
        }
        return new Response('Service unavailable', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
    }
}

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then((cache) => {
                return Promise.all(
                    STATIC_ASSETS.map((asset) =>
                        fetch(asset, { cache: 'reload' })
                            .then((resp) => {
                                if (resp.ok) return cache.put(asset, resp);
                            })
                            .catch(() => { })
                    )
                );
            })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys
                    .filter((k) => k !== STATIC_CACHE)
                    .map((k) => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    let url;
    try {
        url = new URL(request.url);
    } catch {
        return;
    }

    // Never cache API, WS, or streaming chunks in Service Worker
    if (shouldBypass(request, url)) {
        return;
    }

    try {
        const acceptsHtml = request.headers.get('accept') || '';
        if (request.mode === 'navigate' || acceptsHtml.includes('text/html')) {
            if (isIosWebKit()) {
                // iOS Safari on SW with navigation requests can serve a stale
                // index.html from disk cache even though it points to hashed
                // chunks that were rotated. 'no-cache' forces a revalidate.
                // Fall back to networkFirst on fetch failure so that offline
                // still returns a fallback document instead of a blank page.
                event.respondWith(
                    fetch(request, { cache: 'no-cache' }).catch(() => networkFirst(request))
                );
                return;
            }
            event.respondWith(networkFirst(request));
            return;
        }

        if (url.pathname === '/mini-player-overrides.css') {
            event.respondWith(networkFirst(request));
            return;
        }

        if (STATIC_ASSETS.includes(url.pathname)) {
            event.respondWith(staleWhileRevalidate(request));
            return;
        }
    } catch {
        try {
            event.respondWith(fetch(request));
        } catch {
        }
    }
});

self.addEventListener('message', (event) => {
    const type = event?.data?.type;
    if (type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
