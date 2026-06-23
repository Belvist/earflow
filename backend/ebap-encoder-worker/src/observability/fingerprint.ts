function byteToHex(b: number): string {
    return (b & 0xff).toString(16).padStart(2, '0');
}

export async function keyFingerprint8Hex(secret: Uint8Array): Promise<string> {
    const data = Uint8Array.from(secret);
    const digest = await crypto.subtle.digest('SHA-256', data);
    const bytes = new Uint8Array(digest);
    const prefix = bytes.subarray(0, 4);
    let out = '';
    for (const b of prefix) out += byteToHex(b);
    return out;
}
