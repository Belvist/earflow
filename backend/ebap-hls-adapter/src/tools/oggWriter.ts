import { oggCrc32 } from './crc32';
import { concatBytes, u32le, u64le } from '../lib/bytes';

export type OggWriter = {
    pushPacket: (packet: Uint8Array, granulePos: bigint) => void;
    flushPage: () => void;
    finish: (granulePos: bigint) => Uint8Array;
};

export type OggSink = {
    write: (bytes: Uint8Array) => unknown;
    end: () => unknown;
};

export type OggStreamWriter = {
    pushPacket: (packet: Uint8Array, granulePos: bigint) => void;
    flushPage: () => void;
    finish: (granulePos: bigint) => void;
};

function u8(n: number): Uint8Array {
    return new Uint8Array([n & 0xff]);
}

function sliceCopy(src: Uint8Array): Uint8Array {
    const out = new Uint8Array(src.byteLength);
    out.set(src);
    return out;
}

function buildPage(params: {
    headerType: number;
    granulePos: bigint;
    serial: number;
    seq: number;
    segments: Uint8Array;
    body: Uint8Array;
}): Uint8Array {
    const header = concatBytes([
        new TextEncoder().encode('OggS'),
        u8(0),
        u8(params.headerType),
        u64le(params.granulePos),
        u32le(params.serial >>> 0),
        u32le(params.seq >>> 0),
        u32le(0),
        u8(params.segments.byteLength),
        params.segments,
    ]);

    const page = concatBytes([header, params.body]);

    const crc = oggCrc32(page);
    const view = new DataView(page.buffer, page.byteOffset, page.byteLength);
    view.setUint32(22, crc >>> 0, true);

    return page;
}

function createOggWriterCore(params: {
    serial?: number;
    maxSegmentBytes?: number;
    emitPage: (page: Uint8Array) => void;
    isFirstPage: () => boolean;
}): { pushPacket: (packet: Uint8Array, granulePos: bigint) => void; flushPage: () => void; finish: (granulePos: bigint) => void } {
    const serial = (params.serial ?? Math.floor(Math.random() * 0xffffffff)) >>> 0;
    const maxSegmentBytes = params.maxSegmentBytes ?? 255;

    let seq = 0;
    let curSegments: number[] = [];
    let curBodyParts: Uint8Array[] = [];
    let started = false;
    let pendingContinued = false;
    let curPageGranulePos = 0n;

    const flush = (headerType: number, granulePos: bigint) => {
        if (curSegments.length === 0) return;
        const segments = new Uint8Array(curSegments);
        const body = concatBytes(curBodyParts);
        const page = buildPage({ headerType, granulePos, serial, seq, segments, body });
        params.emitPage(page);
        seq = (seq + 1) >>> 0;
        curSegments = [];
        curBodyParts = [];
    };

    const flushCurrent = (eos: boolean) => {
        if (curSegments.length === 0) return;
        let headerType = 0;
        if (params.isFirstPage()) headerType |= 0x02;
        if (pendingContinued) headerType |= 0x01;
        if (eos) headerType |= 0x04;
        flush(headerType, curPageGranulePos);
        pendingContinued = false;
    };

    const flushPage = () => {
        flushCurrent(false);
    };

    const pushPacket = (packet: Uint8Array, granulePos: bigint) => {
        const bytes = sliceCopy(packet);
        if (!started) started = true;

        curPageGranulePos = granulePos;
        const needsTerminator = bytes.byteLength > 0 && bytes.byteLength % 255 === 0;

        let off = 0;
        while (off < bytes.byteLength) {
            if (curSegments.length >= 255) {
                flushCurrent(false);
                pendingContinued = true;
            }

            const remaining = bytes.byteLength - off;
            const segLen = Math.min(maxSegmentBytes, remaining);
            curSegments.push(segLen);
            curBodyParts.push(bytes.subarray(off, off + segLen));
            off += segLen;
        }

        const terminatorNeeded = bytes.byteLength === 0 || needsTerminator;
        if (terminatorNeeded) {
            if (curSegments.length >= 255) {
                flushCurrent(false);
                pendingContinued = true;
            }
            curSegments.push(0);
        }
    };

    const finish = (granulePos: bigint) => {
        if (!started) {
            throw new Error('OGG_NO_PACKETS');
        }
        curPageGranulePos = granulePos;
        flushCurrent(true);
    };

    return { pushPacket, flushPage, finish };
}

export function createOggStreamWriter(params: { sink: OggSink; serial?: number; maxSegmentBytes?: number }): OggStreamWriter {
    let wroteAny = false;
    const core = createOggWriterCore({
        serial: params.serial,
        maxSegmentBytes: params.maxSegmentBytes,
        emitPage: (page) => {
            wroteAny = true;
            params.sink.write(page);
        },
        isFirstPage: () => !wroteAny,
    });

    return {
        pushPacket: core.pushPacket,
        flushPage: core.flushPage,
        finish: (granulePos) => {
            core.finish(granulePos);
            if (!wroteAny) throw new Error('OGG_NO_PAGES');
            params.sink.end();
        },
    };
}

export function createOggWriter(params: { serial?: number; maxSegmentBytes?: number }): OggWriter {
    const pages: Uint8Array[] = [];
    const core = createOggWriterCore({
        serial: params.serial,
        maxSegmentBytes: params.maxSegmentBytes,
        emitPage: (page) => {
            pages.push(page);
        },
        isFirstPage: () => pages.length === 0,
    });

    return {
        pushPacket: core.pushPacket,
        flushPage: core.flushPage,
        finish: (granulePos) => {
            core.finish(granulePos);
            if (pages.length === 0) throw new Error('OGG_NO_PAGES');
            return concatBytes(pages);
        },
    };
}
