import type { Server } from 'bun';

import { createHash, createHmac, randomBytes, timingSafeEqual as cryptoTse } from 'node:crypto';

import {
    buildHlsSegmentCacheUrl,
    createHlsSegmentCacheSig,
    hlsSegmentCacheExpSec,
    verifyHlsSegmentCacheSig,
} from './auth/hlsSegmentCache';
import { createStreamTicketVerifier } from './auth/streamTicket';
import { StreamTicketEpochCache } from './auth/streamTicketEpochCache';
import { startStreamTicketRevokeSubscriber } from './auth/streamTicketRevokeSubscriber';
import { loadConfig } from './config';
import { json, gzipJson, text, empty } from './http/responses';
import { createDb, getSongForStreaming, type QualityVariant } from './db/songs';
import { createS3Client, getObjectBytesCapped, getObjectRange, headObject, headObjectInfo, presignGetObjectUrl, resolveAudioObjectKey } from './storage/s3';
import { createRedisClient } from './lib/redisClient';
import { getSessionCache, setSessionCache, type SessionCacheEntry } from './lib/sessionCache';
import { createMetrics, metricsResponse, routeName } from './observability/metrics';

const cfg = loadConfig();
const metrics = createMetrics();
const sql = createDb(cfg.database);
const s3 = createS3Client({
    endpoint: cfg.minio.endpoint,
    port: cfg.minio.port,
    useSsl: cfg.minio.useSsl,
    accessKeyId: cfg.minio.accessKeyId,
    secretAccessKey: cfg.minio.secretAccessKey,
});

const DIRECT_SESSION_MARKER = 'direct_v3';

const redis = createRedisClient({
    host: cfg.redis.host,
    port: cfg.redis.port,
    password: cfg.redis.password,
});
redis.connect().catch(() => { /* Redis is optional; graceful degradation */ });

const streamTicketEpochCache = new StreamTicketEpochCache();
const authTicketRedis = cfg.streamTicket.accept
    ? createRedisClient({
        host: cfg.streamTicket.authRedis.host,
        port: cfg.streamTicket.authRedis.port,
        password: cfg.streamTicket.authRedis.password,
    })
    : null;
if (authTicketRedis) {
    authTicketRedis.connect().catch(() => undefined);
    startStreamTicketRevokeSubscriber({
        redis: authTicketRedis,
        epochCache: streamTicketEpochCache,
        channel: cfg.streamTicket.revokeChannel,
    });
}

function logStreamTicketConsume(fields: Record<string, string | number>) {
    console.log(JSON.stringify({ event: 'stream_ticket_consume', ...fields }));
}

const streamTicketVerifier = cfg.streamTicket.accept && authTicketRedis
    ? createStreamTicketVerifier({
        jwtSecret: cfg.streamTicket.jwtSecret,
        redisGet: (key) => authTicketRedis.get(key),
        epochCache: streamTicketEpochCache,
        metrics: {
            incConsume: (result) => metrics.incStreamTicketConsume(result),
            incEpochStale: () => metrics.incStreamTicketEpochStale(),
        },
        logConsume: logStreamTicketConsume,
    })
    : null;

function readUserId(req: Request): string {
    const h = String(req.headers.get('x-user-id') || req.headers.get('X-User-Id') || '').trim();
    if (!h || !/^\d+$/.test(h)) return '';
    return h;
}

function isAdmin(req: Request): boolean {
    const role = String(req.headers.get('x-user-role') || req.headers.get('X-User-Role') || '').trim().toLowerCase();
    return role === 'admin';
}

function parseJsonBodyCapped(req: Request, maxBytes: number): Promise<any> {
    return (async () => {
        const lenRaw = req.headers.get('content-length');
        if (lenRaw) {
            const len = Number(lenRaw);
            if (Number.isFinite(len) && len > maxBytes) {
                const err: any = new Error('PAYLOAD_TOO_LARGE');
                err.status = 413;
                throw err;
            }
        }

        const buf = await req.arrayBuffer();
        if (buf.byteLength > maxBytes) {
            const err: any = new Error('PAYLOAD_TOO_LARGE');
            err.status = 413;
            throw err;
        }

        const textBody = new TextDecoder().decode(buf);
        if (!textBody.trim()) return null;
        try {
            return JSON.parse(textBody);
        } catch {
            const err: any = new Error('INVALID_JSON');
            err.status = 400;
            throw err;
        }
    })();
}

function inferMimeFromPath(rawPath: string | null | undefined): string | null {
    const p = String(rawPath || '').trim().toLowerCase();
    if (!p) return null;

    const qIdx = p.indexOf('?');
    const pathOnly = qIdx >= 0 ? p.slice(0, qIdx) : p;
    const dot = pathOnly.lastIndexOf('.');
    if (dot < 0) return null;

    const ext = pathOnly.slice(dot + 1);
    if (!ext) return null;

    if (ext === 'm4a' || ext === 'mp4') return 'audio/mp4';
    if (ext === 'aac') return 'audio/aac';
    if (ext === 'ogg' || ext === 'oga') return 'audio/ogg';
    if (ext === 'webm') return 'audio/webm';
    if (ext === 'flac') return 'audio/flac';
    if (ext === 'wav') return 'audio/wav';
    if (ext === 'mp3') return 'audio/mpeg';
    return null;
}

function safeMime(params: { rawMime: string | null | undefined; filePathHint?: string | null; objectKeyHint?: string | null }): string {
    const m = String(params.rawMime || '').trim();
    if (m && m.length <= 96 && m.includes('/') && m.toLowerCase().startsWith('audio/')) {
        return m;
    }

    const inferred = inferMimeFromPath(params.objectKeyHint) ?? inferMimeFromPath(params.filePathHint);
    return inferred ?? 'audio/mpeg';
}

function parsePositiveInt(v: unknown): number | null {
    const n = Number.parseInt(String(v ?? ''), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

type PlaybackSessionRecord = {
    sessionId: string;
    mode: 'direct' | 'hls';
    userId: string;
    trackId: number;
    trackRef: string;
    quality: string;
    deviceId: string;
    createdAt: number;
    expiresAt: number;
    lastSeenAt: number;
    ipHash: string;
    userAgentHash: string;
    manifestHash8B64Url: string;
};

type PlaybackTokenClaims = {
    userId: string;
    sessionId: string;
    trackId: number;
    scope: 'media-playback';
    iat: number;
    exp: number;
};

function noStoreHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
        'Cache-Control': 'private, no-store',
        'Pragma': 'no-cache',
        'Expires': '0',
        ...(extra || {}),
    };
}

function publicImmutableCacheHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
        'Cache-Control': 'public, max-age=31536000, immutable',
        ...(extra || {}),
    };
}

function streamFailureHeaders(code: string, extra?: Record<string, string>): Record<string, string> {
    return noStoreHeaders({
        'X-Stream-Error': code,
        ...(extra || {}),
    });
}

function streamFailure(status: number, code: string, extra?: Record<string, string>): Response {
    return empty(status, streamFailureHeaders(code, extra));
}

function base64UrlJson(value: unknown): string {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function parseBase64UrlJson(raw: string): unknown {
    return JSON.parse(Buffer.from(String(raw || ''), 'base64url').toString('utf8'));
}

function createPlaybackToken(params: { record: PlaybackSessionRecord; nowMs: number }): { token: string; expiresAtSec: number } {
    const secret = cfg.urlTokenSecrets[0];
    if (!(secret instanceof Uint8Array) || secret.byteLength === 0) throw new Error('PLAYBACK_TOKEN_NO_SECRET');

    const nowSec = Math.floor(params.nowMs / 1000);
    const exp = nowSec + cfg.playback.tokenTtlSeconds;
    const header = base64UrlJson({ alg: 'HS256', typ: 'JWT', kid: 0 });
    const payload = base64UrlJson({
        userId: params.record.userId,
        sessionId: params.record.sessionId,
        trackId: params.record.trackId,
        scope: 'media-playback',
        iat: nowSec,
        exp,
    } satisfies PlaybackTokenClaims);
    const signingInput = `${header}.${payload}`;
    const sig = createHmac('sha256', Buffer.from(secret)).update(signingInput).digest('base64url');
    return { token: `${signingInput}.${sig}`, expiresAtSec: exp };
}

function parsePlaybackToken(token: string, nowMs: number): PlaybackTokenClaims | null {
    const raw = String(token || '').trim();
    if (!raw || raw.length > 4096) return null;
    const parts = raw.split('.');
    if (parts.length !== 3) return null;

    const [headerPart, payloadPart, sigPart] = parts;
    if (!headerPart || !payloadPart || !sigPart) return null;

    let header: any;
    let payload: any;
    try {
        header = parseBase64UrlJson(headerPart);
        payload = parseBase64UrlJson(payloadPart);
    } catch {
        return null;
    }

    if (!header || typeof header !== 'object' || header.alg !== 'HS256') return null;
    if (!payload || typeof payload !== 'object') return null;

    const sig = (() => {
        try {
            return new Uint8Array(Buffer.from(sigPart, 'base64url'));
        } catch {
            return new Uint8Array();
        }
    })();
    if (sig.byteLength !== 32) return null;

    const signingInput = `${headerPart}.${payloadPart}`;
    let verified = false;
    for (const secret of cfg.urlTokenSecrets) {
        if (!(secret instanceof Uint8Array) || secret.byteLength === 0) continue;
        const expected = new Uint8Array(createHmac('sha256', Buffer.from(secret)).update(signingInput).digest());
        if (safeEqual(expected, sig)) {
            verified = true;
            break;
        }
    }
    if (!verified) return null;

    const userId = typeof payload.userId === 'string' ? payload.userId.trim() : '';
    const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : '';
    const trackId = Number(payload.trackId);
    const scope = payload.scope;
    const iat = Number(payload.iat);
    const exp = Number(payload.exp);
    const nowSec = Math.floor(nowMs / 1000);
    if (!/^\d{1,32}$/.test(userId)) return null;
    if (!/^ps_[A-Za-z0-9_-]{20,96}$/.test(sessionId)) return null;
    if (!Number.isInteger(trackId) || trackId <= 0) return null;
    if (scope !== 'media-playback') return null;
    if (!Number.isFinite(iat) || !Number.isFinite(exp) || exp <= 0) return null;
    if (nowSec > exp) return null;
    if (iat > nowSec + 30) return null;

    return { userId, sessionId, trackId: trackId >>> 0, scope, iat: Math.trunc(iat), exp: Math.trunc(exp) };
}

function readBearerToken(req: Request): string {
    const raw = String(req.headers.get('authorization') || '').trim();
    const m = /^Bearer\s+(.+)$/i.exec(raw);
    return m ? String(m[1] || '').trim() : '';
}

function readPlaybackSessionHeader(req: Request): string {
    return String(req.headers.get('x-playback-session') || '').trim();
}

function newPlaybackSessionId(): string {
    return `ps_${randomBytes(24).toString('base64url')}`;
}

function normalizeQuality(raw: unknown): string {
    const v = String(raw || 'auto').trim().toLowerCase();
    if (/^(auto|low|medium|high|lossless)$/.test(v)) return v;
    return 'auto';
}

function normalizeDeviceId(raw: unknown): string {
    const v = String(raw || '').trim();
    if (v && v.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(v)) return v;
    return 'unknown';
}

function readClientIp(req: Request): string {
    const cf = String(req.headers.get('cf-connecting-ip') || '').trim();
    if (cf) return cf;
    const forwarded = String(req.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || '';
    const real = String(req.headers.get('x-real-ip') || '').trim();
    return forwarded || real || 'unknown';
}

function hmacHex(label: string, value: string): string {
    return createHmac('sha256', Buffer.from(cfg.systemRootSecret)).update(`${label}:${value}`).digest('hex');
}

function playbackSessionKey(sessionId: string): string {
    return `playback:session:${sessionId}`;
}

function playbackUserSessionsKey(userId: string): string {
    return `playback:user-sessions:${userId}`;
}

function parsePlaybackSessionRecord(raw: string | null): PlaybackSessionRecord | null {
    if (!raw) return null;
    let obj: any;
    try {
        obj = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!obj || typeof obj !== 'object') return null;

    const sessionId = typeof obj.sessionId === 'string' ? obj.sessionId.trim() : '';
    const mode = obj.mode === 'hls' ? 'hls' : 'direct';
    const userId = typeof obj.userId === 'string' ? obj.userId.trim() : '';
    const trackRef = typeof obj.trackRef === 'string' ? normalizeTrackRef(obj.trackRef) : null;
    const trackId = Number(obj.trackId);
    const expiresAt = Number(obj.expiresAt);
    const createdAt = Number(obj.createdAt);
    const lastSeenAt = Number(obj.lastSeenAt);
    const manifestHash8B64Url = typeof obj.manifestHash8B64Url === 'string' ? obj.manifestHash8B64Url.trim() : '';
    if (!/^ps_[A-Za-z0-9_-]{20,96}$/.test(sessionId)) return null;
    if (!/^\d{1,32}$/.test(userId)) return null;
    if (!trackRef) return null;
    if (!Number.isInteger(trackId) || trackId <= 0) return null;
    if (!Number.isFinite(expiresAt) || expiresAt <= 0) return null;
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(manifestHash8B64Url)) return null;

    return {
        sessionId,
        mode,
        userId,
        trackId: trackId >>> 0,
        trackRef,
        quality: normalizeQuality(obj.quality),
        deviceId: normalizeDeviceId(obj.deviceId),
        createdAt: Number.isFinite(createdAt) ? Math.trunc(createdAt) : Date.now(),
        expiresAt: Math.trunc(expiresAt),
        lastSeenAt: Number.isFinite(lastSeenAt) ? Math.trunc(lastSeenAt) : Date.now(),
        ipHash: typeof obj.ipHash === 'string' ? obj.ipHash : '',
        userAgentHash: typeof obj.userAgentHash === 'string' ? obj.userAgentHash : '',
        manifestHash8B64Url,
    };
}

async function savePlaybackSessionRecord(record: PlaybackSessionRecord, ttlSeconds: number): Promise<void> {
    await redis.set(playbackSessionKey(record.sessionId), JSON.stringify(record), 'EX', ttlSeconds);
}

function mapPlaybackAccess(params: { requestUserId: string; requestIsAdmin: boolean }): boolean {
    if (params.requestIsAdmin) return true;

    const reqUid = Number.parseInt(String(params.requestUserId || ''), 10);
    return Number.isFinite(reqUid) && reqUid > 0;
}

function mapSongOwnerAccess(params: { uploaderId: number | null; requestUserId: string; requestIsAdmin: boolean; libraryUserId: number }): boolean {
    if (params.requestIsAdmin) return true;
    const uploaderId = Number(params.uploaderId ?? 0);
    if (!Number.isFinite(uploaderId) || uploaderId <= 0) return false;

    const reqUid = Number.parseInt(String(params.requestUserId || ''), 10);
    if (!Number.isFinite(reqUid) || reqUid <= 0) return false;

    if (uploaderId === params.libraryUserId) return true;
    if (uploaderId === reqUid) return true;
    return false;
}

function pickFileExt(mime: string): string {
    const m = String(mime || '').toLowerCase();
    if (m === 'audio/mp4' || m === 'audio/m4a' || m.startsWith('audio/mp4')) return 'm4a';
    if (m === 'audio/aac') return 'aac';
    if (m === 'audio/ogg') return 'ogg';
    if (m === 'audio/flac') return 'flac';
    if (m === 'audio/wav') return 'wav';
    return 'mp3';
}

function obfuscateTrackId(trackId: number): number {
    const raw = Number(trackId);
    if (!Number.isFinite(raw) || raw <= 0) return 1;
    const digest = createHmac('sha256', Buffer.from(cfg.systemRootSecret)).update(`trackid:${Math.trunc(raw)}`).digest();
    const n = digest.readUInt32BE(0) >>> 0;
    return n > 0 ? n : 1;
}

function parseQualityVariants(raw: unknown): QualityVariant[] {
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : [];
    return arr.filter(
        (v): v is QualityVariant =>
            v && typeof v === 'object' && typeof v.tag === 'string' && typeof v.key === 'string' && v.key.length > 0
    );
}

function variantMime(v: QualityVariant): string {
    const c = String(v.container || '').toLowerCase();
    if (c === 'webm') return 'audio/webm';
    if (c === 'flac') return 'audio/flac';
    const codec = String(v.codec || '').toLowerCase();
    if (codec === 'opus') return 'audio/webm';
    if (codec === 'flac') return 'audio/flac';
    return 'audio/mp4';
}

function resolveVariantObjectKey(song: { quality_variants: unknown }, qualityRaw: string): { key: string; mime: string } | null {
    const qualityTag = String(qualityRaw || '').trim().toLowerCase();
    if (!qualityTag || qualityTag === 'source') return null;
    const variants = parseQualityVariants(song.quality_variants);
    const match = variants.find((v) => v.tag === qualityTag);
    if (!match) return null;
    return { key: match.key, mime: variantMime(match) };
}

function isDirectLinkNavigationRequest(req: Request): boolean {
    const mode = String(req.headers.get('sec-fetch-mode') || '').trim().toLowerCase();
    const dest = String(req.headers.get('sec-fetch-dest') || '').trim().toLowerCase();
    if (mode === 'navigate') return true;
    if (dest === 'document') return true;
    return false;
}

function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
    try {
        const aa = Buffer.from(a);
        const bb = Buffer.from(b);
        if (aa.byteLength !== bb.byteLength) return false;
        return cryptoTse(aa, bb);
    } catch {
        return false;
    }
}

function hmacSha256(secret: Uint8Array, payload: string): Uint8Array {
    const mac = createHmac('sha256', Buffer.from(secret)).update(payload).digest();
    return new Uint8Array(mac);
}

function readCookieValue(req: Request, name: string): string | null {
    const header = String(req.headers.get('cookie') || '').trim();
    if (!header) return null;
    const target = String(name || '').trim();
    if (!target) return null;

    const parts = header.split(';');
    for (const p of parts) {
        const s = String(p || '').trim();
        if (!s) continue;
        const eq = s.indexOf('=');
        if (eq < 1) continue;
        const k = s.slice(0, eq).trim();
        if (k !== target) continue;
        const v = s.slice(eq + 1).trim();
        return v ? v : null;
    }
    return null;
}

function buildSetCookieHeader(params: {
    name: string;
    value: string;
    maxAgeSeconds: number;
    domain: string;
    path: string;
    secure: boolean;
    httpOnly: boolean;
    sameSite: 'None' | 'Lax' | 'Strict';
}): string {
    const n = String(params.name || '').trim();
    const v = String(params.value || '').trim();
    const d = String(params.domain || '').trim();
    const p = String(params.path || '').trim() || '/';
    const ma = Math.max(1, Math.trunc(params.maxAgeSeconds));
    const ss = params.sameSite;
    const parts = [`${n}=${v}`, `Max-Age=${ma}`, `Domain=${d}`, `Path=${p}`, `SameSite=${ss}`];
    if (params.secure) parts.push('Secure');
    if (params.httpOnly) parts.push('HttpOnly');
    return parts.join('; ');
}

type StreamCookieClaims = {
    v: 2;
    kid: number;
    userId: string;
    sessionId: string;
    isAdmin: 0 | 1;
    expSec: number;
};

function encodeStreamCookiePayload(claims: StreamCookieClaims): string {
    return `${claims.v}.${claims.kid}.${claims.userId}.${claims.sessionId}.${claims.isAdmin}.${claims.expSec}`;
}

function createStreamCookieToken(params: {
    secrets: Uint8Array[];
    userId: string;
    sessionId: string;
    isAdmin: boolean;
    ttlSeconds: number;
    nowMs: number;
}): { token: string; claims: StreamCookieClaims } {
    const secrets = Array.isArray(params.secrets) ? params.secrets : [];
    const secret = secrets[0];
    if (!(secret instanceof Uint8Array) || secret.byteLength === 0) {
        throw new Error('STREAM_COOKIE_NO_SECRET');
    }

    const expSec = Math.floor((params.nowMs + Math.max(1, Math.trunc(params.ttlSeconds)) * 1000) / 1000);
    const claims: StreamCookieClaims = {
        v: 2,
        kid: 0,
        userId: String(params.userId || ''),
        sessionId: String(params.sessionId || ''),
        isAdmin: params.isAdmin ? 1 : 0,
        expSec: expSec >>> 0,
    };
    if (!claims.userId || claims.userId.length > 128) throw new Error('STREAM_COOKIE_BAD_UID');
    if (!/^ps_[A-Za-z0-9_-]{20,96}$/.test(claims.sessionId)) throw new Error('STREAM_COOKIE_BAD_SESSION');

    const payload = encodeStreamCookiePayload(claims);
    const sig = hmacSha256(secret, payload);
    const sigB64u = Buffer.from(sig).toString('base64url');
    return { token: `${payload}.${sigB64u}`, claims };
}

function parseStreamCookieToken(params: { secrets: Uint8Array[]; token: string; nowMs: number }): StreamCookieClaims | null {
    const raw = String(params.token || '').trim();
    if (!raw) return null;

    const parts = raw.split('.');
    if (parts.length !== 7) return null;
    const [vStr, kidStr, userId, sessionId, isAdminStr, expSecStr, sigB64u] = parts;
    if (!vStr || !kidStr || !userId || !sessionId || !isAdminStr || !expSecStr || !sigB64u) return null;
    if (vStr !== '2') return null;
    if (!/^ps_[A-Za-z0-9_-]{20,96}$/.test(sessionId)) return null;

    const kid = Number.parseInt(kidStr, 10);
    if (!Number.isFinite(kid) || kid < 0) return null;

    const expSec = Number.parseInt(expSecStr, 10);
    if (!Number.isFinite(expSec) || expSec <= 0) return null;

    const nowSec = Math.floor(params.nowMs / 1000);
    const leewaySec = 5;
    if (nowSec > expSec + leewaySec) return null;

    const isAdmin = isAdminStr === '1' ? 1 : 0;
    const payload = `${vStr}.${kidStr}.${userId}.${sessionId}.${isAdmin}.${expSecStr}`;

    const sig = (() => {
        try {
            const buf = Buffer.from(sigB64u, 'base64url');
            return new Uint8Array(buf);
        } catch {
            return new Uint8Array();
        }
    })();
    if (sig.byteLength !== 32) return null;

    const secrets = Array.isArray(params.secrets) ? params.secrets : [];
    if (secrets.length === 0) return null;
    const startIdx = kid >= 0 && kid < secrets.length ? kid : 0;
    const ordered: Uint8Array[] = [];
    const primary = secrets[startIdx];
    if (primary) ordered.push(primary);
    for (let i = 0; i < secrets.length; i++) {
        if (i === startIdx) continue;
        const s = secrets[i];
        if (s) ordered.push(s);
    }

    let ok = false;
    for (const secret of ordered) {
        if (!(secret instanceof Uint8Array) || secret.byteLength === 0) continue;
        const expected = hmacSha256(secret, payload);
        if (safeEqual(expected, sig)) {
            ok = true;
            break;
        }
    }
    if (!ok) return null;

    return {
        v: 2,
        kid: kid >>> 0,
        userId,
        sessionId,
        isAdmin,
        expSec: expSec >>> 0,
    };
}

function deriveStableContentHash(params: {
    fileHash: string | null | undefined;
    filePath: string;
    fileSize: number | null | undefined;
    mimeType: string | null | undefined;
}): string {
    const raw = String(params.fileHash || '').trim().toLowerCase();
    if (/^[a-f0-9]{64}$/.test(raw)) return raw;
    const payload = `fallback:v1:${String(params.filePath || '').trim()}:${String(params.fileSize ?? '')}:${String(params.mimeType ?? '')}`;
    const mac = createHmac('sha256', Buffer.from(cfg.systemRootSecret)).update(payload).digest('hex');
    return String(mac || '').trim().toLowerCase();
}

function normalizeTrackRef(raw: string): string | null {
    const v = String(raw || '').trim().toLowerCase();
    if (!v) return null;
    if (/^[1-9][0-9]{0,15}$/.test(v)) return v;
    if (/^[1-9][0-9]{0,15}-[a-f0-9]{12,32}$/.test(v)) return v;
    if (/^[a-f0-9]{16,64}$/.test(v)) return v;
    return null;
}

function trackRefSigFromId(id: number): string {
    const payload = `trackref:v1:${id >>> 0}`;
    const mac = createHmac('sha256', Buffer.from(cfg.systemRootSecret)).update(payload).digest('hex');
    return String(mac || '').trim().toLowerCase().slice(0, 16);
}

function makeOpaqueTrackRefFromId(id: number): string {
    return `${id >>> 0}-${trackRefSigFromId(id)}`;
}

function makePreferredTrackRef(song: { id: number; public_id: string | null }): string {
    const p = normalizeTrackRef(song.public_id || '');
    if (p && !/^[1-9][0-9]{0,15}$/.test(p)) return p;
    return makeOpaqueTrackRefFromId(song.id);
}

function makeManifestHashCacheKey(trackId: number): string {
    return `ds:hls:manifesthash8:v1:${trackId >>> 0}`;
}

function bytesToBase64Url(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64url');
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
    const digest = createHash('sha256').update(Buffer.from(bytes)).digest();
    return new Uint8Array(digest);
}

async function computeManifestHash8B64Url(trackId: number, manifestBytes: Uint8Array): Promise<string | null> {
    let parsed: any;
    try {
        parsed = JSON.parse(new TextDecoder().decode(manifestBytes));
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;
    if (Number(parsed.trackId) !== Number(trackId)) return null;
    if (!Array.isArray(parsed.chunks) || parsed.chunks.length === 0) return null;

    const stable = {
        v: parsed.version,
        tid: parsed.trackId,
        c: parsed.codec,
        m: parsed.mime,
        s: parsed.trackSaltB64,
        sr: parsed.sampleRate,
        ts: parsed.totalSamples,
        chunks: parsed.chunks.map((ch: any) => ({
            i: ch?.index,
            k: ch?.key,
            s: ch?.size,
            h: ch?.sha256B64,
            p: ch?.samples,
        })),
    };

    const stableBytes = new TextEncoder().encode(JSON.stringify(stable));
    return bytesToBase64Url((await sha256(stableBytes)).subarray(0, 8));
}

async function resolveHlsManifestHash8(trackId: number): Promise<string | null> {
    const cacheKey = makeManifestHashCacheKey(trackId);
    try {
        const cached = await redis.get(cacheKey);
        if (cached && /^[A-Za-z0-9_-]{8,64}$/.test(cached)) return cached;
    } catch {
    }

    const manifestKey = `${cfg.minio.manifestPrefix}${trackId >>> 0}.json`;
    const obj = await getObjectBytesCapped({
        s3,
        bucket: cfg.minio.bucketEbap,
        key: manifestKey,
        maxBytes: cfg.minio.maxManifestBytes,
        timeoutMs: cfg.minio.s3TimeoutMs,
    }).catch(() => null);
    if (!obj) return null;

    const hash = await computeManifestHash8B64Url(trackId, obj.bytes);
    if (!hash) return null;

    try {
        await redis.set(cacheKey, hash, 'EX', 24 * 60 * 60);
    } catch {
    }
    return hash;
}

function hlsObjectKey(trackId: number, manifestHash8B64Url: string, fileName: string): string | null {
    const safe = String(fileName || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!safe || safe.includes('..') || safe.length > 256) return null;
    if (!/^[A-Za-z0-9_./-]+$/.test(safe)) return null;
    return `${cfg.minio.hlsPrefix}${trackId >>> 0}/${manifestHash8B64Url}/${safe}`;
}

async function isHlsReady(trackId: number, manifestHash8B64Url: string): Promise<boolean> {
    const readyKey = hlsObjectKey(trackId, manifestHash8B64Url, 'ready.json');
    if (!readyKey) return false;
    return await headObject({
        s3,
        bucket: cfg.minio.bucketHls,
        key: readyKey,
        timeoutMs: cfg.minio.s3TimeoutMs,
    });
}

function buildManifestUrl(trackRef: string): string {
    return `${cfg.publicStreamingOrigin}/audio/v3/tracks/${encodeURIComponent(trackRef)}/master.m3u8`;
}

function buildDirectStreamUrl(sessionId: string): string {
    return `${cfg.publicStreamingOrigin}/audio/v3/direct/${encodeURIComponent(sessionId)}/stream`;
}

function hlsPlaybackSessionJson(record: PlaybackSessionRecord, token: string, tokenExpiresAtSec: number): Response {
    return json(200, {
        sessionId: record.sessionId,
        mode: 'hls',
        trackId: record.trackRef,
        manifestUrl: buildManifestUrl(record.trackRef),
        playbackToken: token,
        expiresAt: tokenExpiresAtSec,
        expiresAtMs: tokenExpiresAtSec * 1000,
        sessionExpiresAt: Math.floor(record.expiresAt / 1000),
        sessionExpiresAtMs: record.expiresAt,
    }, noStoreHeaders());
}

function directPlaybackSessionJson(record: PlaybackSessionRecord, entry: SessionCacheEntry, streamCookie: string): Response {
    const expSec = Math.floor(record.expiresAt / 1000);
    return json(200, {
        sessionId: record.sessionId,
        mode: 'direct',
        trackId: record.trackRef,
        url: buildDirectStreamUrl(record.sessionId),
        streamUrl: buildDirectStreamUrl(record.sessionId),
        mime: entry.mime,
        expiresAt: expSec,
        expiresAtMs: record.expiresAt,
        sessionExpiresAt: expSec,
        sessionExpiresAtMs: record.expiresAt,
        qualities: null,
    }, noStoreHeaders({ 'Set-Cookie': streamCookie }));
}

async function createPlaybackSession(params: {
    req: Request;
    song: { id: number; public_id: string | null };
    mode: 'direct' | 'hls';
    userId: string;
    quality: string;
    deviceId: string;
    manifestHash8B64Url: string;
}): Promise<PlaybackSessionRecord> {
    const nowMs = Date.now();
    const sessionId = newPlaybackSessionId();
    const trackRef = makePreferredTrackRef(params.song);
    const expiresAt = nowMs + cfg.playback.sessionTtlSeconds * 1000;
    const record: PlaybackSessionRecord = {
        sessionId,
        mode: params.mode,
        userId: params.userId,
        trackId: params.song.id >>> 0,
        trackRef,
        quality: params.quality,
        deviceId: params.deviceId,
        createdAt: nowMs,
        expiresAt,
        lastSeenAt: nowMs,
        ipHash: hmacHex('ip', readClientIp(params.req)),
        userAgentHash: hmacHex('ua', String(params.req.headers.get('user-agent') || '')),
        manifestHash8B64Url: params.manifestHash8B64Url,
    };

    const userKey = playbackUserSessionsKey(params.userId);
    const nowScore = nowMs;
    await redis.zremrangebyscore(userKey, '-inf', String(nowScore));
    let activeIds = await redis.zrange(userKey, 0, -1);
    while (activeIds.length >= cfg.playback.maxActiveSessionsPerUser) {
        const oldest = activeIds.shift();
        if (!oldest) break;
        await redis.del(playbackSessionKey(oldest));
        await redis.zrem(userKey, oldest);
    }

    await savePlaybackSessionRecord(record, cfg.playback.sessionTtlSeconds);
    await redis.zadd(userKey, String(expiresAt), sessionId);
    await redis.expire(userKey, cfg.playback.sessionTtlSeconds);
    return record;
}

async function loadPlaybackSession(sessionId: string): Promise<PlaybackSessionRecord | null> {
    if (!/^ps_[A-Za-z0-9_-]{20,96}$/.test(sessionId)) return null;
    const record = parsePlaybackSessionRecord(await redis.get(playbackSessionKey(sessionId)));
    if (!record) return null;
    if (Date.now() > record.expiresAt) {
        await redis.del(playbackSessionKey(sessionId)).catch(() => undefined);
        await redis.zrem(playbackUserSessionsKey(record.userId), sessionId).catch(() => undefined);
        return null;
    }
    return record;
}

async function refreshPlaybackSessionRecord(record: PlaybackSessionRecord): Promise<PlaybackSessionRecord> {
    const nowMs = Date.now();
    const refreshed = {
        ...record,
        lastSeenAt: nowMs,
        expiresAt: nowMs + cfg.playback.sessionTtlSeconds * 1000,
    };
    await savePlaybackSessionRecord(refreshed, cfg.playback.sessionTtlSeconds);
    await redis.zadd(playbackUserSessionsKey(refreshed.userId), String(refreshed.expiresAt), refreshed.sessionId);
    await redis.expire(playbackUserSessionsKey(refreshed.userId), cfg.playback.sessionTtlSeconds);
    return refreshed;
}

async function consumePlaybackMediaQuota(sessionId: string): Promise<{ ok: boolean; retryAfterSeconds: number }> {
    const windowSeconds = cfg.playback.mediaRateLimitWindowSeconds;
    const nowSec = Math.floor(Date.now() / 1000);
    const windowId = Math.floor(nowSec / windowSeconds);
    const key = `playback:media-rl:${sessionId}:${windowId}`;
    const count = await redis.incr(key);
    if (count === 1) {
        await redis.expire(key, windowSeconds + 5);
    }
    if (count <= cfg.playback.mediaRateLimitMaxRequests) {
        return { ok: true, retryAfterSeconds: 0 };
    }
    const nextWindowAt = (windowId + 1) * windowSeconds;
    return { ok: false, retryAfterSeconds: Math.max(1, nextWindowAt - nowSec) };
}

async function finalizePlaybackAuthorization(record: PlaybackSessionRecord): Promise<
    | { ok: true; record: PlaybackSessionRecord }
    | { ok: false; response: Response }
> {
    const quota = await consumePlaybackMediaQuota(record.sessionId).catch(() => ({ ok: false, retryAfterSeconds: 2 }));
    if (!quota.ok) {
        return { ok: false, response: streamFailure(429, 'PLAYBACK_RATE_LIMITED', { 'Retry-After': String(quota.retryAfterSeconds) }) };
    }

    if (Date.now() - record.lastSeenAt > 10_000) {
        await refreshPlaybackSessionRecord(record).catch(() => undefined);
    }
    return { ok: true, record };
}

async function authorizePlaybackMedia(req: Request, pathTrackRef: string, url: URL): Promise<
    | { ok: true; record: PlaybackSessionRecord }
    | { ok: false; response: Response }
> {
    const normalizedTrackRef = normalizeTrackRef(pathTrackRef);

    if (streamTicketVerifier) {
        const ticketTry = await streamTicketVerifier.tryVerify(req, url, {
            sessionId: readPlaybackSessionHeader(req) || undefined,
            trackRef: normalizedTrackRef || undefined,
        });
        if (ticketTry.present) {
            if (!ticketTry.ok) {
                return { ok: false, response: streamFailure(401, 'STREAM_TICKET_INVALID') };
            }
            const sessionId = String(ticketTry.ticket.scope.sessionId || '').trim();
            const record = await loadPlaybackSession(sessionId).catch(() => null);
            if (!record) {
                return { ok: false, response: streamFailure(401, 'PLAYBACK_SESSION_EXPIRED') };
            }
            if (record.mode !== 'hls') {
                return { ok: false, response: streamFailure(403, 'PLAYBACK_MODE_MISMATCH') };
            }
            if (!normalizedTrackRef || normalizedTrackRef !== record.trackRef) {
                return { ok: false, response: streamFailure(403, 'PLAYBACK_TRACK_MISMATCH') };
            }
            if (record.userId !== ticketTry.ticket.userId) {
                return { ok: false, response: streamFailure(403, 'PLAYBACK_SESSION_DENIED') };
            }
            return finalizePlaybackAuthorization(record);
        }
        if (cfg.streamTicket.enforce) {
            return { ok: false, response: streamFailure(401, 'STREAM_TICKET_REQUIRED') };
        }
    }

    const token = readBearerToken(req);
    const headerSessionId = readPlaybackSessionHeader(req);
    if (!token || !headerSessionId) {
        return { ok: false, response: streamFailure(401, 'PLAYBACK_TOKEN_MISSING') };
    }

    const claims = parsePlaybackToken(token, Date.now());
    if (!claims || claims.sessionId !== headerSessionId) {
        return { ok: false, response: streamFailure(401, 'PLAYBACK_TOKEN_INVALID') };
    }

    const record = await loadPlaybackSession(claims.sessionId).catch(() => null);
    if (!record) {
        return { ok: false, response: streamFailure(401, 'PLAYBACK_SESSION_EXPIRED') };
    }
    if (record.mode !== 'hls') {
        return { ok: false, response: streamFailure(403, 'PLAYBACK_MODE_MISMATCH') };
    }

    if (!normalizedTrackRef || normalizedTrackRef !== record.trackRef) {
        return { ok: false, response: streamFailure(403, 'PLAYBACK_TRACK_MISMATCH') };
    }
    if (record.userId !== claims.userId || record.trackId !== claims.trackId) {
        return { ok: false, response: streamFailure(403, 'PLAYBACK_SESSION_DENIED') };
    }

    metrics.incStreamTicketConsume('legacy');
    return finalizePlaybackAuthorization(record);
}

function playbackSessionJson(record: PlaybackSessionRecord, token: string, tokenExpiresAtSec: number): Response {
    return hlsPlaybackSessionJson(record, token, tokenExpiresAtSec);
}

function createDirectStreamCookieHeader(record: PlaybackSessionRecord, req: Request): string {
    const nowMs = Date.now();
    const maxAgeSeconds = Math.max(1, Math.min(
        cfg.streamCookie.ttlSeconds,
        Math.ceil(Math.max(1, record.expiresAt - nowMs) / 1000),
    ));
    const issued = createStreamCookieToken({
        secrets: cfg.urlTokenSecrets,
        userId: record.userId,
        sessionId: record.sessionId,
        isAdmin: isAdmin(req),
        ttlSeconds: maxAgeSeconds,
        nowMs,
    });
    const secure = cfg.publicStreamingOrigin.startsWith('https://');
    return buildSetCookieHeader({
        name: cfg.streamCookie.name,
        value: issued.token,
        maxAgeSeconds,
        domain: cfg.streamCookie.domain,
        path: `/audio/v3/direct/`,
        secure,
        httpOnly: true,
        sameSite: secure ? 'None' : 'Lax',
    });
}

async function authorizeDirectStream(req: Request, sessionId: string, url: URL): Promise<
    | { ok: true; record: PlaybackSessionRecord }
    | { ok: false; response: Response }
> {
    if (isDirectLinkNavigationRequest(req)) {
        return { ok: false, response: text(403, 'Forbidden', streamFailureHeaders('DIRECT_NAVIGATION_FORBIDDEN')) };
    }
    if (!/^ps_[A-Za-z0-9_-]{20,96}$/.test(sessionId)) {
        return { ok: false, response: streamFailure(404, 'INVALID_SESSION_ID') };
    }

    if (streamTicketVerifier) {
        const ticketTry = await streamTicketVerifier.tryVerify(req, url, { sessionId });
        if (ticketTry.present) {
            if (!ticketTry.ok) {
                return { ok: false, response: streamFailure(401, 'STREAM_TICKET_INVALID') };
            }
            const record = await loadPlaybackSession(sessionId).catch(() => null);
            if (!record) {
                return { ok: false, response: streamFailure(401, 'PLAYBACK_SESSION_EXPIRED') };
            }
            if (record.mode !== 'direct' || record.userId !== ticketTry.ticket.userId) {
                return { ok: false, response: streamFailure(403, 'PLAYBACK_SESSION_DENIED') };
            }
            const scopeTrack = String(ticketTry.ticket.scope.trackId || '').trim().toLowerCase();
            const trackCandidates = new Set([
                String(record.trackId),
                String(record.trackRef || '').toLowerCase(),
            ]);
            if (scopeTrack && !trackCandidates.has(scopeTrack)) {
                return { ok: false, response: streamFailure(403, 'PLAYBACK_TRACK_MISMATCH') };
            }
            return finalizePlaybackAuthorization(record);
        }
        if (cfg.streamTicket.enforce) {
            return { ok: false, response: streamFailure(401, 'STREAM_TICKET_REQUIRED') };
        }
    }

    const cookie = readCookieValue(req, cfg.streamCookie.name);
    if (!cookie) {
        return { ok: false, response: streamFailure(401, 'STREAM_COOKIE_MISSING') };
    }

    const claims = parseStreamCookieToken({ secrets: cfg.urlTokenSecrets, token: cookie, nowMs: Date.now() });
    if (!claims || claims.sessionId !== sessionId) {
        return { ok: false, response: streamFailure(401, 'STREAM_COOKIE_INVALID') };
    }

    const record = await loadPlaybackSession(sessionId).catch(() => null);
    if (!record) {
        return { ok: false, response: streamFailure(401, 'PLAYBACK_SESSION_EXPIRED') };
    }
    if (record.mode !== 'direct' || record.userId !== claims.userId) {
        return { ok: false, response: streamFailure(403, 'PLAYBACK_SESSION_DENIED') };
    }

    const currentUserAgentHash = hmacHex('ua', String(req.headers.get('user-agent') || ''));
    const currentIpHash = hmacHex('ip', readClientIp(req));
    if ((record.userAgentHash && record.userAgentHash !== currentUserAgentHash) || (record.ipHash && record.ipHash !== currentIpHash)) {
        return { ok: false, response: streamFailure(403, 'PLAYBACK_BINDING_MISMATCH') };
    }

    metrics.incStreamTicketConsume('legacy');
    return finalizePlaybackAuthorization(record);
}

function parseDirectRange(req: Request, totalBytes: number): { start: number; end: number; partial: boolean } | null {
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) return null;
    const maxEnd = Math.trunc(totalBytes) - 1;
    const raw = String(req.headers.get('range') || '').trim().toLowerCase();
    if (!raw) {
        return { start: 0, end: maxEnd, partial: false };
    }
    if (!raw.startsWith('bytes=') || raw.includes(',')) return null;

    const spec = raw.slice('bytes='.length).trim();
    const dash = spec.indexOf('-');
    if (dash < 0) return null;

    const left = spec.slice(0, dash).trim();
    const right = spec.slice(dash + 1).trim();
    if (!left) {
        const suffix = Number.parseInt(right, 10);
        if (!Number.isFinite(suffix) || suffix <= 0) return null;
        const end = maxEnd;
        const start = Math.max(0, end - Math.trunc(suffix) + 1);
        return { start, end, partial: true };
    }

    const start = Number.parseInt(left, 10);
    if (!Number.isFinite(start) || start < 0 || start > maxEnd) return null;
    const requestedEnd = right ? Number.parseInt(right, 10) : maxEnd;
    if (!Number.isFinite(requestedEnd) || requestedEnd < start) return null;
    const end = Math.min(Math.trunc(requestedEnd), maxEnd);
    return { start, end, partial: true };
}

async function resolveDirectStreamAsset(record: PlaybackSessionRecord): Promise<{ objectKey: string; mime: string; entry: SessionCacheEntry } | null> {
    const entry = await resolveSessionEntry(record.trackId);
    if (!entry || entry.isAvailable === false) return null;
    if (record.quality !== 'auto' && record.quality !== 'lossless') {
        const song = await getSongForStreaming(sql, record.trackId);
        if (song) {
            const variant = resolveVariantObjectKey(song, record.quality);
            if (variant) return { objectKey: variant.key, mime: variant.mime, entry };
        }
    }
    return { objectKey: entry.objectKey, mime: entry.mime, entry };
}

async function handleDirectPlaybackStream(req: Request, url: URL): Promise<Response | null> {
    if (req.method !== 'GET' && req.method !== 'HEAD') return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length !== 5 || parts[0] !== 'audio' || parts[1] !== 'v3' || parts[2] !== 'direct' || parts[4] !== 'stream') {
        return null;
    }

    const auth = await authorizeDirectStream(req, parts[3] || '', url);
    if (!auth.ok) return auth.response;

    const asset = await resolveDirectStreamAsset(auth.record);
    if (!asset) return streamFailure(404, 'STREAM_ASSET_NOT_FOUND');

    const info = await headObjectInfo({
        s3,
        bucket: cfg.minio.bucketAudio,
        key: asset.objectKey,
        timeoutMs: cfg.minio.s3TimeoutMs,
    });
    if (!info || info.contentLength <= 0) return streamFailure(404, 'STREAM_ASSET_NOT_FOUND');

    const contentType = asset.mime || info.contentType || 'audio/mpeg';
    const range = parseDirectRange(req, info.contentLength);
    if (!range) {
        return empty(416, noStoreHeaders({
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes */${info.contentLength}`,
        }));
    }

    const length = range.end - range.start + 1;
    const headers = noStoreHeaders({
        'Accept-Ranges': 'bytes',
        'Content-Type': contentType,
        'Content-Length': String(length),
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'X-Content-Type-Options': 'nosniff',
    });
    if (range.partial) {
        headers['Content-Range'] = `bytes ${range.start}-${range.end}/${info.contentLength}`;
    }

    if (req.method === 'HEAD') {
        return new Response(null, { status: range.partial ? 206 : 200, headers });
    }

    const objectRange = await getObjectRange({
        s3,
        bucket: cfg.minio.bucketAudio,
        key: asset.objectKey,
        start: range.start,
        end: range.end,
        timeoutMs: cfg.minio.s3TimeoutMs,
    });
    void objectRange;
    headers['Content-Length'] = String(length);
    return new Response(objectRange.body, { status: range.partial ? 206 : 200, headers });
}

function isSafeHlsVariant(raw: string): boolean {
    return /^[A-Za-z0-9_-]{1,64}$/.test(String(raw || ''));
}

function isSafeHlsSegmentName(raw: string): boolean {
    return /^seg_[0-9]{1,8}\.m4s$/i.test(String(raw || ''));
}

function rewriteMasterPlaylist(body: string, trackRef: string): string {
    const out: string[] = [];
    for (const line of String(body || '').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            out.push(line);
            continue;
        }

        const first = trimmed.split('/')[0] || '';
        if (!isSafeHlsVariant(first)) {
            out.push('#EXT-X-STREAM-INF:BANDWIDTH=128000,CODECS="mp4a.40.2"');
            out.push('manifest/aac_128.m3u8');
            continue;
        }
        out.push(`manifest/${first}.m3u8`);
    }
    return `${out.join('\n').trim()}\n`;
}

function buildHlsSegmentUri(record: PlaybackSessionRecord, variant: string, asset: string): string {
    if (!cfg.hlsSegmentCache.enabled) {
        return `../segments/${variant}/${asset}`;
    }

    const expSec = hlsSegmentCacheExpSec(Date.now(), cfg.hlsSegmentCache.ttlSeconds);
    const sig = createHlsSegmentCacheSig({
        secrets: cfg.urlTokenSecrets,
        trackId: record.trackId,
        manifestHash8B64Url: record.manifestHash8B64Url,
        variant,
        asset,
        expSec,
    });
    return buildHlsSegmentCacheUrl({
        publicOrigin: cfg.publicStreamingOrigin,
        trackId: record.trackId,
        manifestHash8B64Url: record.manifestHash8B64Url,
        variant,
        asset,
        expSec,
        sig,
    });
}

function rewriteMediaPlaylist(body: string, record: PlaybackSessionRecord, variant: string): string {
    const safeVariant = isSafeHlsVariant(variant) ? variant : 'aac_128';
    const rewriteUri = (uri: string): string => {
        const raw = String(uri || '').replace(/\\/g, '/').split('/').pop() || '';
        if (raw === 'init.mp4') return buildHlsSegmentUri(record, safeVariant, 'init.mp4');
        if (isSafeHlsSegmentName(raw)) return buildHlsSegmentUri(record, safeVariant, raw);
        return buildHlsSegmentUri(record, safeVariant, 'seg_00000.m4s');
    };

    const out: string[] = [];
    for (const line of String(body || '').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) {
            out.push(line);
            continue;
        }
        if (trimmed.startsWith('#EXT-X-MAP:')) {
            out.push(line.replace(/URI="([^"]+)"/, (_m, uri) => `URI="${rewriteUri(String(uri || ''))}"`));
            continue;
        }
        if (trimmed.startsWith('#')) {
            out.push(line);
            continue;
        }
        out.push(rewriteUri(trimmed));
    }
    void record.trackRef;
    return `${out.join('\n').trim()}\n`;
}

async function readHlsPlaylist(record: PlaybackSessionRecord, fileName: string): Promise<Response> {
    const key = hlsObjectKey(record.trackId, record.manifestHash8B64Url, fileName);
    if (!key) return empty(404, noStoreHeaders());

    const obj = await getObjectBytesCapped({
        s3,
        bucket: cfg.minio.bucketHls,
        key,
        maxBytes: 512 * 1024,
        timeoutMs: cfg.minio.s3TimeoutMs,
    }).catch(() => null);
    if (!obj) return empty(404, noStoreHeaders());

    const raw = new TextDecoder().decode(obj.bytes);
    const body = fileName === 'master.m3u8'
        ? rewriteMasterPlaylist(raw, record.trackRef)
        : rewriteMediaPlaylist(raw, record, fileName.split('/')[0] || '');

    return text(200, body, {
        ...noStoreHeaders(),
        'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
        'Access-Control-Allow-Headers': 'Authorization, X-Playback-Session, Range, If-Range',
    });
}

async function serveHlsAssetViaAccel(params: {
    trackId: number;
    manifestHash8B64Url: string;
    fileName: string;
    contentType: string;
    cachePolicy: 'public' | 'private';
}): Promise<Response> {
    const key = hlsObjectKey(params.trackId, params.manifestHash8B64Url, params.fileName);
    if (!key) return empty(404, noStoreHeaders());

    const exists = await headObject({
        s3,
        bucket: cfg.minio.bucketHls,
        key,
        timeoutMs: cfg.minio.s3TimeoutMs,
    });
    if (!exists) return empty(404, noStoreHeaders());

    const presigned = await presignGetObjectUrl({
        s3,
        bucket: cfg.minio.bucketHls,
        key,
        expiresInSeconds: Math.max(60, Math.min(300, cfg.playback.tokenTtlSeconds + 30)),
    });

    let u: URL;
    try {
        u = new URL(presigned);
    } catch {
        return empty(503, noStoreHeaders({ 'Retry-After': '2' }));
    }

    const bucket = String(cfg.minio.bucketHls || '').trim();
    const expectedPrefix = `/${bucket}/`;
    const host = (u.hostname || '').toLowerCase();
    const isPathStyle = u.pathname.startsWith(expectedPrefix);
    const isVirtualHostedStyle = host.startsWith(`${bucket.toLowerCase()}.`);
    if (!isPathStyle && !isVirtualHostedStyle) {
        return empty(503, noStoreHeaders({ 'Retry-After': '2' }));
    }

    const encodedObjectKey = isPathStyle ? u.pathname.slice(expectedPrefix.length) : u.pathname.replace(/^\/+/, '');
    if (!encodedObjectKey) return empty(503, noStoreHeaders({ 'Retry-After': '2' }));

    const cacheHeaders = params.cachePolicy === 'public'
        ? publicImmutableCacheHeaders()
        : noStoreHeaders();
    const headers = new Headers(cacheHeaders);
    headers.set('X-Accel-Redirect', `/media/direct-hls/${encodedObjectKey}${u.search}`);
    headers.set('Content-Type', params.contentType);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
    return new Response(null, { status: 200, headers });
}

async function accelHlsAsset(record: PlaybackSessionRecord, fileName: string, contentType: string): Promise<Response> {
    return serveHlsAssetViaAccel({
        trackId: record.trackId,
        manifestHash8B64Url: record.manifestHash8B64Url,
        fileName,
        contentType,
        cachePolicy: 'private',
    });
}

async function handleHlsCacheSegment(req: Request, url: URL): Promise<Response | null> {
    if (!cfg.hlsSegmentCache.enabled) return null;
    if (req.method !== 'GET' && req.method !== 'HEAD') return null;

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length !== 7 || parts[0] !== 'audio' || parts[1] !== 'v3' || parts[2] !== 'cache') {
        return null;
    }

    const trackId = parsePositiveInt(parts[3]);
    const manifestHash8B64Url = String(parts[4] || '').trim();
    const variant = String(parts[5] || '').trim();
    let asset = '';
    try {
        asset = decodeURIComponent(String(parts[6] || '').trim());
    } catch {
        return empty(400, streamFailureHeaders('HLS_CACHE_BAD_ASSET'));
    }

    if (!trackId || !/^[A-Za-z0-9_-]{8,64}$/.test(manifestHash8B64Url)) {
        return empty(404, streamFailureHeaders('HLS_CACHE_NOT_FOUND'));
    }
    if (!isSafeHlsVariant(variant)) {
        return empty(404, streamFailureHeaders('HLS_CACHE_NOT_FOUND'));
    }
    if (asset !== 'init.mp4' && !isSafeHlsSegmentName(asset)) {
        return empty(404, streamFailureHeaders('HLS_CACHE_NOT_FOUND'));
    }

    const expSec = parsePositiveInt(url.searchParams.get('exp'));
    const sig = String(url.searchParams.get('sig') || '').trim();
    if (!expSec || !sig) {
        return empty(403, streamFailureHeaders('HLS_CACHE_SIG_MISSING'));
    }

    const verified = verifyHlsSegmentCacheSig({
        secrets: cfg.urlTokenSecrets,
        trackId,
        manifestHash8B64Url,
        variant,
        asset,
        expSec,
        sig,
        nowMs: Date.now(),
    });
    if (!verified) {
        return empty(403, streamFailureHeaders('HLS_CACHE_SIG_INVALID'));
    }

    const contentType = asset === 'init.mp4' ? 'video/mp4' : 'video/iso.segment';
    return serveHlsAssetViaAccel({
        trackId,
        manifestHash8B64Url,
        fileName: `${variant}/${asset}`,
        contentType,
        cachePolicy: 'public',
    });
}

async function handlePlaybackMedia(req: Request, url: URL): Promise<Response | null> {
    if (req.method !== 'GET' && req.method !== 'HEAD') return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 5 || parts[0] !== 'audio' || parts[1] !== 'v3' || parts[2] !== 'tracks') return null;

    const trackRef = normalizeTrackRef(parts[3] || '');
    if (!trackRef) return empty(404, noStoreHeaders());

    const auth = await authorizePlaybackMedia(req, trackRef, url);
    if (!auth.ok) return auth.response;
    const record = auth.record;

    const node = parts[4] || '';
    if (node === 'master.m3u8') {
        return await readHlsPlaylist(record, 'master.m3u8');
    }

    if (node === 'manifest' && parts.length === 6) {
        const variantFile = parts[5] || '';
        if (!variantFile.endsWith('.m3u8')) return empty(404, noStoreHeaders());
        const variant = variantFile.slice(0, -'.m3u8'.length);
        if (!isSafeHlsVariant(variant)) return empty(404, noStoreHeaders());
        return await readHlsPlaylist(record, `${variant}/index.m3u8`);
    }

    if (node === 'segments' && parts.length === 7) {
        const variant = parts[5] || '';
        const asset = parts[6] || '';
        if (!isSafeHlsVariant(variant)) return empty(404, noStoreHeaders());
        if (asset === 'init.mp4') return await accelHlsAsset(record, `${variant}/init.mp4`, 'video/mp4');
        if (isSafeHlsSegmentName(asset)) return await accelHlsAsset(record, `${variant}/${asset}`, 'video/iso.segment');
        return empty(404, noStoreHeaders());
    }

    if (node === 'key') {
        return empty(404, noStoreHeaders());
    }

    return empty(404, noStoreHeaders());
}

const OKEY_CACHE_PREFIX = 'ds:okey:v1:';
const OKEY_CACHE_TTL_SEC = 86400;

async function resolveObjectKeyCached(filePath: string): Promise<string | null> {
    const cacheKey = `${OKEY_CACHE_PREFIX}${filePath}`;
    try {
        const cached = await redis.get(cacheKey);
        if (typeof cached === 'string' && cached.length > 0) return cached;
    } catch { /* Redis is optional */ }

    const objectKey = await resolveAudioObjectKey({ s3, bucket: cfg.minio.bucketAudio, filePath });

    if (objectKey) {
        try {
            await redis.set(cacheKey, objectKey, 'EX', OKEY_CACHE_TTL_SEC);
        } catch { /* Redis is optional */ }
    }

    return objectKey;
}

async function resolveSessionEntry(trackId: number): Promise<SessionCacheEntry | null> {
    const cached = await getSessionCache(redis, trackId).catch(() => null);
    if (cached) return cached;

    const song = await getSongForStreaming(sql, trackId);
    if (!song) return null;

    const objectKey = await resolveObjectKeyCached(song.file_path);
    if (!objectKey) return null;

    const mime = safeMime({ rawMime: song.mime_type, filePathHint: song.file_path, objectKeyHint: objectKey });
    const stableHash = deriveStableContentHash({
        fileHash: song.file_hash,
        filePath: song.file_path,
        fileSize: song.file_size,
        mimeType: song.mime_type,
    });
    const trackRef = makePreferredTrackRef(song);

    const allVariants = parseQualityVariants(song.quality_variants);
    const qualities = allVariants.map((v) => {
        const vMime = variantMime(v);
        const entry: any = {
            tag: v.tag,
            bitrate: v.bitrate,
            codec: v.codec || 'aac',
            url: '',
            mime: vMime,
        };
        if (v.loudness) entry.loudness = v.loudness;
        return entry;
    });

    const entry: SessionCacheEntry = {
        url: '',
        mime,
        objectKey,
        contentHash: stableHash,
        trackRef,
        qualities,
        uploaderId: song.uploader_id != null ? Number(song.uploader_id) : null,
        isAvailable: song.is_available !== false,
    };

    setSessionCache(redis, trackId, entry, cfg.redis.sessionTtlSeconds).catch(() => undefined);

    return entry;
}

Bun.serve({
    hostname: '0.0.0.0',
    port: cfg.port,
    async fetch(req: Request, _server: Server<any>) {
        const startedAt = performance.now();
        let route = 'unknown';
        let status = 500;
        try {
            const response = await (async () => {
                try {
                    const url = new URL(req.url);
                    route = routeName(url.pathname);

                    if (url.pathname === '/metrics') {
                        return metricsResponse(metrics);
                    }

                    if (url.pathname === '/health') {
                        return text(200, 'ok');
                    }

                    const cacheSegmentResponse = await handleHlsCacheSegment(req, url);
                    if (cacheSegmentResponse) return cacheSegmentResponse;

                    const mediaResponse = await handlePlaybackMedia(req, url);
                    if (mediaResponse) return mediaResponse;

                    const directPlaybackResponse = await handleDirectPlaybackStream(req, url);
                    if (directPlaybackResponse) return directPlaybackResponse;

                    if (req.method === 'POST' && url.pathname === '/api/stream/v3/session') {
                        const requestUserId = readUserId(req);
                        if (!requestUserId) {
                            return json(401, { error: 'Authentication required', code: 'NO_SESSION' }, noStoreHeaders());
                        }

                        const body = await parseJsonBodyCapped(req, 8 * 1024);
                        const trackId = parsePositiveInt(body?.trackId);
                        if (!trackId) {
                            return json(400, { error: 'Invalid trackId', code: 'INVALID_TRACK_ID' }, noStoreHeaders());
                        }

                        const song = await getSongForStreaming(sql, trackId);
                        if (!song) {
                            return json(404, { error: 'Track not found', code: 'TRACK_NOT_FOUND' }, noStoreHeaders());
                        }

                        if (song.is_available === false) {
                            return json(410, { error: 'Track unavailable', code: 'TRACK_UNAVAILABLE' }, noStoreHeaders());
                        }

                        const allowed = mapPlaybackAccess({
                            requestUserId,
                            requestIsAdmin: isAdmin(req),
                        });
                        if (!allowed) {
                            return json(403, { error: 'Access denied', code: 'ACCESS_DENIED' }, noStoreHeaders());
                        }

                        const requestedMode = String(body?.mode || DIRECT_SESSION_MARKER).trim().toLowerCase();
                        const mode: 'direct' | 'hls' = requestedMode === 'hls' ? 'hls' : 'direct';
                        let manifestHash8B64Url = DIRECT_SESSION_MARKER;
                        if (mode === 'hls') {
                            const hlsManifestHash = await resolveHlsManifestHash8(song.id);
                            if (!hlsManifestHash || !(await isHlsReady(song.id, hlsManifestHash))) {
                                return json(503, { error: 'HLS is not ready', code: 'HLS_NOT_READY' }, noStoreHeaders({ 'Retry-After': '2' }));
                            }
                            manifestHash8B64Url = hlsManifestHash;
                        }
                        if (mode === 'direct') {
                            const entry = await resolveSessionEntry(trackId);
                            if (!entry) {
                                return json(404, { error: 'Track not found', code: 'TRACK_NOT_FOUND' }, noStoreHeaders());
                            }
                            if (entry.isAvailable === false) {
                                return json(410, { error: 'Track unavailable', code: 'TRACK_UNAVAILABLE' }, noStoreHeaders());
                            }

                            const record = await createPlaybackSession({
                                req,
                                song,
                                mode,
                                userId: requestUserId,
                                quality: normalizeQuality(body?.quality),
                                deviceId: normalizeDeviceId(body?.deviceId),
                                manifestHash8B64Url,
                            });
                            return directPlaybackSessionJson(record, entry, createDirectStreamCookieHeader(record, req));
                        }

                        const record = await createPlaybackSession({
                            req,
                            song,
                            mode,
                            userId: requestUserId,
                            quality: normalizeQuality(body?.quality),
                            deviceId: normalizeDeviceId(body?.deviceId),
                            manifestHash8B64Url,
                        });
                        const issued = createPlaybackToken({ record, nowMs: Date.now() });
                        return playbackSessionJson(record, issued.token, issued.expiresAtSec);
                    }

                    if (req.method === 'POST' && url.pathname.startsWith('/api/stream/v3/session/') && url.pathname.endsWith('/refresh')) {
                        const requestUserId = readUserId(req);
                        if (!requestUserId) {
                            return json(401, { error: 'Authentication required', code: 'NO_SESSION' }, noStoreHeaders());
                        }

                        const parts = url.pathname.split('/').filter(Boolean);
                        const sessionId = parts.length === 6 ? (parts[4] || '') : '';
                        if (!/^ps_[A-Za-z0-9_-]{20,96}$/.test(sessionId)) {
                            return json(400, { error: 'Invalid sessionId', code: 'INVALID_SESSION_ID' }, noStoreHeaders());
                        }

                        const record = await loadPlaybackSession(sessionId).catch(() => null);
                        if (!record) {
                            return json(401, { error: 'Playback session expired', code: 'PLAYBACK_SESSION_EXPIRED' }, noStoreHeaders());
                        }
                        if (record.userId !== requestUserId) {
                            return json(403, { error: 'Access denied', code: 'ACCESS_DENIED' }, noStoreHeaders());
                        }

                        const refreshed = await refreshPlaybackSessionRecord(record);
                        if (refreshed.mode === 'direct') {
                            const entry = await resolveSessionEntry(refreshed.trackId);
                            if (!entry) {
                                return json(404, { error: 'Track not found', code: 'TRACK_NOT_FOUND' }, noStoreHeaders());
                            }
                            return directPlaybackSessionJson(refreshed, entry, createDirectStreamCookieHeader(refreshed, req));
                        }
                        const issued = createPlaybackToken({ record: refreshed, nowMs: Date.now() });
                        return playbackSessionJson(refreshed, issued.token, issued.expiresAtSec);
                    }

                    if (req.method === 'POST' && url.pathname === '/api/stream/v2/session') {
                        return json(410, { error: 'Legacy direct stream disabled', code: 'LEGACY_STREAM_DISABLED' }, noStoreHeaders());
                    }

                    if (req.method === 'POST' && url.pathname === '/api/stream/v2/session/batch') {
                        return json(410, { error: 'Legacy direct stream disabled', code: 'LEGACY_STREAM_DISABLED' }, noStoreHeaders());
                    }

                    if (req.method === 'POST' && url.pathname === '/api/stream/v2/share') {
                        return json(410, { error: 'Legacy direct stream disabled', code: 'LEGACY_STREAM_DISABLED' }, noStoreHeaders());
                    }

                    if (req.method === 'GET' && url.pathname.startsWith('/audio/v1/')) {
                        if (isDirectLinkNavigationRequest(req)) {
                            return text(403, 'Forbidden', streamFailureHeaders('LEGACY_STREAM_DISABLED'));
                        }
                        return streamFailure(403, 'LEGACY_STREAM_DISABLED');
                    }

                    if (req.method === 'GET' && url.pathname.startsWith('/api/stream/v2/crypt/')) {
                        if (isDirectLinkNavigationRequest(req)) {
                            return text(403, 'Forbidden', streamFailureHeaders('LEGACY_STREAM_DISABLED'));
                        }
                        return json(410, { error: 'Legacy direct stream disabled', code: 'LEGACY_STREAM_DISABLED' }, noStoreHeaders());
                    }

                    return empty(404);
                } catch (e: any) {
                    const st = Number.isFinite(e?.status) ? Number(e.status) : 500;
                    if (st === 413) return json(413, { error: 'Payload too large', code: 'PAYLOAD_TOO_LARGE' });
                    if (st === 400) return json(400, { error: 'Invalid JSON', code: 'INVALID_JSON' });
                    return empty(503);
                }
            })();
            status = response.status;
            return response;
        } finally {
            metrics.recordHttp({
                method: req.method,
                route,
                status,
                durationSeconds: Math.max(0, performance.now() - startedAt) / 1000,
            });
        }
    },
});

process.on('SIGTERM', () => {
    try { sql.end(); } catch { }
    try { redis.disconnect(); } catch { }
    process.exit(0);
});
