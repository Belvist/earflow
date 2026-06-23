'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  parseRetryCount,
  formatFailedError,
  nextRetryCount,
  stripRetryPrefix,
} = require('./jobRetry');

test('parseRetryCount reads prefix', () => {
  assert.equal(parseRetryCount('[retries:2] ffmpeg exit 1'), 2);
  assert.equal(parseRetryCount('plain error'), 0);
});

test('nextRetryCount increments', () => {
  assert.equal(nextRetryCount('[retries:1] oops'), 2);
  assert.equal(nextRetryCount(null), 1);
});

test('formatFailedError caps length and strips nested prefix', () => {
  const out = formatFailedError(3, '[retries:1] root cause');
  assert.match(out, /^\[retries:3\] root cause$/);
});

test('stripRetryPrefix', () => {
  assert.equal(stripRetryPrefix('[retries:4] msg'), 'msg');
});
