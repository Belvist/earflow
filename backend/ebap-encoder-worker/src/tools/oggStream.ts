export type OggPacketStream = AsyncGenerator<Uint8Array, void, void>;

type State = {
    buf: Uint8Array;
    start: number;
    end: number;
    serial: number | null;
    expectedSeq: number | null;
    partial: Uint8Array[];
    seenFirstPacket: boolean;
};

function isOggMagic(bytes: Uint8Array, offset: number): boolean {
    return bytes[offset] === 0x4f && bytes[offset + 1] === 0x67 && bytes[offset + 2] === 0x67 && bytes[offset + 3] === 0x53;
}

function readU32le(view: DataView, offset: number): number {
    return view.getUint32(offset, true);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
    let total = 0;
    for (const p of parts) total += p.byteLength;
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
        out.set(p, o);
        o += p.byteLength;
    }
    return out;
}

function ensureCapacity(state: State, additional: number): void {
    const needed = state.end + additional;
    if (needed <= state.buf.byteLength) return;

    const avail = state.end - state.start;
    const minCap = avail + additional;
    const nextCap = Math.max(state.buf.byteLength * 2, minCap, 1024);
    const next = new Uint8Array(nextCap);
    next.set(state.buf.subarray(state.start, state.end), 0);
    state.buf = next;
    state.start = 0;
    state.end = avail;
}

function compactIfNeeded(state: State): void {
    if (state.start === 0) return;
    const avail = state.end - state.start;
    if (avail === 0) {
        state.start = 0;
        state.end = 0;
        return;
    }
    if (state.start < state.buf.byteLength / 2) return;

    state.buf.copyWithin(0, state.start, state.end);
    state.start = 0;
    state.end = avail;
}

function appendChunk(state: State, chunk: Uint8Array): void {
    ensureCapacity(state, chunk.byteLength);
    state.buf.set(chunk, state.end);
    state.end += chunk.byteLength;
}

function viewAvailable(state: State): Uint8Array {
    return new Uint8Array(state.buf.buffer, state.buf.byteOffset + state.start, state.end - state.start);
}

function utf8(bytes: Uint8Array): string {
    return new TextDecoder().decode(bytes);
}

function validateFirstPacket(packet: Uint8Array): void {
    if (packet.byteLength < 8) throw new Error('Invalid Opus Ogg: missing OpusHead');
    if (utf8(packet.subarray(0, 8)) !== 'OpusHead') throw new Error('Invalid Opus Ogg: missing OpusHead');
}

function sliceCopy(src: Uint8Array, start: number, end: number): Uint8Array {
    const out = new Uint8Array(end - start);
    out.set(src.subarray(start, end));
    return out;
}

function tryParseOnePage(state: State): { packets: Uint8Array[]; consumed: number } | null {
    const buf = viewAvailable(state);
    if (buf.byteLength < 27) return null;
    if (!isOggMagic(buf, 0)) throw new Error('Invalid Ogg: missing capture pattern');

    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const version = view.getUint8(4);
    if (version !== 0) throw new Error('Invalid Ogg: unsupported version');

    const headerType = view.getUint8(5);
    const serial = readU32le(view, 14);
    const seq = readU32le(view, 18);
    const pageSegments = view.getUint8(26);

    const headerSize = 27 + pageSegments;
    if (buf.byteLength < headerSize) return null;

    let bodySize = 0;
    for (let i = 0; i < pageSegments; i++) {
        const seg = buf[27 + i];
        if (seg === undefined) throw new Error('Invalid Ogg: truncated segment table');
        bodySize += seg;
    }

    const totalSize = headerSize + bodySize;
    if (buf.byteLength < totalSize) return null;

    if (state.serial === null) {
        state.serial = serial;
        state.expectedSeq = seq;
    }

    if (state.serial !== serial) throw new Error('Invalid Ogg: multiple logical streams not supported');
    if (state.expectedSeq !== seq) throw new Error('Invalid Ogg: non-contiguous page sequence');
    state.expectedSeq = (seq + 1) >>> 0;

    const continued = (headerType & 0x01) !== 0;
    if (state.partial.length > 0 && !continued) throw new Error('Invalid Ogg: missing continuation flag');
    if (state.partial.length === 0 && continued && !state.seenFirstPacket) throw new Error('Invalid Ogg: unexpected continuation');

    const packets: Uint8Array[] = [];
    let bodyPos = headerSize;

    for (let i = 0; i < pageSegments; i++) {
        const segLen = buf[27 + i];
        if (segLen === undefined) throw new Error('Invalid Ogg: truncated segment table');
        const segStart = bodyPos;
        const segEnd = bodyPos + segLen;
        state.partial.push(sliceCopy(buf, segStart, segEnd));
        bodyPos = segEnd;

        if (segLen < 255) {
            const packet = concatBytes(state.partial);
            state.partial = [];
            if (!state.seenFirstPacket) {
                validateFirstPacket(packet);
                state.seenFirstPacket = true;
            }
            packets.push(packet);
        }
    }

    return { packets, consumed: totalSize };
}

export async function* iterateOpusPacketsFromOggStream(stream: ReadableStream<Uint8Array>): OggPacketStream {
    const reader = stream.getReader();
    const state: State = {
        buf: new Uint8Array(1024 * 64),
        start: 0,
        end: 0,
        serial: null,
        expectedSeq: null,
        partial: [],
        seenFirstPacket: false,
    };

    try {
        while (true) {
            while (true) {
                const parsed = tryParseOnePage(state);
                if (!parsed) break;

                for (const p of parsed.packets) {
                    yield p;
                }

                state.start += parsed.consumed;
                compactIfNeeded(state);
            }

            const r = await reader.read();
            if (r.done) break;
            if (!(r.value instanceof Uint8Array)) throw new Error('Invalid stream chunk');
            appendChunk(state, r.value);
        }

        if (state.end - state.start !== 0) throw new Error('Invalid Ogg: trailing bytes');
        if (state.partial.length !== 0) throw new Error('Invalid Ogg: trailing partial packet');
        if (!state.seenFirstPacket) throw new Error('Invalid Ogg: no packets');
    } finally {
        try {
            await reader.cancel();
        } catch {
        }
    }
}
