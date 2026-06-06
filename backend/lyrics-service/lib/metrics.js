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
    if (path === '/api/lyrics/search') return 'lyrics_search';
    if (path === '/api/lyrics/import') return 'lyrics_import';
    if (path === '/api/lyrics/plain') return 'lyrics_plain';
    if (path === '/api/lyrics') return 'lyrics_collection';
    if (/^\/api\/lyrics\/[1-9][0-9]*\/report$/.test(path)) return 'lyrics_report';
    if (/^\/api\/lyrics\/[1-9][0-9]*$/.test(path)) return 'lyrics_by_song';
    return 'other';
}

function createMetrics() {
    const startedAt = Date.now();
    const http = new Map();

    return {
        routeName,
        recordHttp({ method, route, status, durationSeconds }) {
            const methodLabel = safeLabel(method, 'unknown').toUpperCase();
            const routeLabel = safeLabel(route, 'unknown');
            const key = `${methodLabel}\n${routeLabel}`;
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
                '# HELP lyrics_service_up Service readiness state.',
                '# TYPE lyrics_service_up gauge',
                'lyrics_service_up 1',
                '# HELP lyrics_service_uptime_seconds Service uptime in seconds.',
                '# TYPE lyrics_service_uptime_seconds gauge',
                `lyrics_service_uptime_seconds ${Math.floor((Date.now() - startedAt) / 1000)}`,
                '# HELP lyrics_service_http_requests_total HTTP requests by method, route, and status.',
                '# TYPE lyrics_service_http_requests_total counter',
            ];

            for (const [key, item] of http.entries()) {
                const [method = 'unknown', route = 'unknown'] = key.split('\n');
                for (const [status, count] of item.statuses.entries()) {
                    lines.push(`lyrics_service_http_requests_total{${labelSet({ method, route, status })}} ${count}`);
                }
            }

            lines.push(
                '# HELP lyrics_service_http_request_duration_seconds HTTP request duration summary.',
                '# TYPE lyrics_service_http_request_duration_seconds summary',
            );
            for (const [key, item] of http.entries()) {
                const [method = 'unknown', route = 'unknown'] = key.split('\n');
                const labels = labelSet({ method, route });
                lines.push(`lyrics_service_http_request_duration_seconds_sum{${labels}} ${item.durationSecondsSum}`);
                lines.push(`lyrics_service_http_request_duration_seconds_count{${labels}} ${item.count}`);
            }
            lines.push('');
            return lines.join('\n');
        },
    };
}

module.exports = { createMetrics, routeName };
