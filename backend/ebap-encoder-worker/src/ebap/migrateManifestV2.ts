import type { S3Client } from '@aws-sdk/client-s3';
import type { Config } from '../config';
import { base64ToBytes, bytesToBase64 } from '../lib/base64';
import { timingSafeEqual } from '../lib/bytes';
import { getObjectBytes, putObjectBytes } from '../storage/s3';
import { parseManifestV2OrThrow } from './manifestV2';
import { tryUnwrapTrackKeyFromStorage, wrapTrackKeyForStorage } from '../crypto/crypto';

const MAX_MANIFEST_BYTES = 512 * 1024;

function safeJsonParse(bytes: Uint8Array): unknown {
    const s = new TextDecoder().decode(bytes);
    return JSON.parse(s);
}

function isObjectRecord(v: unknown): v is Record<string, unknown> {
    return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

export type ManifestMigrationResult =
    | { migrated: false; reason: 'not_found' | 'not_v2' | 'already_primary' }
    | { migrated: true; fromKeyIndex: number; toKeyIndex: 0 };

export async function migrateManifestV2IfNeeded(params: {
    cfg: Config;
    s3: S3Client;
    trackId: number;
    abortSignal?: AbortSignal;
}): Promise<ManifestMigrationResult> {
    if (!Number.isInteger(params.trackId) || params.trackId <= 0) {
        throw new Error('Invalid trackId');
    }

    const manifestKey = `${params.cfg.minio.manifestPrefix}${params.trackId}.json`;

    let bytes: Uint8Array;
    try {
        bytes = await getObjectBytes({
            s3: params.s3,
            bucket: params.cfg.minio.bucketEbap,
            key: manifestKey,
            timeoutMs: params.cfg.limits.s3UploadTimeoutMs,
            maxBytes: MAX_MANIFEST_BYTES,
            abortSignal: params.abortSignal,
        });
    } catch (e: any) {
        const status = e?.cause?.$metadata?.httpStatusCode ?? e?.$metadata?.httpStatusCode;
        if (status === 404 || e?.cause?.name === 'NoSuchKey') {
            return { migrated: false, reason: 'not_found' };
        }
        throw e;
    }

    const parsed = safeJsonParse(bytes);
    if (!isObjectRecord(parsed)) {
        throw new Error('Invalid manifest JSON');
    }

    const version = parsed.version;
    if (version !== 2) {
        return { migrated: false, reason: 'not_v2' };
    }

    const manifest = parseManifestV2OrThrow(parsed);
    if (manifest.trackId !== params.trackId) {
        throw new Error('Manifest trackId mismatch');
    }

    const trackSalt = base64ToBytes(manifest.trackSaltB64);
    const iv = base64ToBytes(manifest.trackKeyMasterIvB64);
    const wrapped = base64ToBytes(manifest.wrappedTrackKeyMasterB64);

    if (trackSalt.byteLength !== 32) {
        throw new Error('Invalid trackSalt');
    }
    if (iv.byteLength !== 12) {
        throw new Error('Invalid trackKeyMasterIv');
    }
    if (wrapped.byteLength < 16) {
        throw new Error('Invalid wrappedTrackKeyMaster');
    }

    const unwrapRes = await tryUnwrapTrackKeyFromStorage({
        trackKeyMasterSecrets: params.cfg.trackKeyMasterSecrets,
        trackId: params.trackId,
        trackSalt,
        trackKeyMasterIv: iv,
        wrappedTrackKeyMaster: wrapped,
    });

    if (!unwrapRes) {
        throw new Error('manifest_track_key_unwrap_failed');
    }

    if (unwrapRes.keyIndex === 0) {
        return { migrated: false, reason: 'already_primary' };
    }

    const unwrapSecret = params.cfg.trackKeyMasterSecrets[unwrapRes.keyIndex] ?? null;
    if (unwrapSecret && timingSafeEqual(unwrapSecret, params.cfg.trackKeyMasterSecret)) {
        return { migrated: false, reason: 'already_primary' };
    }

    const rewrapped = await wrapTrackKeyForStorage({
        trackKeyMasterSecret: params.cfg.trackKeyMasterSecret,
        trackId: params.trackId,
        trackSalt,
        trackKey: unwrapRes.trackKey,
    });

    const next = {
        ...manifest,
        trackKeyMasterIvB64: bytesToBase64(rewrapped.trackKeyMasterIv),
        wrappedTrackKeyMasterB64: bytesToBase64(rewrapped.wrappedTrackKeyMaster),
    };

    const outBytes = new TextEncoder().encode(JSON.stringify(next));
    await putObjectBytes({
        s3: params.s3,
        bucket: params.cfg.minio.bucketEbap,
        key: manifestKey,
        bytes: outBytes,
        contentType: 'application/json',
        timeoutMs: params.cfg.limits.s3UploadTimeoutMs,
        abortSignal: params.abortSignal,
    });

    return { migrated: true, fromKeyIndex: unwrapRes.keyIndex, toKeyIndex: 0 };
}
