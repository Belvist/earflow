import { createHmac } from 'node:crypto';
import { base64UrlToBytes, bytesToBase64Url } from '../lib/base64';
import { timingSafeEqual, utf8Bytes } from '../lib/bytes';

export type HlsCookieClaims = {
    v: 1;
    userId: string;
    trackId: number;
    manifestHash8B64Url: string;
    expSec: number;
};

function clampU32(n: number): number {
    if (!Number.isFinite(n)) return 0;
    if (n <= 0) return 0;
    return Math.min(0xffffffff, Math.trunc(n));
}

function encodeClaims(claims: HlsCookieClaims): string {
    const payload = `${claims.v}.${claims.userId}.${claims.trackId}.${claims.manifestHash8B64Url}.${claims.expSec}`;
    return payload;
}

function sign(secret: Uint8Array, payload: string): Uint8Array {
    const mac = createHmac('sha256', Buffer.from(secret)).update(utf8Bytes(payload)).digest();
    return new Uint8Array(mac);
}

export function createHlsCookieValue(params: {
    secret: Uint8Array;
    userId: string;
    trackId: number;
    manifestHash8: Uint8Array;
    ttlSeconds: number;
    nowMs: number;
}): { value: string; claims: HlsCookieClaims } {
    const expSec = clampU32(Math.floor((params.nowMs + params.ttlSeconds * 1000) / 1000));
    const claims: HlsCookieClaims = {
        v: 1,
        userId: params.userId,
        trackId: params.trackId >>> 0,
        manifestHash8B64Url: bytesToBase64Url(params.manifestHash8),
        expSec,
    };

    const payload = encodeClaims(claims);
    const sig = sign(params.secret, payload);
    return { value: `${payload}.${bytesToBase64Url(sig)}`, claims };
}

export function parseHlsCookieValue(params: {
    secrets: Uint8Array[];
    cookieValue: string;
    nowMs: number;
}): HlsCookieClaims | null {
    const raw = String(params.cookieValue || '').trim();
    if (!raw) return null;

    const parts = raw.split('.');
    if (parts.length !== 6) return null;

    const [vStr, userId, trackIdStr, hash8, expSecStr, sigB64Url] = parts;
    if (!vStr || !userId || !trackIdStr || !hash8 || !expSecStr || !sigB64Url) return null;
    if (vStr !== '1') return null;
    if (userId.length > 128) return null;

    const trackId = Number.parseInt(trackIdStr || '', 10);
    if (!Number.isFinite(trackId) || trackId <= 0) return null;

    const expSec = Number.parseInt(expSecStr || '', 10);
    if (!Number.isFinite(expSec) || expSec <= 0) return null;

    const nowSec = Math.floor(params.nowMs / 1000);
    if (nowSec >= expSec) return null;

    const sig = base64UrlToBytes(sigB64Url || '');
    if (sig.byteLength !== 32) return null;

    const payload = `${vStr}.${userId}.${trackIdStr}.${hash8}.${expSecStr}`;
    const secrets = Array.isArray(params.secrets) ? params.secrets : [];
    if (secrets.length === 0) return null;

    let ok = false;
    for (const secret of secrets) {
        if (!(secret instanceof Uint8Array) || secret.byteLength === 0) continue;
        const expected = sign(secret, payload);
        if (timingSafeEqual(expected, sig)) {
            ok = true;
            break;
        }
    }
    if (!ok) return null;

    return {
        v: 1,
        userId,
        trackId: trackId >>> 0,
        manifestHash8B64Url: hash8,
        expSec: expSec >>> 0,
    };
}
