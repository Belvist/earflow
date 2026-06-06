import { describe, expect, test } from 'bun:test';

import { createMetrics, routeName } from './metrics';

describe('direct stream metrics', () => {
    test('normalizes streaming routes and exports prometheus text', () => {
        const metrics = createMetrics();
        metrics.recordHttp({ method: 'GET', route: routeName('/audio/v1/abc/source/hash.mp3'), status: 200, durationSeconds: 0.015 });
        metrics.recordHttp({ method: 'GET', route: routeName('/audio/v3/tracks/abc/master.m3u8'), status: 401, durationSeconds: 0.003 });
        metrics.recordHttp({ method: 'POST', route: routeName('/api/stream/v2/session'), status: 401, durationSeconds: 0.005 });
        metrics.recordHttp({ method: 'POST', route: routeName('/api/stream/v3/session'), status: 200, durationSeconds: 0.007 });

        const text = metrics.prometheusText();
        expect(text).toContain('direct_stream_up 1');
        expect(text).toContain('direct_stream_http_requests_total');
        expect(text).toContain('route="audio_v1"');
        expect(text).toContain('route="audio_v3"');
        expect(text).toContain('status="200"');
        expect(text).toContain('route="stream_session"');
        expect(text).toContain('route="playback_session"');
        expect(text).toContain('status="401"');
        expect(text).toContain('direct_stream_http_request_duration_seconds_count');
    });
});
