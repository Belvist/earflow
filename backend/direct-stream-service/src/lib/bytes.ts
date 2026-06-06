import { timingSafeEqual as cryptoTimingSafeEqual } from 'node:crypto';

export function utf8Bytes(s: string): Uint8Array {
    return new TextEncoder().encode(String(s ?? ''));
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
    try {
        const aa = Buffer.from(a);
        const bb = Buffer.from(b);
        if (aa.byteLength !== bb.byteLength) return false;
        return cryptoTimingSafeEqual(aa, bb);
    } catch {
        return false;
    }
}
