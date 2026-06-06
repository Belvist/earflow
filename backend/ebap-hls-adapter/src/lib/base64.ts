export function bytesToBase64(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64');
}

export function base64ToBytes(b64: string): Uint8Array {
    const s = String(b64 || '').trim();
    if (!s) return new Uint8Array();
    return new Uint8Array(Buffer.from(s, 'base64'));
}

export function bytesToBase64Url(bytes: Uint8Array): string {
    return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlToBytes(b64url: string): Uint8Array {
    const s = String(b64url || '').trim();
    if (!s) return new Uint8Array();
    const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
    return base64ToBytes(padded);
}
