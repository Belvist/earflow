import type { Config } from '../config';
import type { S3Client } from '@aws-sdk/client-s3';
import { bytesToBase64 } from '../lib/base64';
import { u32be } from '../lib/bytes';
import { encryptTrackChunk, wrapTrackKeyForStorage } from '../crypto/crypto';
import { iterateOpusPacketsFromOggStream } from '../tools/oggStream';
import { putObjectBytes } from '../storage/s3';
import { opusPacketGetNbSamples } from '../ebap/opusPacketSamples';

type ChunkEntry = { index: number; key: string; size: number; sha256B64: string; samples: number };

type ManifestV3 = {
    version: 3;
    trackId: number;
    codec: 'opus';
    mime: 'application/ebap-opus-packets';
    sampleRate: 48000;
    totalSamples: number;
    trackSaltB64: string;
    trackKeyMasterIvB64: string;
    wrappedTrackKeyMasterB64: string;
    chunks: ChunkEntry[];
};

function concatBytes(parts: Uint8Array[]): Uint8Array {
    let total = 0;
    for (const p of parts) total += p.byteLength;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) {
        out.set(p, offset);
        offset += p.byteLength;
    }
    return out;
}

function encodePacketFrame(packet: Uint8Array): Uint8Array {
    return concatBytes([u32be(packet.byteLength >>> 0), packet]);
}

function utf8(bytes: Uint8Array): string {
    return new TextDecoder().decode(bytes);
}

function validateOpusTagsPacket(packet: Uint8Array): void {
    if (packet.byteLength < 8) throw new Error('Invalid Opus Ogg: missing OpusTags');
    if (utf8(packet.subarray(0, 8)) !== 'OpusTags') throw new Error('Invalid Opus Ogg: missing OpusTags');
}

async function sha256B64(bytes: Uint8Array): Promise<string> {
    const digestInput = bytes.slice().buffer;
    const digest = await crypto.subtle.digest('SHA-256', digestInput);
    return bytesToBase64(new Uint8Array(digest));
}

function createVersionId(): string {
    const t = Date.now().toString(36);
    const r = Math.floor(Math.random() * 0xffffffff).toString(36);
    return `v${t}${r}`;
}

export async function encodeEbapV3(params: {
    cfg: Config;
    s3: S3Client;
    abortSignal?: AbortSignal;
    trackId: number;
    inputOpusPath: string;
}): Promise<void> {
    if (!Number.isInteger(params.trackId) || params.trackId <= 0) {
        throw new Error('Invalid trackId');
    }

    const file = Bun.file(params.inputOpusPath);
    if (!(await file.exists())) throw new Error('Input file not found');

    const maxChunkBytes = params.cfg.limits.maxChunkBytes;
    const targetChunkSecondsRaw = params.cfg.limits.targetChunkSeconds;
    const targetChunkSeconds = Number.isFinite(Number(targetChunkSecondsRaw)) ? Math.max(1, Number(targetChunkSecondsRaw)) : 8;
    const targetChunkSamples = Math.floor(targetChunkSeconds * 48_000);

    const trackSalt = crypto.getRandomValues(new Uint8Array(32));
    const trackSaltB64 = bytesToBase64(trackSalt);
    const trackKey = crypto.getRandomValues(new Uint8Array(32));
    const versionId = createVersionId();
    const wrapped = await wrapTrackKeyForStorage({
        trackKeyMasterSecret: params.cfg.trackKeyMasterSecret,
        trackId: params.trackId,
        trackSalt,
        trackKey,
    });

    const uploaded: ChunkEntry[] = [];
    let chunkIndex = 0;
    let packetCount = 0;
    let totalSamples = 0;

    let curParts: Uint8Array[] = [];
    let curSize = 0;
    let curSamples = 0;

    const uploadQueue: Promise<void>[] = [];

    const waitForSlot = async () => {
        while (uploadQueue.length >= params.cfg.limits.maxInflightUploads) {
            const p = uploadQueue.shift();
            if (!p) break;
            await p;
        }
    };

    const flushChunk = async () => {
        if (curSize === 0) return;
        const plaintext = concatBytes(curParts);
        curParts = [];
        curSize = 0;
        const chunkSamples = curSamples;
        curSamples = 0;

        const key = `tracks/${params.trackId}/${versionId}/${chunkIndex}.bin`;
        const ciphertext = await encryptTrackChunk({ trackKey, chunkIndex, plaintext });
        const hashB64 = await sha256B64(ciphertext);

        await waitForSlot();
        const task = putObjectBytes({
            s3: params.s3,
            bucket: params.cfg.minio.bucketEbap,
            key,
            bytes: ciphertext,
            contentType: 'application/octet-stream',
            timeoutMs: params.cfg.limits.s3UploadTimeoutMs,
            abortSignal: params.abortSignal,
        });
        uploadQueue.push(task);

        uploaded.push({ index: chunkIndex, key, size: ciphertext.byteLength, sha256B64: hashB64, samples: chunkSamples });
        chunkIndex++;
    };

    const stream = file.stream();
    let secondPacket: Uint8Array | null = null;
    for await (const packet of iterateOpusPacketsFromOggStream(stream)) {
        packetCount++;
        if (packetCount === 2) secondPacket = packet;

        const frame = encodePacketFrame(packet);
        if (frame.byteLength > maxChunkBytes) throw new Error('Packet frame too large for chunk size');
        if (curSize > 0 && curSize + frame.byteLength > maxChunkBytes) {
            await flushChunk();
        }

        if (packetCount > 2) {
            const packetSamples = opusPacketGetNbSamples(packet, 48_000);
            if (packetSamples > 0) {
                curSamples += packetSamples;
                totalSamples += packetSamples;
            }
        }

        curParts.push(frame);
        curSize += frame.byteLength;

        if (targetChunkSamples > 0 && curSamples >= targetChunkSamples) {
            await flushChunk();
        }
    }

    if (!secondPacket) throw new Error('Invalid Opus Ogg: expected OpusTags');
    validateOpusTagsPacket(secondPacket);

    await flushChunk();
    if (uploaded.length === 0) throw new Error('No chunks produced');

    while (uploadQueue.length > 0) {
        const p = uploadQueue.shift();
        if (!p) break;
        await p;
    }

    const manifest: ManifestV3 = {
        version: 3,
        trackId: params.trackId,
        codec: 'opus',
        mime: 'application/ebap-opus-packets',
        sampleRate: 48_000,
        totalSamples,
        trackSaltB64,
        trackKeyMasterIvB64: bytesToBase64(wrapped.trackKeyMasterIv),
        wrappedTrackKeyMasterB64: bytesToBase64(wrapped.wrappedTrackKeyMaster),
        chunks: uploaded,
    };

    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));

    const manifestKeyVersioned = `${params.cfg.minio.manifestPrefix}${params.trackId}/${versionId}.json`;
    await putObjectBytes({
        s3: params.s3,
        bucket: params.cfg.minio.bucketEbap,
        key: manifestKeyVersioned,
        bytes: manifestBytes,
        contentType: 'application/json',
        timeoutMs: params.cfg.limits.s3UploadTimeoutMs,
        abortSignal: params.abortSignal,
    });

    const manifestKeyCanonical = `${params.cfg.minio.manifestPrefix}${params.trackId}.json`;
    await putObjectBytes({
        s3: params.s3,
        bucket: params.cfg.minio.bucketEbap,
        key: manifestKeyCanonical,
        bytes: manifestBytes,
        contentType: 'application/json',
        timeoutMs: params.cfg.limits.s3UploadTimeoutMs,
        abortSignal: params.abortSignal,
    });
}
