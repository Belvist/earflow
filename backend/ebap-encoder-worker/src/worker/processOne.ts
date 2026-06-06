import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Pool } from 'pg';
import type { Config } from '../config';
import type { S3Client } from '@aws-sdk/client-s3';
import { headObject, getObjectToFile } from '../storage/s3';
import { transcodeToOpusOgg } from '../ffmpeg/transcode';
import { encodeEbapV3 } from '../encode/encodeEbap';
import { migrateManifestV2IfNeeded } from '../ebap/migrateManifestV2';
import { candidateAudioKeys } from './objectKeys';
import { markSongCompleted } from '../db/jobs';

export async function processOne(params: {
    cfg: Config;
    db: Pool;
    s3: S3Client;
    abortSignal?: AbortSignal;
    songId: number;
    filePath: string;
    forceReencode?: boolean;
    migrateExisting?: boolean;
}): Promise<'completed' | 'skipped_existing'> {
    if (!Number.isInteger(params.songId) || params.songId <= 0) {
        throw new Error('Invalid songId');
    }

    const manifestKey = `${params.cfg.minio.manifestPrefix}${params.songId}.json`;
    const manifestExists = await headObject({
        s3: params.s3,
        bucket: params.cfg.minio.bucketEbap,
        key: manifestKey,
        timeoutMs: params.cfg.limits.s3UploadTimeoutMs,
        abortSignal: params.abortSignal,
    });

    const forceReencode = params.forceReencode === true;
    const migrateExisting = params.migrateExisting === true;

    if (manifestExists && !forceReencode) {
        if (migrateExisting) {
            await migrateManifestV2IfNeeded({
                cfg: params.cfg,
                s3: params.s3,
                trackId: params.songId,
                abortSignal: params.abortSignal,
            });

            await markSongCompleted(params.db, { songId: params.songId });
            return 'completed';
        }

        await markSongCompleted(params.db, { songId: params.songId });
        return 'skipped_existing';
    }

    const jobDir = await mkdtemp(join(tmpdir(), `ebap_${params.songId}_`));
    const inputPath = join(jobDir, 'source');

    const cleanupRoot = async () => {
        await rm(jobDir, { recursive: true, force: true });
    };

    try {
        const keys = candidateAudioKeys(params.filePath);
        let downloadedKey: string | null = null;
        let lastError: unknown = null;

        for (const k of keys) {
            try {
                await getObjectToFile({
                    s3: params.s3,
                    bucket: params.cfg.minio.bucketAudio,
                    key: k,
                    outPath: inputPath,
                    timeoutMs: params.cfg.limits.s3DownloadTimeoutMs,
                    abortSignal: params.abortSignal,
                });
                downloadedKey = k;
                break;
            } catch (e) {
                lastError = e;
            }
        }

        if (!downloadedKey) {
            throw new Error(`source_download_failed: ${(lastError as any)?.message || 'unknown'}`);
        }

        const transcoded = await transcodeToOpusOgg({
            cfg: params.cfg,
            inputPath,
            jobDir: join(jobDir, 'transcode'),
            abortSignal: params.abortSignal,
        });

        try {
            await encodeEbapV3({
                cfg: params.cfg,
                s3: params.s3,
                abortSignal: params.abortSignal,
                trackId: params.songId,
                inputOpusPath: transcoded.opusPath,
            });

            await markSongCompleted(params.db, { songId: params.songId });
            return 'completed';
        } finally {
            await transcoded.cleanup().catch(() => { });
        }
    } finally {
        await cleanupRoot().catch(() => { });
    }
}
