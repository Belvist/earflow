'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createMetrics, routeName } = require('./metrics');

test('metadata parser metrics export http and job counters', () => {
    const metrics = createMetrics({ concurrency: 2 });
    metrics.setProcessing(1);
    metrics.markJobStarted();
    metrics.markJobCompleted({ coverUploaded: true });
    metrics.markJobFailed('download_failed');
    metrics.recordHttp({ method: 'POST', route: routeName('/api/metadata/parse'), status: 202, durationSeconds: 0.01 });

    const text = metrics.prometheusText();
    assert.match(text, /metadata_parser_up 1/);
    assert.match(text, /metadata_parser_processing_jobs 1/);
    assert.match(text, /metadata_parser_jobs_started_total 1/);
    assert.match(text, /metadata_parser_jobs_completed_total 1/);
    assert.match(text, /metadata_parser_covers_uploaded_total 1/);
    assert.match(text, /outcome="download_failed"/);
    assert.match(text, /route="metadata_parse"/);
    assert.match(text, /status="202"/);
});
