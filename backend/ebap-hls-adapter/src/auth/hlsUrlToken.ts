import { createHmac } from 'node:crypto';
import { base64UrlToBytes, bytesToBase64Url } from '../lib/base64';
import { timingSafeEqual, utf8Bytes } from '../lib/bytes';

export type HlsUrlTokenClaims = {
    v: 1;
    kid: number;
    userId: string;
    trackId: number;
    manifestHash8B64Url: string;
    fileName: string;
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

function sign(secret: Uint8Array, payload: string): Uint8Array {
    const mac = createHmac('sha256', Buffer.from(secret)).update(utf8Bytes(payload)).digest();
    return new Uint8Array(mac);
}

function encodePayload(claims: HlsUrlTokenClaims): string {
    const fileB64Url = bytesToBase64Url(utf8Bytes(claims.fileName));
    return `${claims.v}.${claims.kid}.${claims.userId}.${claims.trackId}.${claims.manifestHash8B64Url}.${fileB64Url}.${claims.expSec}`;
}

export function createHlsUrlToken(params: {
    secrets: Uint8Array[];
    userId: string;
    trackId: number;
    manifestHash8B64Url: string;
    fileName: string;
    ttlSeconds: number;
    nowMs: number;
}): { token: string; claims: HlsUrlTokenClaims } {
    const secrets = Array.isArray(params.secrets) ? params.secrets : [];
    const secret = secrets[0];
    if (!(secret instanceof Uint8Array) || secret.byteLength === 0) {
        throw new Error('HLS_URLTOKEN_NO_SECRET');
    }

    const expSec = clampU32(Math.floor((params.nowMs + Math.max(1, Math.trunc(params.ttlSeconds)) * 1000) / 1000));
    const claims: HlsUrlTokenClaims = {
        v: 1,
        kid: 0,
        userId: String(params.userId || ''),
        trackId: (params.trackId >>> 0),
        manifestHash8B64Url: String(params.manifestHash8B64Url || ''),
        fileName: String(params.fileName || '').replace(/\\/g, '/'),
        expSec,
    };

    if (!claims.userId || claims.userId.length > 128) throw new Error('HLS_URLTOKEN_BAD_UID');
    if (!claims.manifestHash8B64Url) throw new Error('HLS_URLTOKEN_BAD_HASH8');
    if (!claims.fileName || claims.fileName.includes('..') || claims.fileName.startsWith('/')) throw new Error('HLS_URLTOKEN_BAD_FILE');

    const payload = encodePayload(claims);
    const sig = sign(secret, payload);
    return { token: `${payload}.${bytesToBase64Url(sig)}`, claims };
}

export function parseHlsUrlToken(params: {
    secrets: Uint8Array[];
    token: string;
    nowMs: number;
}): HlsUrlTokenClaims | null {
    const raw = String(params.token || '').trim();
    if (!raw) return null;

    const parts = raw.split('.');
    if (parts.length !== 8) return null;

    const [vStr, kidStr, userId, trackIdStr, hash8, fileB64Url, expSecStr, sigB64Url] = parts;
    if (!vStr || !kidStr || !userId || !trackIdStr || !hash8 || !fileB64Url || !expSecStr || !sigB64Url) return null;
    if (vStr !== '1') return null;
    if (userId.length > 128) return null;

    const kid = Number.parseInt(kidStr || '', 10);
    if (!Number.isFinite(kid) || kid < 0) return null;

    const trackId = Number.parseInt(trackIdStr || '', 10);
    if (!Number.isFinite(trackId) || trackId <= 0) return null;

    const expSec = Number.parseInt(expSecStr || '', 10);
    if (!Number.isFinite(expSec) || expSec <= 0) return null;

    const nowSec = Math.floor(params.nowMs / 1000);
    const leewaySec = 5;
    if (nowSec > expSec + leewaySec) return null;

    const sig = base64UrlToBytes(sigB64Url || '');
    if (sig.byteLength !== 32) return null;

    const fileBytes = base64UrlToBytes(fileB64Url || '');
    if (fileBytes.byteLength === 0 || fileBytes.byteLength > 512) return null;
    const fileName = new TextDecoder().decode(fileBytes).replace(/\\/g, '/');
    if (!fileName || fileName.includes('..') || fileName.startsWith('/')) return null;

    const payload = `${vStr}.${kidStr}.${userId}.${trackIdStr}.${hash8}.${fileB64Url}.${expSecStr}`;
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
        if (timingSafeEqual(expected, sig)) {
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
        manifestHash8B64Url: hash8,
        fileName,
        expSec: expSec >>> 0,
    };
}
