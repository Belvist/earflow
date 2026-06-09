type HttpRecord = {
    method: string;
    route: string;
    status: number;
    durationSeconds: number;
};

type RouteStats = {
    count: number;
    durationSecondsSum: number;
    statuses: Map<string, number>;
};

function normalizeLabel(value: string, fallback: string): string {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return fallback;
    return raw.replace(/[^a-z0-9_:-]/g, '_').slice(0, 80) || fallback;
}

function labelValue(value: string): string {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function labels(values: Record<string, string>): string {
    return Object.entries(values)
        .map(([k, v]) => `${k}="${labelValue(v)}"`)
        .join(',');
}

export function routeName(pathname: string): string {
    const path = String(pathname || '').trim();
    if (path === '/health') return 'health';
    if (path === '/metrics') return 'metrics';
    if (path === '/api/stream/v2/session') return 'stream_session';
    if (path === '/api/stream/v2/session/batch') return 'stream_session_batch';
    if (path === '/api/stream/v2/share') return 'stream_share';
    if (path === '/api/stream/v3/session') return 'playback_session';
    if (path.startsWith('/api/stream/v3/session/')) return 'playback_session_refresh';
    if (path.startsWith('/audio/v3/cache/')) return 'audio_v3_cache';
    if (path.startsWith('/audio/v3/')) return 'audio_v3';
    if (path.startsWith('/audio/v1/')) return 'audio_v1';
    if (path.startsWith('/api/stream/v2/crypt/')) return 'stream_crypt';
    return 'other';
}

type StreamTicketConsumeResult = 'ok' | 'deny' | 'legacy';

export function createMetrics() {
    const startedAt = Date.now();
    const routes = new Map<string, RouteStats>();
    const streamTicketConsume = new Map<StreamTicketConsumeResult, number>();
    let streamTicketEpochStale = 0;

    function routeKey(method: string, route: string): string {
        return `${normalizeLabel(method, 'unknown')}\n${normalizeLabel(route, 'unknown')}`;
    }

    function getStats(method: string, route: string): RouteStats {
        const key = routeKey(method, route);
        let stats = routes.get(key);
        if (!stats) {
            stats = { count: 0, durationSecondsSum: 0, statuses: new Map() };
            routes.set(key, stats);
        }
        return stats;
    }

    return {
        incStreamTicketConsume(result: StreamTicketConsumeResult) {
            streamTicketConsume.set(result, (streamTicketConsume.get(result) || 0) + 1);
        },

        incStreamTicketEpochStale() {
            streamTicketEpochStale += 1;
        },

        recordHttp(record: HttpRecord) {
            const method = normalizeLabel(record.method, 'unknown').toUpperCase();
            const route = normalizeLabel(record.route, 'unknown');
            const status = Number.isFinite(record.status) ? Math.trunc(record.status) : 500;
            const duration = Number.isFinite(record.durationSeconds) && record.durationSeconds >= 0
                ? record.durationSeconds
                : 0;

            const stats = getStats(method, route);
            stats.count += 1;
            stats.durationSecondsSum += duration;
            const statusKey = String(status);
            stats.statuses.set(statusKey, (stats.statuses.get(statusKey) || 0) + 1);
        },

        prometheusText(): string {
            const lines: string[] = [
                '# HELP direct_stream_up Service readiness state.',
                '# TYPE direct_stream_up gauge',
                'direct_stream_up 1',
                '# HELP direct_stream_uptime_seconds Service uptime in seconds.',
                '# TYPE direct_stream_uptime_seconds gauge',
                `direct_stream_uptime_seconds ${Math.floor((Date.now() - startedAt) / 1000)}`,
                '# HELP direct_stream_http_requests_total HTTP requests by method, route, and status.',
                '# TYPE direct_stream_http_requests_total counter',
            ];

            for (const [key, stats] of routes.entries()) {
                const [methodRaw, routeRaw] = key.split('\n');
                const method = methodRaw || 'unknown';
                const route = routeRaw || 'unknown';
                for (const [status, count] of stats.statuses.entries()) {
                    lines.push(`direct_stream_http_requests_total{${labels({ method, route, status })}} ${count}`);
                }
            }

            lines.push(
                '# HELP direct_stream_http_request_duration_seconds HTTP request duration summary.',
                '# TYPE direct_stream_http_request_duration_seconds summary',
            );

            for (const [key, stats] of routes.entries()) {
                const [methodRaw, routeRaw] = key.split('\n');
                const method = methodRaw || 'unknown';
                const route = routeRaw || 'unknown';
                const labelSet = labels({ method, route });
                lines.push(`direct_stream_http_request_duration_seconds_sum{${labelSet}} ${stats.durationSecondsSum}`);
                lines.push(`direct_stream_http_request_duration_seconds_count{${labelSet}} ${stats.count}`);
            }

            lines.push(
                '# HELP direct_stream_stream_ticket_consume_total Scoped stream ticket consume attempts.',
                '# TYPE direct_stream_stream_ticket_consume_total counter',
            );
            for (const result of ['ok', 'deny', 'legacy'] as const) {
                const count = streamTicketConsume.get(result) || 0;
                lines.push(`direct_stream_stream_ticket_consume_total{${labels({ result })}} ${count}`);
            }
            lines.push(
                '# HELP direct_stream_stream_ticket_epoch_stale_total Stream tickets rejected due to stale epoch.',
                '# TYPE direct_stream_stream_ticket_epoch_stale_total counter',
                `direct_stream_stream_ticket_epoch_stale_total ${streamTicketEpochStale}`,
            );

            lines.push('');
            return lines.join('\n');
        },
    };
}

export function metricsResponse(metrics: { prometheusText(): string }): Response {
    return new Response(metrics.prometheusText(), {
        status: 200,
        headers: {
            'content-type': 'text/plain; version=0.0.4; charset=utf-8',
            'cache-control': 'no-store',
        },
    });
}
