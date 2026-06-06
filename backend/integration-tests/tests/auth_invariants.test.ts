import { describe, expect, test } from 'bun:test';
import { loadIntegrationEnv } from '../src/env';
import { assertHeader, fetchWithTimeout, waitForHealthy } from '../src/http';

describe('gateway auth & CORS invariants', () => {
    const env = loadIntegrationEnv();
    const sampleTrackId = env.notReadyTrackId ?? 1;

    let gatewayReady: Promise<void> | null = null;
    const ensureGatewayUp = async () => {
        if (!gatewayReady) {
            gatewayReady = waitForHealthy({ url: `${env.gatewayBaseUrl}/health`, timeoutMs: 10_000, intervalMs: 250, requestTimeoutMs: 1000 });
        }
        await gatewayReady;
    };

    test('requires user session for /api/ebap-hls/v1/session', async () => {
        await ensureGatewayUp();
        const url = `${env.gatewayBaseUrl}/api/ebap-hls/v1/session`;
        const res = await fetchWithTimeout(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ trackId: sampleTrackId }),
        }, 15_000);

        expect(res.status).toBe(401);
        const j = await res.json().catch(() => null);
        const code = j && typeof j === 'object' ? (j as any).code : null;
        if (code !== null) {
            expect(code).toBe('NO_SESSION');
        }
    }, 15_000);

    test('spoofed X-User-Id is ignored (still unauthorized)', async () => {
        await ensureGatewayUp();
        const url = `${env.gatewayBaseUrl}/api/ebap-hls/v1/session`;
        const res = await fetchWithTimeout(url, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-user-id': '999999',
                'x-user-role': 'admin',
            },
            body: JSON.stringify({ trackId: sampleTrackId }),
        }, 15_000);

        expect(res.status).toBe(401);
        const j = await res.json().catch(() => null);
        const code = j && typeof j === 'object' ? (j as any).code : null;
        if (code !== null) {
            expect(code).toBe('NO_SESSION');
        }
    }, 15_000);

    test('CORS allows configured Origin and credentials', async () => {
        await ensureGatewayUp();
        const url = `${env.gatewayBaseUrl}/api/ebap-hls/v1/session`;
        const res = await fetchWithTimeout(url, {
            method: 'OPTIONS',
            headers: {
                Origin: env.origin,
                'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'content-type',
            },
        }, 15_000);

        expect(res.status).toBe(204);
        assertHeader(res, 'access-control-allow-origin', env.origin);
        assertHeader(res, 'access-control-allow-credentials', 'true');
    }, 15_000);
});
