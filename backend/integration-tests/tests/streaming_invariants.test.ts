import { describe, expect, test } from 'bun:test';
import { loadIntegrationEnv } from '../src/env';
import { fetchWithTimeout, waitForHealthy } from '../src/http';

function assertNonEmptyString(value: unknown, name: string): asserts value is string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`${name} must be non-empty string`);
    }
}

describe('streaming invariants: party v2 (go party-go)', () => {
    const env = loadIntegrationEnv();

    let partyReady: Promise<void> | null = null;
    const ensurePartyUp = async () => {
        if (!partyReady) {
            partyReady = waitForHealthy({
                url: `${env.partyBaseUrl}/health`,
                timeoutMs: 10_000,
                intervalMs: 250,
                requestTimeoutMs: 1000,
            });
        }
        await partyReady;
    };

    let partyGwReady: Promise<void> | null = null;
    const ensurePartyGwUp = async () => {
        if (!partyGwReady) {
            partyGwReady = waitForHealthy({
                url: `${env.partyGatewayBaseUrl}/health`,
                timeoutMs: 10_000,
                intervalMs: 250,
                requestTimeoutMs: 1000,
            });
        }
        await partyGwReady;
    };

    test('party v2: create party (REST) -> ws-ticket -> ws /ws/v2 first frame (msgpack binary)', async () => {
        await ensurePartyUp();
        await ensurePartyGwUp();

        const createRes = await fetchWithTimeout(
            `${env.partyBaseUrl}/api/party`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'X-User-Id': env.testUserId,
                    'X-User-Name': 'integration',
                },
                body: JSON.stringify({}),
            },
            15_000,
        );

        expect(createRes.status).toBe(201);
        const created = (await createRes.json()) as { party?: { id?: string } };
        const partyId = created?.party?.id;
        assertNonEmptyString(partyId, 'party.id');

        const ticketRes = await fetchWithTimeout(
            `${env.partyBaseUrl}/api/party/${encodeURIComponent(partyId)}/ws-ticket`,
            {
                method: 'GET',
                headers: {
                    'X-User-Id': env.testUserId,
                    'X-User-Name': 'integration',
                },
            },
            15_000,
        );
        expect(ticketRes.status).toBe(200);
        const tJson = (await ticketRes.json()) as { ticket?: string };
        assertNonEmptyString(tJson.ticket, 'ticket');

        const httpGw = new URL(env.partyGatewayBaseUrl);
        const wsProtocol = httpGw.protocol === 'https:' ? 'wss:' : 'ws:';
        const q = new URLSearchParams({ wsToken: tJson.ticket! });
        const wsUrl = `${wsProtocol}//${httpGw.host}/ws/v2?${q.toString()}`;

        const ws = new WebSocket(wsUrl, {
            headers: {
                'X-User-Id': env.testUserId,
                'X-User-Name': 'integration',
            },
        });

        const nextData = (): Promise<string | ArrayBuffer | Blob> => {
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('WS timeout waiting message')), 10_000);

                const onMessage = (evt: MessageEvent) => {
                    cleanup();
                    resolve((evt as any).data as string | ArrayBuffer | Blob);
                };

                const onError = () => {
                    cleanup();
                    reject(new Error('WS error'));
                };

                const cleanup = () => {
                    clearTimeout(timeout);
                    ws.removeEventListener('message', onMessage as any);
                    ws.removeEventListener('error', onError as any);
                };

                ws.addEventListener('message', onMessage as any);
                ws.addEventListener('error', onError as any);
            });
        };

        await new Promise<void>((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('WS open timeout')), 10_000);
            ws.addEventListener('open', () => {
                clearTimeout(t);
                resolve();
            });
            ws.addEventListener('error', () => {
                clearTimeout(t);
                reject(new Error('WS open error'));
            });
        });

        const first = await nextData();
        if (typeof first === 'string') {
            throw new Error('expected binary first frame for party v2');
        }
        if (first instanceof ArrayBuffer) {
            expect(first.byteLength).toBeGreaterThan(0);
        } else if (typeof Blob !== 'undefined' && first instanceof Blob) {
            expect(first.size).toBeGreaterThan(0);
        } else {
            const u8 = first as any as Uint8Array;
            expect(u8?.byteLength ?? 0).toBeGreaterThan(0);
        }

        ws.close();
    }, 30_000);
});
