'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resamplePeaks, parseStoredPeaks } = require('./waveform');

test('resamplePeaks interpolates to target length', () => {
  const src = [0, 1, 0, 1];
  const out = resamplePeaks(src, 8);
  assert.equal(out.length, 8);
});

test('parseStoredPeaks accepts array or envelope', () => {
  assert.deepEqual(parseStoredPeaks([0.1, 0.9]), [0.1, 0.9]);
  assert.deepEqual(parseStoredPeaks({ peaks: [0.2, 0.5] }), [0.2, 0.5]);
  assert.equal(parseStoredPeaks(null), null);
});
