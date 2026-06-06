'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createMetrics, routeName } = require('./metrics');

test('import-service metrics export http counters', () => {
    const metrics = createMetrics();
    metrics.recordHttp({ method: 'POST', route: routeName('/api/import/search'), status: 200, durationSeconds: 0.025 });
    metrics.recordHttp({ method: 'POST', route: routeName('/api/import/search'), status: 401, durationSeconds: 0.001 });

    const text = metrics.prometheusText();
    assert.match(text, /import_service_up 1/);
    assert.match(text, /import_service_http_requests_total/);
    assert.match(text, /route="import_search"/);
    assert.match(text, /status="200"/);
    assert.match(text, /status="401"/);
    assert.match(text, /import_service_http_request_duration_seconds_count/);
});
