import { expect, test } from 'bun:test';

import { createMetrics, routeName } from './metrics';

test('subscription metrics export normalized http counters', () => {
    const metrics = createMetrics();
    metrics.recordHttp({ method: 'GET', route: routeName('/api/subscriptions/me'), status: 401, durationSeconds: 0.002 });
    metrics.recordHttp({ method: 'POST', route: routeName('/api/subscriptions/subscribe'), status: 200, durationSeconds: 0.01 });

    const text = metrics.prometheusText();
    expect(text).toContain('subscription_service_up 1');
    expect(text).toContain('subscription_service_http_requests_total');
    expect(text).toContain('route="subscription_me"');
    expect(text).toContain('status="401"');
    expect(text).toContain('route="subscription_subscribe"');
    expect(text).toContain('subscription_service_http_request_duration_seconds_count');
});
