export function utf8Bytes(s: string): Uint8Array {
    return new TextEncoder().encode(s);
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const start = bytes.byteOffset;
    const end = start + bytes.byteLength;
    return bytes.buffer.slice(start, end) as ArrayBuffer;
}

export function u32be(n: number): Uint8Array {
    const out = new Uint8Array(4);
    const view = new DataView(out.buffer);
    view.setUint32(0, n >>> 0, false);
    return out;
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.byteLength !== b.byteLength) return false;
    let diff = 0;
    for (let i = 0; i < a.byteLength; i++) diff |= a[i]! ^ b[i]!;
    return diff === 0;
}
