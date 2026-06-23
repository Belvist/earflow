'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createJobPool } = require('./jobPool');

test('job pool enforces separate transcode and waveform concurrency', async () => {
  const pool = createJobPool({ transcodeConcurrency: 1, waveformConcurrency: 1 });
  assert.equal(pool.canStart('transcode'), true);
  assert.equal(pool.canStart('waveform'), true);

  let releaseTranscode;
  const transcodeGate = new Promise((r) => { releaseTranscode = r; });
  pool.schedule('transcode', false, () => transcodeGate);
  assert.equal(pool.canStart('transcode'), false);
  assert.equal(pool.canStart('waveform'), true);

  let releaseWave;
  const waveGate = new Promise((r) => { releaseWave = r; });
  pool.schedule('waveform', false, () => waveGate);
  assert.equal(pool.canStart('waveform'), false);

  releaseTranscode();
  releaseWave();
  await pool.drainInFlight(2000);
  assert.equal(pool.activeCounts().inFlight, 0);
});
