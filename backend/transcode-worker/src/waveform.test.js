'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { peaksFromFloat32 } = require('./waveform');

test('peaksFromFloat32 normalizes and returns requested bar count', () => {
  const samples = new Float32Array(8000);
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = i < 4000 ? 0.1 : 0.9;
  }
  const peaks = peaksFromFloat32(samples, 64);
  assert.equal(peaks.length, 64);
  const left = peaks.slice(0, 32).reduce((s, p) => s + p, 0) / 32;
  const right = peaks.slice(32).reduce((s, p) => s + p, 0) / 32;
  assert.ok(right > left);
  peaks.forEach((p) => {
    assert.ok(p >= 0 && p <= 1);
  });
});
