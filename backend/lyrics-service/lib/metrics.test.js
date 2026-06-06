'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createMetrics, routeName } = require('./metrics');

test('lyrics metrics normalize routes and export counters', () => {
    const metrics = createMetrics();
    metrics.recordHttp({ method: 'GET', route: routeName('/api/lyrics/123'), status: 200, durationSeconds: 0.02 });
    metrics.recordHttp({ method: 'POST', route: routeName('/api/lyrics/123/report'), status: 403, durationSeconds: 0.01 });

    const text = metrics.prometheusText();
    assert.match(text, /lyrics_service_up 1/);
    assert.match(text, /lyrics_service_http_requests_total/);
    assert.match(text, /route="lyrics_by_song"/);
    assert.match(text, /route="lyrics_report"/);
    assert.match(text, /status="403"/);
    assert.match(text, /lyrics_service_http_request_duration_seconds_count/);
});
