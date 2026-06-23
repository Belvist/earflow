'use strict';

const { spawn } = require('child_process');

const DEFAULT_STORE_BARS = 256;
const SAMPLE_RATE = 8000;

/**
 * @param {Float32Array|number[]} samples
 * @param {number} barCount
 * @returns {number[]}
 */
function peaksFromFloat32(samples, barCount) {
  const count = Math.max(1, Math.min(512, Number(barCount) || DEFAULT_STORE_BARS));
  const len = samples.length;
  if (!len) {
    return Array.from({ length: count }, () => 0.2);
  }

  const block = Math.max(1, Math.floor(len / count));
  const peaks = [];

  for (let i = 0; i < count; i += 1) {
    const start = i * block;
    const end = i === count - 1 ? len : Math.min(len, start + block);
    let max = 0;
    for (let j = start; j < end; j += 4) {
      const v = Math.abs(samples[j]);
      if (v > max) max = v;
    }
    peaks.push(max);
  }

  const top = Math.max(...peaks, 0.0001);
  return peaks.map((p) => Math.round((0.08 + 0.92 * (p / top)) * 1000) / 1000);
}

/**
 * Extract normalized peaks 0..1 from a local audio file via ffmpeg (mono f32le pipe).
 * @param {string} inputPath
 * @param {number} [barCount]
 */
function extractWaveformPeaks(inputPath, barCount = DEFAULT_STORE_BARS) {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-i', inputPath,
      '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE),
      '-f', 'f32le', 'pipe:1',
    ];

    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      chunks.push(chunk);
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 2048) stderr = stderr.slice(-1024);
    });

    proc.on('error', reject);

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg waveform exit ${code}: ${stderr.slice(-256)}`));
        return;
      }
      const buf = Buffer.concat(chunks);
      if (buf.length < 4) {
        resolve(peaksFromFloat32([], barCount));
        return;
      }
      const aligned = buf.byteOffset % 4 === 0
        ? buf
        : Buffer.from(buf);
      const samples = new Float32Array(
        aligned.buffer,
        aligned.byteOffset,
        Math.floor(aligned.byteLength / 4),
      );
      resolve(peaksFromFloat32(samples, barCount));
    });
  });
}

module.exports = {
  DEFAULT_STORE_BARS,
  peaksFromFloat32,
  extractWaveformPeaks,
};
