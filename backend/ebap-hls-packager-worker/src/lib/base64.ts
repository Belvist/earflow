export function bytesToBase64(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64');
}

export function base64ToBytes(b64: string): Uint8Array {
    const s = String(b64 || '').trim();
    if (!s) return new Uint8Array();
    return new Uint8Array(Buffer.from(s, 'base64'));
}

export function bytesToBase64Url(bytes: Uint8Array): string {
    return bytesToBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replaceAll(/=+$/g, '');
}
