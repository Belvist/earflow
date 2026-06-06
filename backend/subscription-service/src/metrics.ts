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

function escapeLabel(value: string): string {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function labels(values: Record<string, string>): string {
    return Object.entries(values).map(([k, v]) => `${k}="${escapeLabel(v)}"`).join(',');
}

export function routeName(pathname: string): string {
    const path = String(pathname || '').trim();
    if (path === '/health') return 'health';
    if (path === '/metrics') return 'metrics';
    if (path === '/api/subscriptions/plans') return 'subscription_plans';
    if (path === '/api/subscriptions/me') return 'subscription_me';
    if (path === '/api/subscriptions/subscribe') return 'subscription_subscribe';
    if (path === '/api/subscriptions/cancel') return 'subscription_cancel';
    return 'other';
}

export function createMetrics() {
    const startedAt = Date.now();
    const routes = new Map<string, RouteStats>();

    return {
        recordHttp(record: HttpRecord) {
            const method = normalizeLabel(record.method, 'unknown').toUpperCase();
            const route = normalizeLabel(record.route, 'unknown');
            const key = `${method}\n${route}`;
            let stats = routes.get(key);
            if (!stats) {
                stats = { count: 0, durationSecondsSum: 0, statuses: new Map() };
                routes.set(key, stats);
            }
            const status = Number.isFinite(record.status) ? String(Math.trunc(record.status)) : '500';
            const duration = Number.isFinite(record.durationSeconds) && record.durationSeconds >= 0 ? record.durationSeconds : 0;
            stats.count += 1;
            stats.durationSecondsSum += duration;
            stats.statuses.set(status, (stats.statuses.get(status) || 0) + 1);
        },
        prometheusText(): string {
            const lines = [
                '# HELP subscription_service_up Service readiness state.',
                '# TYPE subscription_service_up gauge',
                'subscription_service_up 1',
                '# HELP subscription_service_uptime_seconds Service uptime in seconds.',
                '# TYPE subscription_service_uptime_seconds gauge',
                `subscription_service_uptime_seconds ${Math.floor((Date.now() - startedAt) / 1000)}`,
                '# HELP subscription_service_http_requests_total HTTP requests by method, route, and status.',
                '# TYPE subscription_service_http_requests_total counter',
            ];

            for (const [key, stats] of routes.entries()) {
                const [method = 'unknown', route = 'unknown'] = key.split('\n');
                for (const [status, count] of stats.statuses.entries()) {
                    lines.push(`subscription_service_http_requests_total{${labels({ method, route, status })}} ${count}`);
                }
            }

            lines.push(
                '# HELP subscription_service_http_request_duration_seconds HTTP request duration summary.',
                '# TYPE subscription_service_http_request_duration_seconds summary',
            );
            for (const [key, stats] of routes.entries()) {
                const [method = 'unknown', route = 'unknown'] = key.split('\n');
                const labelSet = labels({ method, route });
                lines.push(`subscription_service_http_request_duration_seconds_sum{${labelSet}} ${stats.durationSecondsSum}`);
                lines.push(`subscription_service_http_request_duration_seconds_count{${labelSet}} ${stats.count}`);
            }
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
