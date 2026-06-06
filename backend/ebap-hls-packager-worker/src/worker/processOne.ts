import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Pool } from 'pg';
import type { Config } from '../config';
import type { S3Client } from '@aws-sdk/client-s3';
import { getObjectToFile, headObject, putObjectBytes } from '../storage/s3';
import { buildHlsArtifacts } from '../hls/build';
import { parseEbapManifest } from '../ebap/manifest';
import { candidateAudioKeys } from './objectKeys';
import { markSongCompleted } from '../db/jobs';

function sortLex(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

function classifyHlsFile(name: string): 'segment_or_init' | 'media_playlist' | 'master' | 'ready' | 'other' {
    const n = String(name || '').replaceAll('\\', '/');
    const lower = n.toLowerCase();
    if (lower === 'ready.json') return 'ready';
    if (lower === 'master.m3u8') return 'master';
    if (lower.endsWith('.m4s') || lower.endsWith('/init.mp4') || lower === 'init.mp4') return 'segment_or_init';
    if (lower.endsWith('.m3u8')) return 'media_playlist';
    return 'other';
}

function hlsBaseKey(cfg: Config, trackId: number, manifestHash8B64Url: string): string {
    return `${cfg.minio.hlsPrefix}${trackId}/${manifestHash8B64Url}/`;
}

function hlsKeyForFile(cfg: Config, trackId: number, manifestHash8B64Url: string, fileName: string): string {
    const safe = fileName.replaceAll('\\', '/');
    if (safe.includes('..')) throw new Error('HLS_BAD_NAME');
    if (safe.startsWith('/')) throw new Error('HLS_BAD_NAME');
    return `${hlsBaseKey(cfg, trackId, manifestHash8B64Url)}${safe}`;
}

async function loadEbapManifestBytes(params: {
    cfg: Config;
    s3: S3Client;
    trackId: number;
    abortSignal?: AbortSignal;
}): Promise<Uint8Array> {
    const key = `${params.cfg.minio.manifestPrefix}${params.trackId}.json`;

    const tmp = await mkdtemp(join(tmpdir(), `ebap_manifest_${params.trackId}_`));
    const path = join(tmp, 'manifest.json');

    try {
        await getObjectToFile({
            s3: params.s3,
            bucket: params.cfg.minio.bucketEbap,
            key,
            outPath: path,
            timeoutMs: params.cfg.limits.s3DownloadTimeoutMs,
            abortSignal: params.abortSignal,
        });

        const buf = await Bun.file(path).arrayBuffer();
        return new Uint8Array(buf);
    } finally {
        await rm(tmp, { recursive: true, force: true });
    }
}

export async function processOne(params: {
    cfg: Config;
    db: Pool;
    s3: S3Client;
    abortSignal?: AbortSignal;
    songId: number;
    filePath: string;
    forceReencode?: boolean;
}): Promise<'completed' | 'skipped_existing'> {
    if (!Number.isInteger(params.songId) || params.songId <= 0) {
        throw new Error('Invalid songId');
    }

    const manifestBytes = await loadEbapManifestBytes({ cfg: params.cfg, s3: params.s3, trackId: params.songId, abortSignal: params.abortSignal });
    const parsed = await parseEbapManifest({
        trackId: params.songId,
        bytes: manifestBytes,
        maxChunks: 200000,
        maxChunkBytes: 1024 * 1024,
    });
    const manifestHash8B64Url = parsed.manifestHash8B64Url;

    const readyKey = hlsKeyForFile(params.cfg, params.songId, manifestHash8B64Url, 'ready.json');
    const readyExists = await headObject({
        s3: params.s3,
        bucket: params.cfg.minio.bucketHls,
        key: readyKey,
        timeoutMs: params.cfg.limits.s3HeadTimeoutMs,
        abortSignal: params.abortSignal,
    });

    const forceReencode = params.forceReencode === true;
    if (readyExists && !forceReencode) {
        await markSongCompleted(params.db, { songId: params.songId });
        return 'skipped_existing';
    }

    const jobDir = await mkdtemp(join(tmpdir(), `hls_${params.songId}_`));
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

        const built = await buildHlsArtifacts({ cfg: params.cfg, inputPath, jobDir: join(jobDir, 'build'), abortSignal: params.abortSignal });
        try {
            const byClass = new Map<ReturnType<typeof classifyHlsFile>, typeof built.files>();
            for (const f of built.files) {
                const cls = classifyHlsFile(f.name);
                const arr = byClass.get(cls);
                if (arr) arr.push(f);
                else byClass.set(cls, [f]);
            }

            const segments = (byClass.get('segment_or_init') ?? []).sort((a, b) => sortLex(a.name, b.name));
            const mediaPlaylists = (byClass.get('media_playlist') ?? []).sort((a, b) => sortLex(a.name, b.name));
            const masters = byClass.get('master') ?? [];
            const readies = byClass.get('ready') ?? [];

            if (masters.length !== 1 || readies.length !== 1) {
                throw new Error('HLS_BUILD_MISSING_COMMIT_MARKERS');
            }

            const master = masters[0]!;
            const ready = readies[0]!;
            const ordered = [...segments, ...mediaPlaylists, master, ready];

            for (const f of ordered) {
                const key = hlsKeyForFile(params.cfg, params.songId, manifestHash8B64Url, f.name);
                await putObjectBytes({
                    s3: params.s3,
                    bucket: params.cfg.minio.bucketHls,
                    key,
                    bytes: f.bytes,
                    contentType: f.contentType,
                    cacheControl: f.cacheControl,
                    timeoutMs: params.cfg.limits.s3UploadTimeoutMs,
                    abortSignal: params.abortSignal,
                });
            }
        } finally {
            await built.cleanup().catch(() => { });
        }

        await markSongCompleted(params.db, { songId: params.songId });
        return 'completed';
    } finally {
        await cleanupRoot().catch(() => { });
    }
}
