export function* iterateEbapPacketFrames(plaintext: Uint8Array): Generator<Uint8Array> {
    const view = new DataView(plaintext.buffer, plaintext.byteOffset, plaintext.byteLength);
    let off = 0;

    while (off < plaintext.byteLength) {
        if (off + 4 > plaintext.byteLength) {
            throw new Error('EBAP_FRAME_TRUNCATED');
        }

        const len = view.getUint32(off, false);
        off += 4;

        const end = off + len;
        if (end > plaintext.byteLength) {
            throw new Error('EBAP_FRAME_OVERFLOW');
        }

        yield plaintext.subarray(off, end);
        off = end;
    }
}
