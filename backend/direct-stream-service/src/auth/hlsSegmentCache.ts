import { createHmac, timingSafeEqual as cryptoTse } from 'node:crypto';

import { bytesToBase64Url, base64UrlToBytes } from '../lib/base64';

export type HlsSegmentCacheParams = {
    trackId: number;
    manifestHash8B64Url: string;
    variant: string;
    asset: string;
    expSec: number;
};

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

function encodePayload(params: HlsSegmentCacheParams): string {
    return [
        '1',
        String(params.trackId >>> 0),
        params.manifestHash8B64Url,
        params.variant,
        params.asset,
        String(params.expSec >>> 0),
    ].join('|');
}

/** Bucketed expiry so segment URLs stay stable within the TTL window (CDN cache sharing). */
export function hlsSegmentCacheExpSec(nowMs: number, ttlSeconds: number): number {
    const nowSec = Math.floor(nowMs / 1000);
    const ttl = Math.max(3600, Math.trunc(ttlSeconds));
    const periodStart = Math.floor(nowSec / ttl) * ttl;
    return periodStart + ttl;
}

export function createHlsSegmentCacheSig(params: {
    secrets: Uint8Array[];
    trackId: number;
    manifestHash8B64Url: string;
    variant: string;
    asset: string;
    expSec: number;
}): string {
    const secrets = Array.isArray(params.secrets) ? params.secrets : [];
    const secret = secrets[0];
    if (!(secret instanceof Uint8Array) || secret.byteLength === 0) {
        throw new Error('HLS_SEGMENT_CACHE_NO_SECRET');
    }

    const payload = encodePayload({
        trackId: params.trackId,
        manifestHash8B64Url: params.manifestHash8B64Url,
        variant: params.variant,
        asset: params.asset,
        expSec: params.expSec,
    });
    return bytesToBase64Url(sign(secret, payload));
}

export function verifyHlsSegmentCacheSig(params: {
    secrets: Uint8Array[];
    trackId: number;
    manifestHash8B64Url: string;
    variant: string;
    asset: string;
    expSec: number;
    sig: string;
    nowMs: number;
}): boolean {
    const expSec = Math.trunc(params.expSec);
    if (!Number.isFinite(expSec) || expSec <= 0) return false;

    const nowSec = Math.floor(params.nowMs / 1000);
    if (nowSec > expSec + 30) return false;

    const sigRaw = String(params.sig || '').trim();
    if (!sigRaw) return false;

    const sig = base64UrlToBytes(sigRaw);
    if (sig.byteLength !== 32) return false;

    const payload = encodePayload({
        trackId: params.trackId,
        manifestHash8B64Url: params.manifestHash8B64Url,
        variant: params.variant,
        asset: params.asset,
        expSec,
    });

    const secrets = Array.isArray(params.secrets) ? params.secrets : [];
    for (const secret of secrets) {
        if (!(secret instanceof Uint8Array) || secret.byteLength === 0) continue;
        const expected = sign(secret, payload);
        if (safeEqual(expected, sig)) return true;
    }
    return false;
}

export function buildHlsSegmentCacheUrl(params: {
    publicOrigin: string;
    trackId: number;
    manifestHash8B64Url: string;
    variant: string;
    asset: string;
    expSec: number;
    sig: string;
}): string {
    const origin = String(params.publicOrigin || '').trim().replace(/\/+$/, '');
    const trackId = params.trackId >>> 0;
    const manifestHash = encodeURIComponent(params.manifestHash8B64Url);
    const variant = encodeURIComponent(params.variant);
    const asset = encodeURIComponent(params.asset);
    const exp = String(params.expSec >>> 0);
    const sig = encodeURIComponent(params.sig);
    return `${origin}/audio/v3/cache/${trackId}/${manifestHash}/${variant}/${asset}?exp=${exp}&sig=${sig}`;
}
