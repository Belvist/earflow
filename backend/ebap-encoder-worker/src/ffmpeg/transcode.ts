import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config } from '../config';

export type TranscodeResult = {
    opusPath: string;
    cleanup: () => Promise<void>;
};

export async function transcodeToOpusOgg(params: {
    cfg: Config;
    inputPath: string;
    jobDir: string;
    abortSignal?: AbortSignal;
}): Promise<TranscodeResult> {
    await mkdir(params.jobDir, { recursive: true });
    const opusPath = join(params.jobDir, 'track.opus');

    const inputUrl = new URL('file://');
    inputUrl.pathname = params.inputPath;

    const args = [
        '-y',
        '-hide_banner',
        '-nostdin',
        '-loglevel',
        'error',
        '-i',
        inputUrl.toString(),
        '-vn',
        '-c:a',
        'libopus',
        '-ar',
        '48000',
        '-b:a',
        '320k',
        '-vbr',
        'constrained',
        '-compression_level',
        '10',
        '-frame_duration',
        '20',
        '-application',
        'audio',
        '-mapping_family',
        '0',
        '-threads',
        String(params.cfg.ffmpeg.threads),
        opusPath,
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

    const file = Bun.file(opusPath);
    if (!(await file.exists())) {
        throw new Error('ffmpeg_failed: output_missing');
    }

    const stat = await file.stat();
    if (!stat || stat.size <= 0) {
        throw new Error('ffmpeg_failed: output_empty');
    }

    return {
        opusPath,
        cleanup: async () => {
            await rm(params.jobDir, { recursive: true, force: true });
        },
    };
}
