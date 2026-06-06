import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config } from '../config';

export type HlsOutputFile = { name: string; bytes: Uint8Array; contentType: string; cacheControl?: string };

function contentTypeForName(name: string): string {
    const lower = name.toLowerCase();
    if (lower.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
    if (lower.endsWith('.m4s')) return 'video/iso.segment';
    if (lower.endsWith('.mp4')) return 'video/mp4';
    if (lower.endsWith('.aac')) return 'audio/aac';
    return 'application/octet-stream';
}

function cacheControlForName(name: string): string {
    const lower = name.toLowerCase();
    if (lower.endsWith('.m3u8')) return 'private, max-age=60, must-revalidate';
    if (lower === 'ready.json') return 'private, no-store';
    if (lower.endsWith('.m4s')) return 'public, max-age=31536000, immutable';
    if (lower.endsWith('init.mp4')) return 'public, max-age=31536000, immutable';
    return 'private, no-store';
}

function makeMasterPlaylist(params: { renditions: { path: string; bandwidth: number }[] }): string {
    const lines: string[] = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-INDEPENDENT-SEGMENTS'];
    for (const r of params.renditions) {
        const bw = Math.max(64_000, Math.trunc(r.bandwidth));
        lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bw},CODECS="mp4a.40.2"`, r.path);
    }
    lines.push('');
    return lines.join('\n');
}

async function transcodeAudioToHlsVariant(params: {
    cfg: Config;
    inputPath: string;
    outDir: string;
    bitrateK: number;
    segmentSeconds: number;
    abortSignal?: AbortSignal;
}): Promise<void> {
    await mkdir(params.outDir, { recursive: true });

    const mediaPlaylistName = 'index.m3u8';
    const mediaPlaylistPath = join(params.outDir, mediaPlaylistName);
    const initName = 'init.mp4';

    const segSeconds = Math.max(1, Number.isFinite(params.segmentSeconds) ? params.segmentSeconds : 2);

    const args = [
        '-y',
        '-hide_banner',
        '-nostdin',
        '-loglevel',
        'error',
        '-i',
        params.inputPath,
        '-vn',
        '-c:a',
        'aac',
        '-b:a',
        `${Math.max(32, params.bitrateK)}k`,
        '-ac',
        '2',
        '-threads',
        String(params.cfg.ffmpeg.threads),
        '-f',
        'hls',
        '-hls_time',
        String(segSeconds),
        '-hls_playlist_type',
        'vod',
        '-hls_flags',
        'independent_segments',
        '-hls_segment_type',
        'fmp4',
        '-hls_fmp4_init_filename',
        initName,
        '-hls_segment_filename',
        join(params.outDir, 'seg_%05d.m4s'),
        mediaPlaylistPath,
    ];

    const proc = Bun.spawn({
        cmd: [params.cfg.ffmpeg.bin, ...args],
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'pipe',
        signal: params.abortSignal,
    });

    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    if (code !== 0) {
        throw new Error(`ffmpeg_failed: exit=${code} ${stderr.trim().slice(0, 2000)}`);
    }
}

async function collectFilesRecursive(rootDir: string, relBase = ''): Promise<HlsOutputFile[]> {
    const entries = await readdir(rootDir, { withFileTypes: true });
    const out: HlsOutputFile[] = [];

    for (const e of entries) {
        const name = e.name;
        const abs = join(rootDir, name);
        const rel = relBase ? `${relBase}/${name}` : name;

        if (e.isDirectory()) {
            out.push(...(await collectFilesRecursive(abs, rel)));
            continue;
        }
        if (!e.isFile()) continue;

        const buf = await readFile(abs);
        out.push({ name: rel, bytes: new Uint8Array(buf), contentType: contentTypeForName(name), cacheControl: cacheControlForName(rel) });
    }

    return out;
}

export async function buildHlsArtifacts(params: {
    cfg: Config;
    inputPath: string;
    jobDir: string;
    abortSignal?: AbortSignal;
}): Promise<{ files: HlsOutputFile[]; cleanup: () => Promise<void> }> {
    await mkdir(params.jobDir, { recursive: true, mode: 0o700 });
    const outDir = join(params.jobDir, 'out');
    await mkdir(outDir, { recursive: true });

    const [b1, b2] = params.cfg.ffmpeg.aacBitratesK;

    const v256 = `aac_${b1}`;
    const v128 = `aac_${b2}`;

    await transcodeAudioToHlsVariant({
        cfg: params.cfg,
        inputPath: params.inputPath,
        outDir: join(outDir, v256),
        bitrateK: b1,
        segmentSeconds: params.cfg.limits.hlsSegmentSeconds,
        abortSignal: params.abortSignal,
    });

    await transcodeAudioToHlsVariant({
        cfg: params.cfg,
        inputPath: params.inputPath,
        outDir: join(outDir, v128),
        bitrateK: b2,
        segmentSeconds: params.cfg.limits.hlsSegmentSeconds,
        abortSignal: params.abortSignal,
    });

    const master = makeMasterPlaylist({
        renditions: [
            { path: `${v256}/index.m3u8`, bandwidth: b1 * 1000 },
            { path: `${v128}/index.m3u8`, bandwidth: b2 * 1000 },
        ],
    });

    const masterName = 'master.m3u8';
    await writeFile(join(outDir, masterName), master);

    const readyName = 'ready.json';
    const readyBody = new TextEncoder().encode(JSON.stringify({ status: 'ready' }));
    await writeFile(join(outDir, readyName), readyBody);

    const files = await collectFilesRecursive(outDir);

    return {
        files,
        cleanup: async () => {
            await rm(params.jobDir, { recursive: true, force: true });
        },
    };
}
