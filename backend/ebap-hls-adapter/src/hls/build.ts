import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { S3Client } from '@aws-sdk/client-s3';
import type { Config } from '../config';
import { base64ToBytes } from '../lib/base64';
import { decryptTrackChunk, unwrapTrackKeyFromStorage } from '../crypto/crypto';
import { iterateEbapPacketFrames } from '../ebap/packetFrames';
import { opusPacketGetNbSamples } from '../ebap/opusPacketSamples';
import type { EbapManifestV3 } from '../ebap/manifest';
import { createOggStreamWriter } from '../tools/oggWriter';
import { getObjectBytesCapped, putObjectBytes } from '../storage/s3';
import { transcodeOpusToHlsCmaf } from '../ffmpeg/transcodeToHls';

const OPUS_HEAD = new TextEncoder().encode('OpusHead');
const OPUS_TAGS = new TextEncoder().encode('OpusTags');

function startsWithPrefix(bytes: Uint8Array, prefix: Uint8Array): boolean {
    if (bytes.byteLength < prefix.byteLength) return false;
    for (let i = 0; i < prefix.byteLength; i++) {
        if (bytes[i] !== prefix[i]) return false;
    }
    return true;
}

function makeOpusHead(params: { channels: number; preSkip: number; inputSampleRate: number }): Uint8Array {
    const channels = Math.max(1, Math.min(255, Math.trunc(params.channels)));
    const preSkip = Math.max(0, Math.min(65535, Math.trunc(params.preSkip)));
    const inputSampleRate = Math.max(1, Math.trunc(params.inputSampleRate));

    const out = new Uint8Array(19);
    out.set(OPUS_HEAD, 0);
    out[8] = 1;
    out[9] = channels;
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    view.setUint16(10, preSkip, true);
    view.setUint32(12, inputSampleRate >>> 0, true);
    view.setInt16(16, 0, true);
    out[18] = 0;
    return out;
}

function opusPacketChannels(packet: Uint8Array): number {
    if (!packet || packet.byteLength < 1) return 2;
    const toc = packet[0] ?? 0;
    const stereoFlag = (toc >> 5) & 0x01;
    return stereoFlag ? 2 : 1;
}

function makeOpusTags(vendor: string): Uint8Array {
    const v = typeof vendor === 'string' ? vendor : '';
    const vBytes = new TextEncoder().encode(v);
    const out = new Uint8Array(8 + 4 + vBytes.byteLength + 4);
    out.set(OPUS_TAGS, 0);
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    view.setUint32(8, vBytes.byteLength >>> 0, true);
    out.set(vBytes, 12);
    view.setUint32(12 + vBytes.byteLength, 0, true);
    return out;
}

function hlsBaseKey(cfg: Config, trackId: number, manifestHash8B64Url: string): string {
    return `${cfg.minio.hlsPrefix}${trackId}/${manifestHash8B64Url}/`;
}

export function hlsKeyForFile(cfg: Config, trackId: number, manifestHash8B64Url: string, fileName: string): string {
    const safe = fileName.replace(/\\/g, '/');
    if (safe.includes('..')) throw new Error('HLS_BAD_NAME');
    if (safe.startsWith('/')) throw new Error('HLS_BAD_NAME');
    return `${hlsBaseKey(cfg, trackId, manifestHash8B64Url)}${safe}`;
}

export async function buildHlsArtifacts(params: {
    cfg: Config;
    s3: S3Client;
    manifest: EbapManifestV3;
    manifestHash8B64Url: string;
    manifestBytes: Uint8Array;
    jobDir: string;
    abortSignal?: AbortSignal;
}): Promise<{ files: { name: string; bytes: Uint8Array; contentType: string }[]; cleanup: () => Promise<void> }> {
    const trackId = params.manifest.trackId;

    const trackSalt = base64ToBytes(params.manifest.trackSaltB64);
    const iv = base64ToBytes(params.manifest.trackKeyMasterIvB64);
    const wrapped = base64ToBytes(params.manifest.wrappedTrackKeyMasterB64);

    let trackKey: Uint8Array | null = null;
    for (const masterSecret of params.cfg.trackKeyMasterSecrets) {
        try {
            trackKey = await unwrapTrackKeyFromStorage({
                trackKeyMasterSecret: masterSecret,
                trackId,
                trackSalt,
                trackKeyMasterIv: iv,
                wrappedTrackKeyMaster: wrapped,
            });
            if (trackKey.byteLength === 32) break;
        } catch {
            trackKey = null;
        }
    }

    if (!trackKey || trackKey.byteLength !== 32) {
        throw new Error('EBAP_TRACKKEY_UNWRAP_FAILED');
    }

    await mkdir(params.jobDir, { recursive: true, mode: 0o700 });
    const opusPath = join(params.jobDir, 'track.opus');

    const fileSink = Bun.file(opusPath).writer();
    let endResult: unknown = null;
    let sinkEnded = false;
    const sink = {
        write: (bytes: Uint8Array) => fileSink.write(bytes),
        end: () => {
            endResult = fileSink.end();
            return endResult;
        },
    };
    const ogg = createOggStreamWriter({ sink });

    let totalSamples = 0;
    let sawOpusHead = false;
    let sawOpusTags = false;

    try {
        const chunks = params.manifest.chunks
            .slice()
            .sort((a: EbapManifestV3['chunks'][number], b: EbapManifestV3['chunks'][number]) => a.index - b.index);
        if (chunks.length === 0) throw new Error('EBAP_NO_CHUNKS');

        const canPrefetch = params.cfg.limits.maxInflightBytes >= params.cfg.limits.maxChunkBytes * 2;
        const loadCiphertext = async (key: string): Promise<Uint8Array> => {
            const { bytes } = await getObjectBytesCapped({
                s3: params.s3,
                bucket: params.cfg.minio.bucketEbap,
                key,
                maxBytes: params.cfg.limits.maxChunkBytes,
                timeoutMs: params.cfg.minio.s3TimeoutMs,
            });
            return bytes;
        };

        const first = chunks[0];
        if (!first) throw new Error('EBAP_NO_CHUNKS');

        let currentPromise: Promise<Uint8Array> = loadCiphertext(first.key);

        for (let i = 0; i < chunks.length; i++) {
            const ch = chunks[i];
            if (!ch) throw new Error('EBAP_BAD_CHUNK_INDEX');

            const next = i + 1 < chunks.length ? chunks[i + 1] : undefined;
            const nextPromise = canPrefetch && next ? loadCiphertext(next.key) : null;

            const ciphertext = await currentPromise;
            if (nextPromise) currentPromise = nextPromise;
            else if (!canPrefetch && next) currentPromise = loadCiphertext(next.key);

            const plaintext = await decryptTrackChunk({ trackKey, chunkIndex: ch.index, ciphertext });

            for (const packet of iterateEbapPacketFrames(plaintext)) {
                if (!sawOpusHead) {
                    if (startsWithPrefix(packet, OPUS_HEAD)) {
                        sawOpusHead = true;
                        ogg.pushPacket(packet, 0n);
                        ogg.flushPage();
                        continue;
                    }

                    ogg.pushPacket(makeOpusHead({ channels: opusPacketChannels(packet), preSkip: 312, inputSampleRate: params.manifest.sampleRate }), 0n);
                    ogg.flushPage();
                    ogg.pushPacket(makeOpusTags('earflow'), 0n);
                    ogg.flushPage();
                    sawOpusHead = true;
                    sawOpusTags = true;
                }

                if (!sawOpusTags && startsWithPrefix(packet, OPUS_TAGS)) {
                    sawOpusTags = true;
                    ogg.pushPacket(packet, 0n);
                    ogg.flushPage();
                    continue;
                }

                const samples = opusPacketGetNbSamples(packet, 48_000);
                totalSamples += Math.max(0, samples);
                ogg.pushPacket(packet, BigInt(totalSamples));
            }
        }

        ogg.finish(BigInt(totalSamples));
        sinkEnded = true;
        const maybePromise = endResult as any;
        if (maybePromise && typeof maybePromise.then === 'function') {
            await maybePromise;
        }
    } finally {
        if (!sinkEnded) {
            try {
                const r: any = fileSink.end();
                if (r && typeof r.then === 'function') {
                    await r;
                }
            } catch {
            }
        }
    }

    const hls = await transcodeOpusToHlsCmaf({
        cfg: params.cfg,
        inputOpusPath: opusPath,
        jobDir: join(params.jobDir, 'hls'),
        segmentSeconds: params.cfg.limits.hlsSegmentSeconds,
        abortSignal: params.abortSignal,
    });

    return {
        files: hls.files,
        cleanup: async () => {
            await hls.cleanup();
        },
    };
}

export async function uploadHlsArtifacts(params: {
    cfg: Config;
    s3: S3Client;
    trackId: number;
    manifestHash8B64Url: string;
    files: { name: string; bytes: Uint8Array; contentType: string }[];
    abortSignal?: AbortSignal;
}): Promise<void> {
    for (const f of params.files) {
        const key = hlsKeyForFile(params.cfg, params.trackId, params.manifestHash8B64Url, f.name);
        await putObjectBytes({
            s3: params.s3,
            bucket: params.cfg.minio.bucketHls,
            key,
            bytes: f.bytes,
            contentType: f.contentType,
            cacheControl: 'private, no-store',
            timeoutMs: params.cfg.minio.s3TimeoutMs,
        });
    }
}
