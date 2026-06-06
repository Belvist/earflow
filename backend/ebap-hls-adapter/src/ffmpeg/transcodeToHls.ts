import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config } from '../config';

export type HlsOutputFile = { name: string; bytes: Uint8Array; contentType: string };

function contentTypeForName(name: string): string {
    const lower = name.toLowerCase();
    if (lower.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
    if (lower.endsWith('.m4s')) return 'video/iso.segment';
    if (lower.endsWith('.mp4')) return 'video/mp4';
    if (lower.endsWith('.aac')) return 'audio/aac';
    return 'application/octet-stream';
}

function makeMasterPlaylist(params: { mediaPlaylistName: string; bandwidth: number }): string {
    const bw = Math.max(64_000, Math.trunc(params.bandwidth));
    return [
        '#EXTM3U',
        '#EXT-X-VERSION:7',
        `#EXT-X-STREAM-INF:BANDWIDTH=${bw},CODECS=\"mp4a.40.2\"`,
        params.mediaPlaylistName,
        '',
    ].join('\n');
}

export async function transcodeOpusToHlsCmaf(params: {
    cfg: Config;
    inputOpusPath: string;
    jobDir: string;
    segmentSeconds: number;
    abortSignal?: AbortSignal;
}): Promise<{ files: HlsOutputFile[]; cleanup: () => Promise<void> }> {
    await mkdir(params.jobDir, { recursive: true });
    const outDir = join(params.jobDir, 'out');
    await mkdir(outDir, { recursive: true });

    const mediaPlaylistName = 'index.m3u8';
    const mediaPlaylistPath = join(outDir, mediaPlaylistName);
    const initName = 'init.mp4';

    const segSeconds = Math.max(1, Number.isFinite(params.segmentSeconds) ? params.segmentSeconds : 4);

    const args = [
        '-y',
        '-hide_banner',
        '-nostdin',
        '-loglevel',
        'error',
        '-i',
        params.inputOpusPath,
        '-vn',
        '-c:a',
        'aac',
        '-b:a',
        `${Math.max(32, params.cfg.ffmpeg.aacBitrateK)}k`,
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
        join(outDir, 'seg_%05d.m4s'),
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

    const entries = await readdir(outDir, { withFileTypes: true });
    const files: HlsOutputFile[] = [];

    for (const e of entries) {
        if (!e.isFile()) continue;
        const name = e.name;
        const p = join(outDir, name);
        const buf = await readFile(p);
        files.push({ name, bytes: new Uint8Array(buf), contentType: contentTypeForName(name) });
    }

    const master = makeMasterPlaylist({ mediaPlaylistName, bandwidth: params.cfg.ffmpeg.aacBitrateK * 1000 });
    const masterName = 'master.m3u8';
    await writeFile(join(outDir, masterName), master);
    files.push({ name: masterName, bytes: new TextEncoder().encode(master), contentType: contentTypeForName(masterName) });

    return {
        files,
        cleanup: async () => {
            await rm(params.jobDir, { recursive: true, force: true });
        },
    };
}
