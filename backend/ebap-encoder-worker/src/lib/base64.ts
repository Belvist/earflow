export function base64ToBytes(b64: string): Uint8Array {
    if (typeof atob !== 'function') {
        throw new Error('base64 not supported');
    }
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
        out[i] = bin.charCodeAt(i) & 0xff;
    }
    return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
    if (typeof btoa !== 'function') {
        throw new Error('base64 not supported');
    }
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.byteLength; i += chunk) {
        const part = bytes.subarray(i, i + chunk);
        bin += String.fromCharCode(...part);
    }
    return btoa(bin);
}
