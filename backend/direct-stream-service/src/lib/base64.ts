export function bytesToBase64Url(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64url');
}

export function base64UrlToBytes(b64u: string): Uint8Array {
    const raw = String(b64u || '').trim();
    if (!raw) return new Uint8Array();
    const buf = Buffer.from(raw, 'base64url');
    return new Uint8Array(buf);
}

export function utf8ToBase64Url(s: string): string {
    return Buffer.from(String(s || ''), 'utf8').toString('base64url');
}

export function base64UrlToUtf8(b64u: string): string {
    const bytes = base64UrlToBytes(b64u);
    if (bytes.byteLength === 0) return '';
    try {
        return new TextDecoder().decode(bytes);
    } catch {
        return '';
    }
}
