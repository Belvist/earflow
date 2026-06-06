import { loadConfig } from './config';
import { createS3Client, getObjectBytesCapped, headBucket, headObjectMeta } from './storage/s3';
import { parseCookies, serializeCookie } from './http/cookies';
import { parseRangeHeader } from './http/range';
import { badRequest, forbidden, jsonResponse, notFound, serverError, textResponse, unauthorized } from './http/responses';
import { getRedis } from './redis/client';
import { consumeTokenBucket } from './redis/rateLimit';
import type { EbapManifest } from './ebap/manifest';
import { parseEbapManifest } from './ebap/manifest';
import { createHlsCookieValue, parseHlsCookieValue } from './auth/hlsCookie';
import { createHlsUrlToken, parseHlsUrlToken } from './auth/hlsUrlToken';
import { createServiceTokenManager } from './auth/serviceToken';
import { hlsKeyForFile } from './hls/build';
import { rewriteM3u8WithTokens } from './hls/m3u8Rewrite';
import { base64ToBytes, bytesToBase64, bytesToBase64Url, base64UrlToBytes } from './lib/base64';
import { concatBytes, toArrayBuffer, utf8Bytes } from './lib/bytes';
import { incCounter, renderPrometheus } from './metrics';
import { logError } from './observability/logger';
import { createRequestId } from './observability/requestId';

declare const Bun: {
    serve: (params: { port: number; fetch: (req: Request) => Response | Promise<Response> }) => unknown;
};

const cfg = loadConfig();
const serviceTokenManager = createServiceTokenManager(cfg.serviceToken);
const s3 = createS3Client({
    endpoint: cfg.minio.endpoint,
    port: cfg.minio.port,
    useSsl: cfg.minio.useSsl,
    accessKeyId: cfg.minio.accessKeyId,
    secretAccessKey: cfg.minio.secretAccessKey,
});

type ManifestHashCacheEntry = { manifestHash8B64Url: string; expiresAtMs: number };
const manifestHashCache = new Map<string, ManifestHashCacheEntry>();
const manifestHashCacheTtlMs = 60 * 60_000;
const manifestHashRedisTtlSeconds = 24 * 60 * 60;
const manifestHashCacheMaxEntries = 10_000;

function manifestCacheKey(trackId: number, etag: string): string {
    const safeTrackId = Number(trackId) >>> 0;
    const safeEtag = String(etag || '').trim();
    return `${safeTrackId}|${safeEtag}`;
}

function redisManifestHashKey(trackId: number, etag: string): string {
    const safeTrackId = Number(trackId) >>> 0;
    const safeEtag = String(etag || '').trim();
    return `ebap:hls:manifesthash8:${safeTrackId}:${safeEtag}`;
}

function readManifestHashCache(trackId: number, etag: string): string | null {
    const k = manifestCacheKey(trackId, etag);
    const entry = manifestHashCache.get(k);
    if (!entry) return null;
    if (Date.now() > entry.expiresAtMs) {
        manifestHashCache.delete(k);
        return null;
    }
    return entry.manifestHash8B64Url;
}

function writeManifestHashCache(trackId: number, etag: string, manifestHash8B64Url: string): void {
    const k = manifestCacheKey(trackId, etag);
    const v = String(manifestHash8B64Url || '').trim();
    if (!v) return;

    if (manifestHashCache.size >= manifestHashCacheMaxEntries) {
        const evictCount = Math.max(1, Math.floor(manifestHashCacheMaxEntries * 0.1));
        let evicted = 0;
        for (const key of manifestHashCache.keys()) {
            manifestHashCache.delete(key);
            evicted += 1;
            if (evicted >= evictCount) break;
        }
    }
    manifestHashCache.set(k, { manifestHash8B64Url: v, expiresAtMs: Date.now() + manifestHashCacheTtlMs });
}

async function getManifestHash8ForSession(trackId: number): Promise<string> {
    const key = `${cfg.minio.manifestPrefix}${trackId}.json`;
    const meta = await headObjectMeta({ s3, bucket: cfg.minio.bucketEbap, key, timeoutMs: cfg.minio.s3TimeoutMs });
    const etag = meta?.etag;

    if (etag) {
        const cached = readManifestHashCache(trackId, etag);
        if (cached) return cached;

        try {
            const redis = await getRedis(cfg);
            const raw = await redis.get(redisManifestHashKey(trackId, etag));
            const v = raw && String(raw).trim() ? String(raw).trim() : '';
            if (v) {
                writeManifestHashCache(trackId, etag, v);
                return v;
            }
        } catch {
        }
    }

    const m = await loadEbapManifest(trackId);
    if (etag) {
        writeManifestHashCache(trackId, etag, m.manifestHash8B64Url);
        try {
            const redis = await getRedis(cfg);
            await redis.setEx(redisManifestHashKey(trackId, etag), manifestHashRedisTtlSeconds, m.manifestHash8B64Url);
        } catch {
        }
    }

    return m.manifestHash8B64Url;
}

function cacheControlForAsset(fileName: string): string {
    const lower = String(fileName || '').toLowerCase();
    if (lower.endsWith('.m3u8')) return 'private, no-store';
    if (lower === 'ready.json') return 'private, no-store';
    if (lower.endsWith('.m4s')) return 'private, no-store';
    if (lower.endsWith('init.mp4')) return 'private, no-store';
    return 'private, no-store';
}

function cacheControlForAssetAccess(fileName: string, access: HlsAccess): string {
    const lower = String(fileName || '').toLowerCase();
    if (lower.endsWith('.m3u8')) return 'private, no-store';
    if (lower === 'ready.json') return 'private, no-store';

    if (access.auth === 'token' && cfg.signedUrls.enabled) {
        if (lower.endsWith('.m4s')) return 'public, max-age=31536000, immutable';
        if (lower.endsWith('.mp4')) return 'public, max-age=31536000, immutable';
    }

    return 'private, no-store';
}

function getCrypto(): Crypto | null {
    const c: any = (globalThis as any).crypto;
    if (!c) return null;
    if (!c.subtle || typeof c.subtle.importKey !== 'function') return null;
    if (typeof c.getRandomValues !== 'function') return null;
    return c as Crypto;
}

function randomBytes(len: number): Uint8Array {
    const n = Math.max(0, Math.trunc(len));
    const out = new Uint8Array(n);
    const c = getCrypto();
    if (!c) return out;
    return c.getRandomValues(out);
}

async function lyricsKeyIdFromCookieValue(cookieValue: string): Promise<string> {
    const c = getCrypto();
    if (!c) return '';
    const msg = utf8Bytes(String(cookieValue || ''));
    const digest = await c.subtle.digest('SHA-256', toArrayBuffer(msg));
    return bytesToBase64Url(new Uint8Array(digest));
}

function redisLyricsKey(kid: string): string {
    const safe = String(kid || '').trim() || 'empty';
    return `ebap:hls:lyricskey:${safe}`;
}

async function fetchJsonWithTimeout(params: {
    url: string;
    headers: Record<string, string>;
    timeoutMs: number;
}): Promise<{ ok: true; status: number; json: any } | { ok: false; status: number }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1, Math.trunc(params.timeoutMs)));

    try {
        const res = await fetch(params.url, {
            method: 'GET',
            headers: params.headers,
            signal: controller.signal,
        });

        if (!res.ok) {
            return { ok: false, status: res.status };
        }

        const json = await res.json().catch(() => null);
        return { ok: true, status: res.status, json };
    } catch {
        return { ok: false, status: 0 };
    } finally {
        clearTimeout(timeout);
    }
}

async function handleLyrics(req: Request, requestId: string): Promise<Response> {
    if (req.method !== 'GET') return textResponse(405, 'Method not allowed');

    const cookies = parseCookies(req.headers.get('cookie'));
    const mpLyrics = cookies['mp_lyrics'] ? String(cookies['mp_lyrics']) : '';
    const claims = parseHlsCookieValue({ secrets: cfg.cookie.secrets, cookieValue: mpLyrics, nowMs: Date.now() });
    if (!claims) return unauthorized();

    const trackId = claims.trackId >>> 0;
    if (!Number.isInteger(trackId) || trackId <= 0) return unauthorized();

    const headers = new Headers();
    headers.set('cache-control', 'private, no-store');

    let serviceToken = '';
    try {
        serviceToken = await serviceTokenManager.getToken();
    } catch {
        return new Response(null, { status: 204, headers });
    }
    if (!serviceToken) return new Response(null, { status: 204, headers });

    const url = `${cfg.lyricsServiceUrl.replace(/\/+$/, '')}/api/lyrics/${trackId}`;
    const res = await fetchJsonWithTimeout({
        url,
        timeoutMs: 4000,
        headers: {
            accept: 'application/json',
            'x-user-id': claims.userId,
            'x-service-token': serviceToken,
            'x-service-name': cfg.serviceToken.serviceName,
            'x-request-id': requestId,
        },
    });

    if (!res.ok) {
        if (res.status === 404 || res.status === 403 || res.status === 401) {
            return new Response(null, { status: 204, headers });
        }
        if (res.status === 0) {
            incCounter('ebap_hls_lyrics_http_503_total', 1);
            return textResponse(503, 'Service Unavailable', { 'cache-control': 'private, no-store', 'retry-after': '2' });
        }
        return new Response(null, { status: 204, headers });
    }

    if (!res.json || typeof res.json !== 'object') {
        return new Response(null, { status: 204, headers });
    }

    const raw = res.json;
    const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
    const dto = {
        songId: obj ? (obj.songId ?? obj.song_id ?? trackId) : trackId,
        language: obj && typeof obj.language === 'string' ? obj.language : undefined,
        lines: obj && Array.isArray(obj.lines) ? obj.lines : [],
    };

    incCounter('ebap_hls_lyrics_http_200_total', 1);
    return jsonResponse(200, dto, headers);
}

async function handleLyricsBin(req: Request, requestId: string): Promise<Response> {
    if (req.method !== 'GET') return textResponse(405, 'Method not allowed');

    const crypto = getCrypto();
    if (!crypto) return textResponse(503, 'Service Unavailable', { 'retry-after': '2' });

    const cookies = parseCookies(req.headers.get('cookie'));
    const mpLyrics = cookies['mp_lyrics'] ? String(cookies['mp_lyrics']) : '';
    if (!mpLyrics) {
        logError('lyrics_bin_no_cookie', { requestId, hasCookieHeader: !!req.headers.get('cookie') });
        return unauthorized();
    }

    const claims = parseHlsCookieValue({ secrets: cfg.cookie.secrets, cookieValue: mpLyrics, nowMs: Date.now() });
    if (!claims) {
        logError('lyrics_bin_invalid_claims', { requestId });
        return unauthorized();
    }

    const trackId = claims.trackId >>> 0;
    if (!Number.isInteger(trackId) || trackId <= 0) return unauthorized();

    const headers = new Headers();
    headers.set('cache-control', 'private, no-store');
    headers.set('content-type', 'application/octet-stream');

    let serviceToken = '';
    try {
        serviceToken = await serviceTokenManager.getToken();
    } catch (e) {
        logError('lyrics_bin_svc_token_err', { requestId, trackId }, e);
        const st = e && typeof e === 'object' && 'status' in e ? Number((e as any).status) : 0;
        if (Number.isFinite(st) && st >= 400 && st <= 599) {
            headers.set('x-lyrics-debug', `svc-token-http-${st}`);
        } else {
            const msg = e && typeof e === 'object' && 'message' in e ? String((e as any).message) : '';
            headers.set('x-lyrics-debug', msg.includes('MISCONFIGURED') ? 'svc-token-misconfig' : 'svc-token-err');
        }
        return new Response(null, { status: 204, headers });
    }
    if (!serviceToken) { headers.set('x-lyrics-debug', 'svc-token-empty'); return new Response(null, { status: 204, headers }); }

    const kid = await lyricsKeyIdFromCookieValue(mpLyrics);
    if (!kid) { headers.set('x-lyrics-debug', 'kid-empty'); return new Response(null, { status: 204, headers }); }

    let keyBytes: Uint8Array | null = null;
    let redisKeyFound = false;
    try {
        const redis = await getRedis(cfg);
        const rawKeyB64 = await redis.get(redisLyricsKey(kid));
        if (rawKeyB64 && String(rawKeyB64).trim()) {
            const b = base64ToBytes(String(rawKeyB64));
            if (b.byteLength === 32) {
                keyBytes = b;
                redisKeyFound = true;
            }
        }
    } catch (e) {
        logError('lyrics_bin_redis_err', { requestId, trackId, kid }, e);
        incCounter('ebap_hls_lyrics_http_503_total', 1);
    }

    if (!keyBytes) {
        const hdr = req.headers.get('x-lyrics-key');
        const raw = hdr ? String(hdr).trim() : '';
        if (raw) {
            try {
                const b = base64ToBytes(raw);
                if (b.byteLength === 32) {
                    keyBytes = b;
                }
            } catch {
            }
        }
    }

    if (!keyBytes) {
        logError('lyrics_bin_no_key', { requestId, trackId, kid, redisKeyFound, hasHeader: !!req.headers.get('x-lyrics-key') });
        headers.set('x-lyrics-debug', 'no-key');
        return new Response(null, { status: 204, headers });
    }

    const url = `${cfg.lyricsServiceUrl.replace(/\/+$/, '')}/api/lyrics/${trackId}`;
    const res = await fetchJsonWithTimeout({
        url,
        timeoutMs: 4000,
        headers: {
            accept: 'application/json',
            'x-user-id': claims.userId,
            'x-service-token': serviceToken,
            'x-service-name': cfg.serviceToken.serviceName,
            'x-request-id': requestId,
        },
    });

    if (!res.ok) {
        if (res.status === 404 || res.status === 403 || res.status === 401) {
            logError('lyrics_bin_svc_reject', { requestId, trackId, userId: claims.userId, status: res.status });
            headers.set('x-lyrics-debug', `lyrics-svc-${res.status}`);
            return new Response(null, { status: 204, headers });
        }
        incCounter('ebap_hls_lyrics_http_503_total', 1);
        return textResponse(503, 'Service Unavailable', { 'cache-control': 'private, no-store', 'retry-after': '2' });
    }

    const raw = res.json;
    const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
    if (!obj) {
        logError('lyrics_bin_empty_json', { requestId, trackId, rawType: typeof raw });
        headers.set('x-lyrics-debug', 'empty-json');
        return new Response(null, { status: 204, headers });
    }

    const dto = {
        songId: obj.songId ?? obj.song_id ?? trackId,
        language: typeof obj.language === 'string' ? obj.language : undefined,
        lines: Array.isArray(obj.lines) ? obj.lines : [],
    };

    const plaintext = utf8Bytes(JSON.stringify(dto));
    const iv = randomBytes(12);

    let ctWithTag: ArrayBuffer;
    try {
        const key = await crypto.subtle.importKey('raw', toArrayBuffer(keyBytes), 'AES-GCM', false, ['encrypt']);
        ctWithTag = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, key, toArrayBuffer(plaintext));
    } catch {
        incCounter('ebap_hls_lyrics_http_503_total', 1);
        return textResponse(503, 'Service Unavailable', { 'cache-control': 'private, no-store', 'retry-after': '2' });
    }

    const magic = new Uint8Array([0x45, 0x42, 0x4c, 0x59]);
    const version = new Uint8Array([0x01]);
    const ivLen = new Uint8Array([iv.byteLength & 0xff]);
    const out = concatBytes([
        magic,
        version,
        ivLen,
        iv,
        new Uint8Array(ctWithTag),
    ]);

    incCounter('ebap_hls_lyrics_http_200_total', 1);
    return new Response(toArrayBuffer(out), { status: 200, headers });
}

function mapHlsErrorToResponse(e: unknown): Response {
    const msg = e instanceof Error ? e.message : '';

    const name = e && typeof e === 'object' && 'name' in e ? String((e as any).name || '') : '';

    if (msg === 'HLS_BAD_NAME') {
        incCounter('ebap_hls_error_hls_bad_name_total', 1);
        incCounter('ebap_hls_http_400_total', 1);
        return badRequest('Invalid path');
    }
    if (msg === 'S3_TIMEOUT' || msg === 'ABORTED' || name === 'AbortError') {
        incCounter('ebap_hls_error_s3_timeout_total', 1);
        incCounter('ebap_hls_http_503_total', 1);
        return textResponse(503, 'Service Unavailable', { 'retry-after': '1' });
    }
    if (msg === 'HLS_NOT_READY') {
        incCounter('ebap_hls_error_hls_not_ready_total', 1);
        incCounter('ebap_hls_http_503_total', 1);
        return textResponse(503, 'Service Unavailable', { 'retry-after': '1' });
    }
    if (msg === 'EBAP_TRACKKEY_UNWRAP_FAILED') {
        incCounter('ebap_hls_error_ebap_trackkey_unwrap_failed_total', 1);
        incCounter('ebap_hls_http_503_total', 1);
        return textResponse(503, 'Service Unavailable', { 'retry-after': '10' });
    }
    if (msg === 'EBAP_NO_CHUNKS') {
        incCounter('ebap_hls_error_ebap_no_chunks_total', 1);
        incCounter('ebap_hls_http_404_total', 1);
        return notFound();
    }

    incCounter('ebap_hls_error_unknown_total', 1);
    incCounter('ebap_hls_http_500_total', 1);
    return serverError();
}

function isS3NotFoundError(e: unknown): boolean {
    const anyErr = e as any;
    const httpStatus = anyErr?.$metadata?.httpStatusCode;
    if (httpStatus === 404) return true;
    const name = typeof anyErr?.name === 'string' ? String(anyErr.name) : '';
    if (name === 'NoSuchKey' || name === 'NotFound') return true;
    return false;
}

async function consumeSessionRateLimit(params: { userId: string; nowMs: number }): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const windowSeconds = Math.max(1, cfg.limits.sessionRateLimitWindowSeconds);
    const perWindow = Math.max(1, cfg.limits.sessionRateLimitPerWindow);
    const ratePerSecond = perWindow / windowSeconds;
    const capacity = Math.max(perWindow, perWindow * 6);
    const ttlSeconds = Math.max(10, windowSeconds * 3);
    const key = `ebap:hls:rl:session:tb:${params.userId}`;

    const res = await consumeTokenBucket({
        cfg,
        key,
        nowMs: params.nowMs,
        ratePerSecond,
        capacity,
        cost: 1,
        ttlSeconds,
    });
    return res;
}

type HlsBinaryAssetKind = 'seg' | 'init' | 'warmup' | 'probe';

function assetLimitForKind(kind: HlsBinaryAssetKind): number {
    const base = Math.max(1, cfg.limits.assetRateLimitPerWindow);
    if (kind === 'init') return Math.max(20, base * 5);
    if (kind === 'warmup') return Math.max(300, base * 30);
    if (kind === 'probe') return Math.max(600, base * 10);
    return base;
}

function isWarmupSegmentFileName(fileLower: string): boolean {
    const m = /seg_(\d{5})\.m4s$/i.exec(fileLower);
    if (!m) return false;
    const idx = Number(m[1]);
    if (!Number.isFinite(idx)) return false;
    return idx <= 2;
}

function isProbeSegmentFileName(fileLower: string): boolean {
    const m = /seg_(\d{5})\.m4s$/i.exec(fileLower);
    if (!m) return false;
    const idx = Number(m[1]);
    if (!Number.isFinite(idx)) return false;
    return idx >= 3 && idx <= 5;
}

async function enforceSegmentLimits(params: { userId: string; trackId: number; fileLower: string; nowMs: number }): Promise<Response | null> {
    const isWarmup = isWarmupSegmentFileName(params.fileLower);
    if (isWarmup) return null;

    const isProbe = isProbeSegmentFileName(params.fileLower);
    if (isProbe) {
        const rl = await consumeAssetRateLimit({ userId: params.userId, nowMs: params.nowMs, kind: 'probe' });
        if (!rl.allowed) return textResponse(429, 'Too Many Requests', { 'retry-after': String(rl.retryAfterSeconds) });
        return null;
    }

    const active = await consumeActiveTrackSlot({ userId: params.userId, trackId: params.trackId, nowMs: params.nowMs });
    if (!active.allowed) return textResponse(429, 'Too Many Requests', { 'retry-after': String(active.retryAfterSeconds) });

    const rl = await consumeAssetRateLimit({ userId: params.userId, nowMs: params.nowMs, kind: 'seg' });
    if (!rl.allowed) return textResponse(429, 'Too Many Requests', { 'retry-after': String(rl.retryAfterSeconds) });

    return null;
}

async function consumeAssetRateLimit(params: { userId: string; nowMs: number; kind: HlsBinaryAssetKind; trackId?: number }): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const redis = await getRedis(cfg);
    const windowSeconds = Math.max(1, cfg.limits.assetRateLimitWindowSeconds);
    const limit = assetLimitForKind(params.kind);
    const nowSeconds = Math.floor(params.nowMs / 1000);
    const windowId = Math.floor(nowSeconds / windowSeconds);
    const trackKeyPart = params.kind === 'warmup' && Number.isInteger(params.trackId) && Number(params.trackId) > 0
        ? `:t:${Number(params.trackId)}`
        : '';
    const key = `ebap:hls:rl:asset:${params.kind}:${params.userId}${trackKeyPart}:${windowId}`;
    const count = await redis.incr(key);
    if (count === 1) {
        await redis.expire(key, windowSeconds + 5);
    }
    const retryAfterSeconds = Math.max(1, windowSeconds - (nowSeconds % windowSeconds));
    return { allowed: count <= limit, retryAfterSeconds };
}

async function consumeActiveTrackSlot(params: { userId: string; trackId: number; nowMs: number }): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const redis = await getRedis(cfg);
    const windowSeconds = Math.max(3, cfg.limits.activeTracksWindowSeconds);
    const limit = Math.max(1, cfg.limits.maxActiveTracks);
    const nowSeconds = Math.floor(params.nowMs / 1000);
    const windowStart = nowSeconds - windowSeconds;
    const key = `ebap:hls:active_tracks:${params.userId}`;

    const multi = redis.multi();
    multi.zAdd(key, [{ score: nowSeconds, value: String(params.trackId >>> 0) }]);
    multi.zRemRangeByScore(key, 0, windowStart);
    multi.zCard(key);
    multi.expire(key, windowSeconds + 5);
    const res = await multi.exec();
    const card = Array.isArray(res) ? Number(res[2]) : NaN;
    const count = Number.isFinite(card) ? card : 0;
    const retryAfterSeconds = Math.max(1, windowSeconds - (nowSeconds % windowSeconds));
    return { allowed: count <= limit, retryAfterSeconds };
}

function getUserIdFromHeaders(req: Request): string | null {
    const h = req.headers.get('x-user-id');
    if (h && String(h).trim()) return String(h).trim();
    return null;
}

function isAllowedCorsOrigin(origin: string): boolean {
    const o = String(origin || '').trim();
    if (!o) return false;

    if (/^https?:\/\/localhost(?::\d+)?$/i.test(o)) return true;
    if (/^https?:\/\/127\.0\.0\.1(?::\d+)?$/i.test(o)) return true;
    if (/^https?:\/\/([a-z0-9-]+\.)*earflow\.ru(?::\d+)?$/i.test(o)) return true;
    return false;
}

function appendVary(prev: string | null, value: string): string {
    const v = String(value || '').trim();
    if (!v) return String(prev || '').trim();
    const parts = String(prev || '')
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
    if (parts.some((p) => p.toLowerCase() === v.toLowerCase())) {
        return parts.join(', ');
    }
    parts.push(v);
    return parts.join(', ');
}

function withCors(req: Request, res: Response): Response {
    const origin = req.headers.get('origin');
    if (!origin || !isAllowedCorsOrigin(origin)) return res;

    const headers = new Headers(res.headers);
    headers.set('access-control-allow-origin', origin);
    headers.set('access-control-allow-credentials', 'true');
    headers.set('vary', appendVary(headers.get('vary'), 'Origin'));
    headers.set('access-control-expose-headers', 'content-range, accept-ranges, x-request-id, x-lyrics-debug');

    if (req.method === 'OPTIONS') {
        headers.set('access-control-allow-methods', 'GET, HEAD, POST, OPTIONS');
        headers.set('access-control-allow-headers', 'content-type, range, x-user-id, x-request-id, cache-control, pragma');
        headers.set('access-control-max-age', '600');
    }

    return new Response(res.body, { status: res.status, headers });
}

function buildBinaryResponse(params: {
    bytes: Uint8Array;
    contentType: string | null;
    contentRange: string | null;
    cacheControl: string;
}): Response {
    const headers = new Headers();
    headers.set('content-type', params.contentType ?? 'application/octet-stream');
    headers.set('cache-control', params.cacheControl);
    headers.set('accept-ranges', 'bytes');
    if (params.contentRange) headers.set('content-range', params.contentRange);

    const status = params.contentRange ? 206 : 200;
    return new Response(toArrayBuffer(params.bytes), { status, headers });
}

type HlsAccess = {
    userId: string;
    trackId: number;
    manifestHash8B64Url: string;
    auth: 'token' | 'cookie';
};

function authorizeHls(params: {
    req: Request;
    url: URL;
    trackId: number;
    manifestHash8FromUrl: string | null;
    fileName: string;
}): HlsAccess | null {
    const nowMs = Date.now();
    const token = params.url.searchParams.get('token');
    const fileLower = String(params.fileName || '').toLowerCase();
    const isPlaylist = fileLower.endsWith('.m3u8');
    const isBinaryAsset = fileLower.endsWith('.m4s') || fileLower.endsWith('.mp4');

    if (cfg.signedUrls.enabled && cfg.signedUrls.playlistTokenOnly && isPlaylist && !token) {
        return null;
    }

    if (cfg.signedUrls.enabled && cfg.signedUrls.assetTokenOnly && isBinaryAsset && !token) {
        return null;
    }

    if (cfg.signedUrls.enabled && token) {
        const claims = parseHlsUrlToken({ secrets: cfg.signedUrls.secrets, token, nowMs });
        if (claims) {
            if (claims.trackId !== (params.trackId >>> 0)) return null;
            if (claims.fileName !== params.fileName) return null;
            if (params.manifestHash8FromUrl && claims.manifestHash8B64Url !== params.manifestHash8FromUrl) return null;
            return {
                userId: claims.userId,
                trackId: params.trackId >>> 0,
                manifestHash8B64Url: claims.manifestHash8B64Url,
                auth: 'token',
            };
        }
        return null;
    }

    const cookies = parseCookies(params.req.headers.get('cookie'));
    const mpHls = cookies['mp_hls'] ? String(cookies['mp_hls']) : '';
    const cookieClaims = mpHls ? parseHlsCookieValue({ secrets: cfg.cookie.secrets, cookieValue: mpHls, nowMs }) : null;
    if (cfg.signedUrls.enabled && cfg.signedUrls.playlistRequireCookie && isPlaylist) {
        if (!cookieClaims) return null;
        if (cookieClaims.trackId !== (params.trackId >>> 0)) return null;
        if (params.manifestHash8FromUrl && cookieClaims.manifestHash8B64Url !== params.manifestHash8FromUrl) return null;
    }

    const claims = cookieClaims;
    if (!claims) return null;
    if (claims.trackId !== (params.trackId >>> 0)) return null;
    if (params.manifestHash8FromUrl && claims.manifestHash8B64Url !== params.manifestHash8FromUrl) return null;
    return {
        userId: claims.userId,
        trackId: params.trackId >>> 0,
        manifestHash8B64Url: claims.manifestHash8B64Url,
        auth: 'cookie',
    };
}

function maybeRewriteM3u8WithSignedUrls(params: {
    access: HlsAccess;
    trackId: number;
    manifestHash8B64Url: string;
    fileName: string;
    range: ReturnType<typeof parseRangeHeader>;
    obj: { bytes: Uint8Array; contentType: string | null; contentRange: string | null };
}): { bytes: Uint8Array; contentType: string | null; contentRange: string | null } {
    if (!cfg.signedUrls.enabled) return params.obj;
    const lower = String(params.fileName || '').toLowerCase();
    if (!lower.endsWith('.m3u8')) return params.obj;
    if (params.range) return params.obj;

    const text = new TextDecoder().decode(params.obj.bytes);
    const nowMs = Date.now();
    const baseDir = (() => {
        const f = String(params.fileName || '').replace(/\\/g, '/');
        const idx = f.lastIndexOf('/');
        if (idx <= 0) return '';
        return f.slice(0, idx + 1);
    })();
    const rewritten = rewriteM3u8WithTokens({
        m3u8Text: text,
        baseDir,
        tokenForFileName: (name: string) => {
            const nameLower = String(name || '').toLowerCase();
            const isBinaryAsset = nameLower.endsWith('.m4s') || nameLower.endsWith('.mp4');
            const ttlSeconds = isBinaryAsset ? cfg.signedUrls.assetTtlSeconds : cfg.signedUrls.playlistTtlSeconds;
            const t = createHlsUrlToken({
                secrets: cfg.signedUrls.secrets,
                userId: params.access.userId,
                trackId: params.trackId,
                manifestHash8B64Url: params.manifestHash8B64Url,
                fileName: name,
                ttlSeconds,
                nowMs,
            });
            return t.token;
        },
    });

    return {
        bytes: new TextEncoder().encode(rewritten),
        contentType: params.obj.contentType,
        contentRange: null,
    };
}

async function getHlsObject(params: { key: string; range: ReturnType<typeof parseRangeHeader> }): Promise<{
    bytes: Uint8Array;
    contentType: string | null;
    contentRange: string | null;
}> {
    const obj = await getObjectBytesCapped({
        s3,
        bucket: cfg.minio.bucketHls,
        key: params.key,
        maxBytes: 64 * 1024 * 1024,
        timeoutMs: cfg.minio.s3TimeoutMs,
        range: params.range ?? undefined,
    });

    return {
        bytes: obj.bytes,
        contentType: obj.contentType,
        contentRange: obj.contentRange,
    };
}

async function loadEbapManifest(trackId: number): Promise<{
    bytes: Uint8Array;
    manifestHash8B64Url: string;
    manifest: EbapManifest;
}> {
    const key = `${cfg.minio.manifestPrefix}${trackId}.json`;
    const { bytes } = await getObjectBytesCapped({
        s3,
        bucket: cfg.minio.bucketEbap,
        key,
        maxBytes: cfg.limits.maxManifestBytes,
        timeoutMs: cfg.minio.s3TimeoutMs,
    });

    const parsed = await parseEbapManifest({
        trackId,
        bytes,
        maxChunks: 200000,
        maxChunkBytes: cfg.limits.maxChunkBytes,
    });

    return { bytes, manifestHash8B64Url: parsed.manifestHash8B64Url, manifest: parsed.manifest };
}

async function handleReady(): Promise<Response> {
    try {
        const redis = await getRedis(cfg);
        const pong = await redis.ping();
        if (pong !== 'PONG') return textResponse(503, 'redis');
    } catch {
        return textResponse(503, 'redis');
    }

    const okEbap = await headBucket({ s3, bucket: cfg.minio.bucketEbap, timeoutMs: cfg.minio.s3TimeoutMs });
    if (!okEbap) return textResponse(503, 'minio');
    const okHls = await headBucket({ s3, bucket: cfg.minio.bucketHls, timeoutMs: cfg.minio.s3TimeoutMs });
    if (!okHls) return textResponse(503, 'minio');

    return textResponse(200, 'ok');
}

async function handleSession(req: Request, requestId: string): Promise<Response> {
    if (req.method !== 'POST') return textResponse(405, 'Method not allowed');

    incCounter('ebap_hls_session_requests_total', 1);

    const userId = getUserIdFromHeaders(req);
    if (!userId) return unauthorized();

    let body: any;
    try {
        body = await req.json();
    } catch {
        return badRequest('Invalid JSON');
    }

    const trackId = Number(body?.trackId);
    if (!Number.isInteger(trackId) || trackId <= 0) return badRequest('Invalid trackId');

    const nowMs = Date.now();
    try {
        const rl = await consumeSessionRateLimit({ userId, nowMs });
        if (!rl.allowed) return textResponse(429, 'Too Many Requests', { 'retry-after': String(rl.retryAfterSeconds) });
    } catch {
        return textResponse(503, 'Service Unavailable');
    }

    try {
        const manifestHash8B64Url = await getManifestHash8ForSession(trackId);
        const secret = cfg.cookie.secrets[0];
        if (!secret) {
            return textResponse(503, 'Service Unavailable');
        }
        const cookie = createHlsCookieValue({
            secret,
            userId,
            trackId,
            manifestHash8: base64UrlToBytes(manifestHash8B64Url),
            ttlSeconds: cfg.cookie.ttlSeconds,
            nowMs,
        });

        const setCookieHls = serializeCookie({
            name: 'mp_hls',
            value: cookie.value,
            maxAgeSeconds: cfg.cookie.ttlSeconds,
            domain: cfg.cookie.domain,
            path: `/api/ebap-hls/v1/`,
            httpOnly: true,
            secure: cfg.cookie.secure,
            sameSite: cfg.cookie.sameSite,
        });

        const setCookieLyrics = serializeCookie({
            name: 'mp_lyrics',
            value: cookie.value,
            maxAgeSeconds: cfg.cookie.ttlSeconds,
            domain: cfg.cookie.domain,
            path: `/api/ebap-hls/v1/`,
            httpOnly: true,
            secure: cfg.cookie.secure,
            sameSite: cfg.cookie.sameSite,
        });

        const headers = new Headers();
        headers.append('set-cookie', setCookieHls);
        headers.append('set-cookie', setCookieLyrics);

        const crypto = getCrypto();
        const lyricsKid = crypto ? await lyricsKeyIdFromCookieValue(cookie.value) : '';
        const lyricsKey = crypto && lyricsKid ? randomBytes(32) : null;

        if (lyricsKey) {
            try {
                const redis = await getRedis(cfg);
                const ttl = Math.max(1, cfg.cookie.ttlSeconds + 5);
                await redis.setEx(redisLyricsKey(lyricsKid), ttl, bytesToBase64(new Uint8Array(lyricsKey)));
            } catch (e) {
                logError('lyrics_key_store_failed', { requestId, trackId, userId }, e);
            }
        }

        const rawMasterUrl = `/api/ebap-hls/v1/hls/${trackId}/master.m3u8`;
        const rawLegacyMasterUrl = `/api/ebap-hls/v1/${trackId}/${manifestHash8B64Url}/master.m3u8`;

        const masterToken = cfg.signedUrls.enabled
            ? createHlsUrlToken({
                secrets: cfg.signedUrls.secrets,
                userId,
                trackId,
                manifestHash8B64Url,
                fileName: 'master.m3u8',
                ttlSeconds: cfg.signedUrls.playlistTtlSeconds,
                nowMs,
            }).token
            : '';

        const masterUrl = masterToken ? `${rawMasterUrl}?token=${encodeURIComponent(masterToken)}` : rawMasterUrl;
        const legacyMasterUrl = masterToken ? `${rawLegacyMasterUrl}?token=${encodeURIComponent(masterToken)}` : rawLegacyMasterUrl;

        const body: Record<string, unknown> = {
            trackId,
            manifestHash8: manifestHash8B64Url,
            masterUrl,
            legacyMasterUrl,
            expiresAtMs: nowMs + (cfg.cookie.ttlSeconds * 1000),
        };

        if (lyricsKey) {
            body.lyrics = {
                url: `/api/ebap-hls/v1/lyrics.bin`,
                keyB64: bytesToBase64(new Uint8Array(lyricsKey)),
                expiresAtMs: nowMs + (cfg.cookie.ttlSeconds * 1000),
            };
        }

        return jsonResponse(200, body, headers);
    } catch (e) {
        const code = e instanceof Error ? e.message : '';
        if (isS3NotFoundError(e)) return notFound();
        if (code === 'S3_OBJECT_TOO_LARGE') return textResponse(503, 'Service Unavailable');
        if (code === 'S3_BODY_MISSING' || code === 'S3_STREAM_MISSING' || code === 'S3_BAD_CHUNK') return textResponse(503, 'Service Unavailable');

        logError('hls_session_failed', { requestId, trackId, userId }, e);
        return textResponse(503, 'Service Unavailable');
    }
}

async function handleHlsAssetCookieOnly(req: Request, url: URL): Promise<Response> {
    incCounter('ebap_hls_asset_requests_total', 1);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 6) return notFound();

    const trackId = Number(parts[4]);
    const fileName = parts.slice(5).join('/');

    if (!Number.isInteger(trackId) || trackId <= 0) return notFound();
    if (!fileName) return notFound();

    const access = authorizeHls({ req, url, trackId, manifestHash8FromUrl: null, fileName });
    if (!access) return unauthorized();

    const fileLower = String(fileName || '').toLowerCase();
    const isPlaylist = fileLower.endsWith('.m3u8');
    const isSegment = fileLower.endsWith('.m4s');

    const nowMs = Date.now();
    try {
        if (isSegment) {
            const res = await enforceSegmentLimits({ userId: access.userId, trackId, fileLower, nowMs });
            if (res) return res;
        }
    } catch {
        return textResponse(503, 'Service Unavailable');
    }
    const manifestHash8B64Url = access.manifestHash8B64Url;
    const range = isPlaylist ? null : parseRangeHeader(req.headers.get('range'));

    let key: string;
    try {
        key = hlsKeyForFile(cfg, trackId, manifestHash8B64Url, fileName);
    } catch (e) {
        return mapHlsErrorToResponse(e);
    }

    try {
        const obj = await getHlsObject({ key, range });
        const nextObj = maybeRewriteM3u8WithSignedUrls({ access, trackId, manifestHash8B64Url, fileName, range, obj });
        return buildBinaryResponse({ ...nextObj, cacheControl: cacheControlForAssetAccess(fileName, access) });
    } catch {
        try {
            const m = await loadEbapManifest(trackId);
            if (m.manifestHash8B64Url !== manifestHash8B64Url) return forbidden();

            throw new Error('HLS_NOT_READY');
        } catch (e) {
            return mapHlsErrorToResponse(e);
        }
    }
}

async function handleHlsAsset(req: Request, url: URL): Promise<Response> {
    incCounter('ebap_hls_asset_requests_total', 1);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 6) return notFound();

    const trackId = Number(parts[3]);
    const manifestHash8B64Url = String(parts[4] || '').trim();
    const fileName = parts.slice(5).join('/');

    if (!Number.isInteger(trackId) || trackId <= 0) return notFound();
    if (!manifestHash8B64Url) return notFound();
    if (!fileName) return notFound();

    const access = authorizeHls({ req, url, trackId, manifestHash8FromUrl: manifestHash8B64Url, fileName });
    if (!access) return unauthorized();

    const fileLower = String(fileName || '').toLowerCase();
    const isPlaylist = fileLower.endsWith('.m3u8');
    const isSegment = fileLower.endsWith('.m4s');
    const isInit = fileLower.endsWith('.mp4');

    const nowMs = Date.now();
    try {
        if (isSegment) {
            const res = await enforceSegmentLimits({ userId: access.userId, trackId, fileLower, nowMs });
            if (res) return res;
        } else if (isInit) {
            void 0;
        }
    } catch {
        return textResponse(503, 'Service Unavailable');
    }

    let key: string;
    try {
        key = hlsKeyForFile(cfg, trackId, manifestHash8B64Url, fileName);
    } catch (e) {
        return mapHlsErrorToResponse(e);
    }
    const range = isPlaylist ? null : parseRangeHeader(req.headers.get('range'));

    try {
        const obj = await getHlsObject({ key, range });
        const nextObj = maybeRewriteM3u8WithSignedUrls({ access, trackId, manifestHash8B64Url, fileName, range, obj });
        return buildBinaryResponse({ ...nextObj, cacheControl: cacheControlForAssetAccess(fileName, access) });
    } catch {
        try {
            const m = await loadEbapManifest(trackId);
            if (m.manifestHash8B64Url !== manifestHash8B64Url) return forbidden();

            throw new Error('HLS_NOT_READY');
        } catch (e) {
            return mapHlsErrorToResponse(e);
        }
    }
}

Bun.serve({
    port: cfg.port,
    fetch: async (req: Request) => {
        const requestId = createRequestId();
        const url = new URL(req.url);
        const withRequestId = (res: Response): Response => {
            const h = new Headers(res.headers);
            h.set('x-request-id', requestId);
            return withCors(req, new Response(res.body, { status: res.status, headers: h }));
        };

        if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/ebap-hls/v1/')) {
            return withRequestId(new Response(null, { status: 204, headers: new Headers() }));
        }

        if (url.pathname === '/health') {
            return withRequestId(textResponse(200, 'ok'));
        }

        if (url.pathname === '/health/ready') {
            return withRequestId(await handleReady());
        }

        if (url.pathname === '/metrics') {
            const body = renderPrometheus();
            return withRequestId(textResponse(200, body, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' }));
        }

        if (url.pathname === '/api/ebap-hls/v1/session') {
            return withRequestId(await handleSession(req, requestId));
        }

        if (url.pathname === '/api/ebap-hls/v1/lyrics') {
            return withRequestId(await handleLyrics(req, requestId));
        }

        if (url.pathname === '/api/ebap-hls/v1/lyrics.bin') {
            return withRequestId(await handleLyricsBin(req, requestId));
        }

        if (url.pathname.startsWith('/api/ebap-hls/v1/hls/')) {
            return withRequestId(await handleHlsAssetCookieOnly(req, url));
        }

        if (url.pathname.startsWith('/api/ebap-hls/v1/')) {
            return withRequestId(await handleHlsAsset(req, url));
        }

        return withRequestId(notFound());
    },
});
