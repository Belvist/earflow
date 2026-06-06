'use strict';

function safeLabel(value, fallback) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return fallback;
    return raw.replace(/[^a-z0-9_:-]/g, '_').slice(0, 80) || fallback;
}

function escapeLabel(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function labels(values) {
    return Object.entries(values).map(([k, v]) => `${k}="${escapeLabel(v)}"`).join(',');
}

function routeName(pathname) {
    const path = String(pathname || '').trim();
    if (path === '/health') return 'health';
    if (path === '/metrics') return 'metrics';
    if (path === '/api/import/search') return 'import_search';
    if (path === '/api/import/enrich') return 'import_enrich';
    if (path === '/api/import/batch-enrich') return 'import_batch_enrich';
    if (path === '/api/import/artist-enrich') return 'import_artist_enrich';
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
            const statusLabel = Number.isFinite(Number(status)) ? String(Math.trunc(Number(status))) : '500';
            const duration = Number.isFinite(Number(durationSeconds)) && Number(durationSeconds) >= 0 ? Number(durationSeconds) : 0;
            item.count += 1;
            item.durationSecondsSum += duration;
            item.statuses.set(statusLabel, (item.statuses.get(statusLabel) || 0) + 1);
        },
        prometheusText() {
            const lines = [
                '# HELP import_service_up Service readiness state.',
                '# TYPE import_service_up gauge',
                'import_service_up 1',
                '# HELP import_service_uptime_seconds Service uptime in seconds.',
                '# TYPE import_service_uptime_seconds gauge',
                `import_service_uptime_seconds ${Math.floor((Date.now() - startedAt) / 1000)}`,
                '# HELP import_service_http_requests_total HTTP requests by method, route, and status.',
                '# TYPE import_service_http_requests_total counter',
            ];

            for (const [key, item] of http.entries()) {
                const [method = 'unknown', route = 'unknown'] = key.split('\n');
                for (const [status, count] of item.statuses.entries()) {
                    lines.push(`import_service_http_requests_total{${labels({ method, route, status })}} ${count}`);
                }
            }

            lines.push(
                '# HELP import_service_http_request_duration_seconds HTTP request duration summary.',
                '# TYPE import_service_http_request_duration_seconds summary',
            );
            for (const [key, item] of http.entries()) {
                const [method = 'unknown', route = 'unknown'] = key.split('\n');
                const ls = labels({ method, route });
                lines.push(`import_service_http_request_duration_seconds_sum{${ls}} ${item.durationSecondsSum}`);
                lines.push(`import_service_http_request_duration_seconds_count{${ls}} ${item.count}`);
            }
            lines.push('');
            return lines.join('\n');
        },
    };
}

module.exports = { createMetrics, routeName };
