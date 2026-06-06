import { bytesToBase64Url } from '../lib/base64';
import { computeStableManifestHash8, parseEbapManifest } from '../ebap/manifest';

export async function computeManifestHash8B64Url(params: {
    trackId: number;
    manifestBytes: Uint8Array;
    maxChunks: number;
    maxChunkBytes: number;
}): Promise<string> {
    const parsed = await parseEbapManifest({
        trackId: params.trackId,
        bytes: params.manifestBytes,
        maxChunks: params.maxChunks,
        maxChunkBytes: params.maxChunkBytes,
    });
    const hash8 = await computeStableManifestHash8(parsed.manifest);
    return bytesToBase64Url(hash8);
}
