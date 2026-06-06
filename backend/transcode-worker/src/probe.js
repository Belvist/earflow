'use strict';

const { spawn } = require('child_process');

const LOSSLESS_CODECS = new Set([
  'flac', 'alac', 'wavpack', 'ape', 'tak', 'tta', 'pcm_s16le', 'pcm_s24le',
  'pcm_s32le', 'pcm_f32le', 'pcm_f64le', 'pcm_s16be', 'pcm_s24be', 'pcm_s32be',
]);

function probeSource(filePath) {
  return new Promise((resolve) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      '-select_streams', 'a:0',
      filePath,
    ];

    const proc = spawn('ffprobe', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';

    proc.stdout.on('data', (c) => { stdout += c.toString(); });

    proc.on('close', () => {
      try {
        const parsed = JSON.parse(stdout);
        const format = parsed?.format || {};
        const stream = Array.isArray(parsed?.streams) ? parsed.streams[0] : null;

        const bitrate = parseInt(format.bit_rate, 10);
        const streamBitrate = stream ? parseInt(stream.bit_rate, 10) : NaN;
        const effectiveBitrate = Number.isFinite(streamBitrate) && streamBitrate > 0
          ? streamBitrate
          : (Number.isFinite(bitrate) && bitrate > 0 ? bitrate : null);

        const sampleRate = stream ? parseInt(stream.sample_rate, 10) : NaN;
        const channels = stream ? parseInt(stream.channels, 10) : NaN;
        const codecName = stream ? String(stream.codec_name || '').toLowerCase().trim() : '';
        const duration = parseFloat(format.duration);

        resolve({
          bitrate: effectiveBitrate,
          sampleRate: Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : null,
          channels: Number.isFinite(channels) && channels > 0 ? channels : null,
          codec: codecName || null,
          isLossless: LOSSLESS_CODECS.has(codecName),
          duration: Number.isFinite(duration) && duration > 0 ? duration : null,
        });
      } catch {
        resolve({
          bitrate: null,
          sampleRate: null,
          channels: null,
          codec: null,
          isLossless: false,
          duration: null,
        });
      }
    });

    proc.on('error', () => {
      resolve({
        bitrate: null,
        sampleRate: null,
        channels: null,
        codec: null,
        isLossless: false,
        duration: null,
      });
    });
  });
}

module.exports = { probeSource, LOSSLESS_CODECS };
