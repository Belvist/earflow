'use strict';

const { spawn } = require('child_process');

const TARGET_LUFS = -14.0;
const TARGET_TP = -1.0;
const TARGET_LRA = 11.0;

function analyzeLoudness(filePath) {
  return new Promise((resolve) => {
    const args = [
      '-i', filePath,
      '-vn',
      '-af', `loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TP}:LRA=${TARGET_LRA}:print_format=json`,
      '-f', 'null',
      '-',
    ];

    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';

    proc.stderr.on('data', (c) => {
      stderr += c.toString();
      if (stderr.length > 65536) {
        stderr = stderr.slice(-32768);
      }
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }

      const jsonMatch = stderr.match(/\{[^{}]*"input_i"\s*:\s*"[^"]*"[^{}]*\}/s);
      if (!jsonMatch) {
        resolve(null);
        return;
      }

      try {
        const data = JSON.parse(jsonMatch[0]);
        const inputI = parseFloat(data.input_i);
        const inputTp = parseFloat(data.input_tp);
        const inputLra = parseFloat(data.input_lra);
        const inputThresh = parseFloat(data.input_thresh);
        const targetOffset = parseFloat(data.target_offset);

        if (!Number.isFinite(inputI)) {
          resolve(null);
          return;
        }

        resolve({
          inputI: Number.isFinite(inputI) ? Math.round(inputI * 100) / 100 : null,
          inputTp: Number.isFinite(inputTp) ? Math.round(inputTp * 100) / 100 : null,
          inputLra: Number.isFinite(inputLra) ? Math.round(inputLra * 100) / 100 : null,
          inputThresh: Number.isFinite(inputThresh) ? Math.round(inputThresh * 100) / 100 : null,
          targetOffset: Number.isFinite(targetOffset) ? Math.round(targetOffset * 100) / 100 : null,
        });
      } catch {
        resolve(null);
      }
    });

    proc.on('error', () => resolve(null));
  });
}

function buildLoudnormFilter(analysis) {
  if (!analysis || !Number.isFinite(analysis.inputI)) return null;

  const parts = [
    `loudnorm=I=${TARGET_LUFS}`,
    `TP=${TARGET_TP}`,
    `LRA=${TARGET_LRA}`,
    `measured_I=${analysis.inputI}`,
    `measured_TP=${analysis.inputTp}`,
    `measured_LRA=${analysis.inputLra}`,
    `measured_thresh=${analysis.inputThresh}`,
    `offset=${analysis.targetOffset}`,
    'linear=true',
    'print_format=summary',
  ];

  return parts.join(':');
}

module.exports = { analyzeLoudness, buildLoudnormFilter, TARGET_LUFS, TARGET_TP };
