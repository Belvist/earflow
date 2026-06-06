'use strict';

const { spawn } = require('child_process');
const path = require('path');

function buildFfmpegArgs(inputPath, outputPath, profile, loudnormFilter) {
  const args = ['-i', inputPath, '-vn'];

  if (loudnormFilter) {
    args.push('-af', loudnormFilter);
  }

  if (profile.codec === 'flac') {
    args.push('-c:a', 'flac');
    args.push('-compression_level', '8');
    args.push('-f', 'flac');
    args.push('-y', outputPath);
    return args;
  }

  if (profile.codec === 'libopus') {
    args.push('-c:a', 'libopus');
    args.push('-b:a', String(profile.bitrate));
    args.push('-ar', String(profile.sampleRate));
    args.push('-ac', String(profile.channels));
    args.push('-vbr', 'on');
    args.push('-compression_level', '10');
    args.push('-frame_duration', '20');
    args.push('-application', 'audio');
    args.push('-f', 'webm');
    args.push('-y', outputPath);
    return args;
  }

  args.push('-c:a', profile.codec);
  args.push('-b:a', String(profile.bitrate));
  args.push('-ar', String(profile.sampleRate));
  args.push('-ac', String(profile.channels));
  args.push('-movflags', '+faststart');
  args.push('-f', 'mp4');
  args.push('-y', outputPath);
  return args;
}

function runTranscode(inputPath, outputPath, profile, loudnormFilter) {
  return new Promise((resolve, reject) => {
    const args = buildFfmpegArgs(inputPath, outputPath, profile, loudnormFilter);
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 4096) {
        stderr = stderr.slice(-2048);
      }
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exit ${code} [${profile.tag}]: ${stderr.slice(-512)}`));
      }
    });

    proc.on('error', reject);
  });
}

function deriveVariantKey(originalKey, profile) {
  const ext = path.extname(originalKey);
  const base = originalKey.slice(0, originalKey.length - ext.length);

  if (profile.container === 'webm') return `${base}_${profile.tag}.webm`;
  if (profile.container === 'flac') return `${base}_${profile.tag}.flac`;
  return `${base}_${profile.tag}.m4a`;
}

module.exports = { runTranscode, deriveVariantKey, buildFfmpegArgs };
