'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { startHealthServer, closeHealthServer } = require('./healthServer');
const { createMetrics } = require('./runtimeMetrics');

test('health server serves health and prometheus metrics', async () => {
  const metrics = createMetrics({ concurrency: 1 });
  metrics.setReady(true);
  metrics.markJobClaimed();

  const server = startHealthServer({ port: 0, host: '127.0.0.1', metrics });
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  try {
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    const healthBody = await health.json();
    assert.equal(healthBody.ok, true);
    assert.equal(healthBody.status, 'healthy');

    const metricsResp = await fetch(`http://127.0.0.1:${port}/metrics`);
    assert.equal(metricsResp.status, 200);
    const metricsBody = await metricsResp.text();
    assert.match(metricsBody, /transcode_worker_up 1/);
    assert.match(metricsBody, /transcode_worker_jobs_claimed_total 1/);
  } finally {
    await closeHealthServer(server);
  }
});
