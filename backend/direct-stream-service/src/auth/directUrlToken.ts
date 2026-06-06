import { createHmac, timingSafeEqual as cryptoTse } from 'node:crypto';
import { base64UrlToBytes, base64UrlToUtf8, bytesToBase64Url, utf8ToBase64Url } from '../lib/base64';

export type DirectUrlTokenClaims = {
    v: 1;
    kid: number;
    userId: string;
    trackId: number;
    objectKey: string;
    mime: string;
    expSec: number;
};

function clampU32(n: number): number {
    if (!Number.isFinite(n)) return 0;
    if (n <= 0) return 0;
    return Math.min(0xffffffff, Math.trunc(n));
}

function clampKid(n: number): number {
    if (!Number.isFinite(n)) return 0;
    if (n < 0) return 0;
    return Math.min(1024, Math.trunc(n));
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

function sign(secret: Uint8Array, payload: string): Uint8Array {
    const mac = createHmac('sha256', Buffer.from(secret)).update(payload).digest();
    return new Uint8Array(mac);
}

function encodePayload(claims: DirectUrlTokenClaims): string {
    const keyB64u = utf8ToBase64Url(claims.objectKey);
    const mimeB64u = utf8ToBase64Url(claims.mime);
    return `${claims.v}.${claims.kid}.${claims.userId}.${claims.trackId}.${keyB64u}.${mimeB64u}.${claims.expSec}`;
}

export function createDirectUrlToken(params: {
    secrets: Uint8Array[];
    userId: string;
    trackId: number;
    objectKey: string;
    mime: string;
    ttlSeconds: number;
    nowMs: number;
}): { token: string; claims: DirectUrlTokenClaims } {
    const secrets = Array.isArray(params.secrets) ? params.secrets : [];
    const secret = secrets[0];
    if (!(secret instanceof Uint8Array) || secret.byteLength === 0) {
        throw new Error('DIRECT_URLTOKEN_NO_SECRET');
    }

    const expSec = clampU32(Math.floor((params.nowMs + Math.max(1, Math.trunc(params.ttlSeconds)) * 1000) / 1000));
    const claims: DirectUrlTokenClaims = {
        v: 1,
        kid: 0,
        userId: String(params.userId || ''),
        trackId: (params.trackId >>> 0),
        objectKey: String(params.objectKey || '').replace(/\\/g, '/').replace(/^\/+/, ''),
        mime: String(params.mime || ''),
        expSec,
    };

    if (!claims.userId || claims.userId.length > 128) throw new Error('DIRECT_URLTOKEN_BAD_UID');
    if (!claims.objectKey || claims.objectKey.includes('..') || claims.objectKey.startsWith('/')) throw new Error('DIRECT_URLTOKEN_BAD_KEY');
    if (!claims.mime || claims.mime.length > 96) throw new Error('DIRECT_URLTOKEN_BAD_MIME');

    const payload = encodePayload(claims);
    const sig = sign(secret, payload);
    return { token: `${payload}.${bytesToBase64Url(sig)}`, claims };
}

export function parseDirectUrlToken(params: {
    secrets: Uint8Array[];
    token: string;
    nowMs: number;
}): DirectUrlTokenClaims | null {
    const raw = String(params.token || '').trim();
    if (!raw) return null;

    const parts = raw.split('.');
    if (parts.length !== 8) return null;

    const [vStr, kidStr, userId, trackIdStr, keyB64u, mimeB64u, expSecStr, sigB64u] = parts;
    if (!vStr || !kidStr || !userId || !trackIdStr || !keyB64u || !mimeB64u || !expSecStr || !sigB64u) return null;
    if (vStr !== '1') return null;

    const kid = Number.parseInt(kidStr || '', 10);
    if (!Number.isFinite(kid) || kid < 0) return null;

    const trackId = Number.parseInt(trackIdStr || '', 10);
    if (!Number.isFinite(trackId) || trackId <= 0) return null;

    const expSec = Number.parseInt(expSecStr || '', 10);
    if (!Number.isFinite(expSec) || expSec <= 0) return null;

    const nowSec = Math.floor(params.nowMs / 1000);
    const leewaySec = 5;
    if (nowSec > expSec + leewaySec) return null;

    const sig = base64UrlToBytes(sigB64u || '');
    if (sig.byteLength !== 32) return null;

    const objectKey = base64UrlToUtf8(keyB64u || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!objectKey || objectKey.includes('..') || objectKey.startsWith('/')) return null;

    const mime = base64UrlToUtf8(mimeB64u || '');
    if (!mime || mime.length > 96) return null;

    const payload = `${vStr}.${kidStr}.${userId}.${trackIdStr}.${keyB64u}.${mimeB64u}.${expSecStr}`;

    const secrets = Array.isArray(params.secrets) ? params.secrets : [];
    if (secrets.length === 0) return null;

    const kidClamped = clampKid(kid);
    const startIdx = kidClamped >= 0 && kidClamped < secrets.length ? kidClamped : 0;

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
        const expected = sign(secret, payload);
        if (safeEqual(expected, sig)) {
            ok = true;
            break;
        }
    }
    if (!ok) return null;

    return {
        v: 1,
        kid: kid >>> 0,
        userId,
        trackId: trackId >>> 0,
        objectKey,
        mime,
        expSec: expSec >>> 0,
    };
}
