import { z } from 'zod';
import { toArrayBuffer } from '../lib/bytes';
import { base64ToBytes, bytesToBase64Url } from '../lib/base64';

const chunkSchemaV2 = z.object({
    index: z.number().int().nonnegative(),
    key: z.string().min(1),
    size: z.number().int().nonnegative(),
    sha256B64: z.string().min(1).optional(),
});

const chunkSchemaV3 = z.object({
    index: z.number().int().nonnegative(),
    key: z.string().min(1),
    size: z.number().int().nonnegative(),
    sha256B64: z.string().min(1).optional(),
    samples: z.number().int().nonnegative(),
});

const manifestV2Schema = z.object({
    version: z.literal(2),
    trackId: z.number().int().positive(),
    codec: z.literal('opus'),
    mime: z.literal('application/ebap-opus-packets'),
    trackSaltB64: z.string().min(1),
    trackKeyMasterIvB64: z.string().min(1),
    wrappedTrackKeyMasterB64: z.string().min(1),
    chunks: z.array(chunkSchemaV2).min(1),
});

const manifestV3Schema = z.object({
    version: z.literal(3),
    trackId: z.number().int().positive(),
    codec: z.literal('opus'),
    mime: z.literal('application/ebap-opus-packets'),
    sampleRate: z.number().int().positive(),
    totalSamples: z.number().int().nonnegative(),
    trackSaltB64: z.string().min(1),
    trackKeyMasterIvB64: z.string().min(1),
    wrappedTrackKeyMasterB64: z.string().min(1),
    chunks: z.array(chunkSchemaV3).min(1),
});

const manifestSchema = z.discriminatedUnion('version', [manifestV2Schema, manifestV3Schema]);

export type EbapManifestV2 = z.infer<typeof manifestV2Schema>;
export type EbapManifestV3 = z.infer<typeof manifestV3Schema>;
export type EbapManifest = z.infer<typeof manifestSchema>;

function validateChunkKey(trackId: number, key: string): void {
    const expectedPrefix = `tracks/${trackId}/`;
    if (!key.startsWith(expectedPrefix)) throw new Error('EBAP_BAD_CHUNK_KEY');
    if (key.includes('..')) throw new Error('EBAP_BAD_CHUNK_KEY');
    if (key.startsWith('/') || key.startsWith('\\')) throw new Error('EBAP_BAD_CHUNK_KEY');
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
    const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(bytes));
    return new Uint8Array(digest);
}

export async function computeStableManifestHash8(manifest: EbapManifest): Promise<Uint8Array> {
    const stable = {
        v: manifest.version,
        tid: manifest.trackId,
        c: manifest.codec,
        m: manifest.mime,
        s: manifest.trackSaltB64,
        sr: (manifest as any).sampleRate,
        ts: (manifest as any).totalSamples,
        chunks: (manifest as any).chunks.map((ch: any) => ({
            i: ch.index,
            k: ch.key,
            s: ch.size,
            h: ch.sha256B64,
            p: ch.samples,
        })),
    };

    const bytes = new TextEncoder().encode(JSON.stringify(stable));
    return (await sha256(bytes)).subarray(0, 8);
}

export async function parseEbapManifest(params: {
    trackId: number;
    bytes: Uint8Array;
    maxChunks: number;
    maxChunkBytes: number;
}): Promise<{ manifest: EbapManifest; manifestHash8: Uint8Array; manifestHash8B64Url: string }> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(new TextDecoder().decode(params.bytes));
    } catch {
        throw new Error('EBAP_BAD_MANIFEST_JSON');
    }

    const manifest = manifestSchema.parse(parsed);
    if (manifest.trackId !== params.trackId) throw new Error('EBAP_TRACK_MISMATCH');

    const trackSalt = base64ToBytes(manifest.trackSaltB64);
    if (trackSalt.byteLength !== 32) throw new Error('EBAP_BAD_TRACK_SALT');

    if (manifest.chunks.length > params.maxChunks) throw new Error('EBAP_TOO_MANY_CHUNKS');

    for (const ch of manifest.chunks) {
        if (ch.size > params.maxChunkBytes) throw new Error('EBAP_CHUNK_TOO_LARGE');
        validateChunkKey(params.trackId, ch.key);
        if (ch.sha256B64) {
            const hash = base64ToBytes(ch.sha256B64);
            if (hash.byteLength !== 32) throw new Error('EBAP_BAD_CHUNK_SHA');
        }
    }

    const iv = base64ToBytes(manifest.trackKeyMasterIvB64);
    if (iv.byteLength !== 12) throw new Error('EBAP_BAD_TRACKKEY_IV');
    const wrapped = base64ToBytes(manifest.wrappedTrackKeyMasterB64);
    if (wrapped.byteLength < 48) throw new Error('EBAP_BAD_WRAPPED_TRACKKEY');

    if (manifest.version === 3) {
        const sr = Number((manifest as any).sampleRate);
        const ts = Number((manifest as any).totalSamples);
        if (!Number.isFinite(sr) || sr <= 0) throw new Error('EBAP_BAD_SAMPLE_RATE');
        if (!Number.isFinite(ts) || ts < 0) throw new Error('EBAP_BAD_TOTAL_SAMPLES');

        let sum = 0;
        for (const ch of manifest.chunks as any[]) {
            const s = Number(ch?.samples);
            if (!Number.isFinite(s) || s < 0) throw new Error('EBAP_BAD_CHUNK_SAMPLES');
            sum += s;
        }
        if (Math.abs(sum - ts) > 0.5) throw new Error('EBAP_TOTAL_SAMPLES_MISMATCH');
    }

    const manifestHash8 = await computeStableManifestHash8(manifest);
    return { manifest, manifestHash8, manifestHash8B64Url: bytesToBase64Url(manifestHash8) };
}
