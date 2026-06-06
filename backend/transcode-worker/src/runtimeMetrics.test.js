'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createMetrics } = require('./runtimeMetrics');

test('runtime metrics expose worker counters and health snapshot', () => {
  const metrics = createMetrics({ concurrency: 2 });
  metrics.setReady(true);
  metrics.setActiveJobs(2, 1, 1);
  metrics.markPoll();
  metrics.markJobClaimed();
  metrics.markJobStarted();
  metrics.markJobCompleted({ variants: 3, bytes: 4096 });
  metrics.markRequeued(4);

  const snapshot = metrics.snapshot();
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.activeJobs, 2);
  assert.equal(snapshot.activeTranscodeJobs, 1);
  assert.equal(snapshot.activeWaveformJobs, 1);
  assert.equal(snapshot.concurrency, 2);
  assert.equal(snapshot.requeuedFailedTotal, 4);
  assert.equal(snapshot.claimedTotal, 1);
  assert.equal(snapshot.completedTotal, 1);
  assert.equal(snapshot.variantsUploadedTotal, 3);
  assert.equal(snapshot.uploadedBytesTotal, 4096);

  const text = metrics.prometheusText();
  assert.match(text, /transcode_worker_up 1/);
  assert.match(text, /transcode_worker_active_jobs 2/);
  assert.match(text, /transcode_worker_active_transcode_jobs 1/);
  assert.match(text, /transcode_worker_jobs_requeued_failed_total 4/);
  assert.match(text, /transcode_worker_jobs_claimed_total 1/);
  assert.match(text, /transcode_worker_jobs_completed_total 1/);
  assert.match(text, /transcode_worker_variants_uploaded_total 3/);
  assert.match(text, /transcode_worker_uploaded_bytes_total 4096/);
});
