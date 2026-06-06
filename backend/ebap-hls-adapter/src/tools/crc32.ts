const TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let r = (i << 24) >>> 0;
        for (let j = 0; j < 8; j++) {
            const msb = (r & 0x80000000) !== 0;
            r = (r << 1) >>> 0;
            if (msb) r ^= 0x04c11db7;
        }
        table[i] = r >>> 0;
    }
    return table;
})();

export function oggCrc32(bytes: Uint8Array): number {
    let crc = 0;
    for (let i = 0; i < bytes.byteLength; i++) {
        const b = bytes[i]!;
        const idx = ((crc >>> 24) ^ b) & 0xff;
        crc = ((crc << 8) ^ TABLE[idx]!) >>> 0;
    }
    return crc >>> 0;
}
