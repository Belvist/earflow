'use strict';

function safeLabel(value, fallback) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return fallback;
    return raw.replace(/[^a-z0-9_:-]/g, '_').slice(0, 80) || fallback;
}

function escapeLabel(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function labelSet(labels) {
    return Object.entries(labels).map(([k, v]) => `${k}="${escapeLabel(v)}"`).join(',');
}

function routeName(pathname) {
    const path = String(pathname || '').trim();
    if (path === '/health') return 'health';
    if (path === '/metrics') return 'metrics';
    if (path === '/api/metadata/parse') return 'metadata_parse';
    if (path === '/api/metadata/batch') return 'metadata_batch';
    return 'other';
}

function createMetrics(options = {}) {
    const startedAt = Date.now();
    const http = new Map();
    const jobs = new Map();
    const state = {
        concurrency: Math.max(1, Number(options.concurrency || 1)),
        processing: 0,
        jobsStarted: 0,
        jobsCompleted: 0,
        jobsFailed: 0,
        coversUploaded: 0,
    };

    function httpKey(method, route) {
        return `${safeLabel(method, 'unknown').toUpperCase()}\n${safeLabel(route, 'unknown')}`;
    }

    return {
        routeName,
        setProcessing(value) {
            const n = Number(value);
            state.processing = Number.isFinite(n) && n > 0 ? n : 0;
        },
        markJobStarted() {
            state.jobsStarted += 1;
        },
        markJobCompleted(result = {}) {
            state.jobsCompleted += 1;
            if (result.coverUploaded) state.coversUploaded += 1;
        },
        markJobFailed(outcome) {
            state.jobsFailed += 1;
            const key = safeLabel(outcome, 'failed');
            jobs.set(key, (jobs.get(key) || 0) + 1);
        },
        recordHttp({ method, route, status, durationSeconds }) {
            const key = httpKey(method, route);
            let item = http.get(key);
            if (!item) {
                item = { count: 0, durationSecondsSum: 0, statuses: new Map() };
                http.set(key, item);
            }
            const code = Number.isFinite(Number(status)) ? String(Math.trunc(Number(status))) : '500';
            const duration = Number.isFinite(Number(durationSeconds)) && Number(durationSeconds) >= 0 ? Number(durationSeconds) : 0;
            item.count += 1;
            item.durationSecondsSum += duration;
            item.statuses.set(code, (item.statuses.get(code) || 0) + 1);
        },
        prometheusText() {
            const lines = [
                '# HELP metadata_parser_up Service readiness state.',
                '# TYPE metadata_parser_up gauge',
                'metadata_parser_up 1',
                '# HELP metadata_parser_uptime_seconds Service uptime in seconds.',
                '# TYPE metadata_parser_uptime_seconds gauge',
                `metadata_parser_uptime_seconds ${Math.floor((Date.now() - startedAt) / 1000)}`,
                '# HELP metadata_parser_processing_jobs Active metadata parse jobs.',
                '# TYPE metadata_parser_processing_jobs gauge',
                `metadata_parser_processing_jobs ${state.processing}`,
                '# HELP metadata_parser_concurrency Configured metadata parser concurrency.',
                '# TYPE metadata_parser_concurrency gauge',
                `metadata_parser_concurrency ${state.concurrency}`,
                '# HELP metadata_parser_jobs_started_total Metadata parse jobs started.',
                '# TYPE metadata_parser_jobs_started_total counter',
                `metadata_parser_jobs_started_total ${state.jobsStarted}`,
                '# HELP metadata_parser_jobs_completed_total Metadata parse jobs completed.',
                '# TYPE metadata_parser_jobs_completed_total counter',
                `metadata_parser_jobs_completed_total ${state.jobsCompleted}`,
                '# HELP metadata_parser_jobs_failed_total Metadata parse jobs failed by outcome.',
                '# TYPE metadata_parser_jobs_failed_total counter',
            ];

            if (jobs.size === 0) {
                lines.push(`metadata_parser_jobs_failed_total{${labelSet({ outcome: 'none' })}} 0`);
            } else {
                for (const [outcome, count] of jobs.entries()) {
                    lines.push(`metadata_parser_jobs_failed_total{${labelSet({ outcome })}} ${count}`);
                }
            }

            lines.push(
                '# HELP metadata_parser_covers_uploaded_total Auto-extracted covers uploaded.',
                '# TYPE metadata_parser_covers_uploaded_total counter',
                `metadata_parser_covers_uploaded_total ${state.coversUploaded}`,
                '# HELP metadata_parser_http_requests_total HTTP requests by method, route, and status.',
                '# TYPE metadata_parser_http_requests_total counter',
            );

            for (const [key, item] of http.entries()) {
                const [method = 'unknown', route = 'unknown'] = key.split('\n');
                for (const [status, count] of item.statuses.entries()) {
                    lines.push(`metadata_parser_http_requests_total{${labelSet({ method, route, status })}} ${count}`);
                }
            }

            lines.push(
                '# HELP metadata_parser_http_request_duration_seconds HTTP request duration summary.',
                '# TYPE metadata_parser_http_request_duration_seconds summary',
            );
            for (const [key, item] of http.entries()) {
                const [method = 'unknown', route = 'unknown'] = key.split('\n');
                const ls = labelSet({ method, route });
                lines.push(`metadata_parser_http_request_duration_seconds_sum{${ls}} ${item.durationSecondsSum}`);
                lines.push(`metadata_parser_http_request_duration_seconds_count{${ls}} ${item.count}`);
            }
            lines.push('');
            return lines.join('\n');
        },
    };
}

module.exports = { createMetrics, routeName };
