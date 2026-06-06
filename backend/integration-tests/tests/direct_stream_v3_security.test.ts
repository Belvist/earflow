import { describe, expect, test } from 'bun:test';
import { loadIntegrationEnv } from '../src/env';
import { fetchWithTimeout, waitForHealthy } from '../src/http';

type PlaybackSessionResp = {
    sessionId: string;
    trackId: string;
    manifestUrl: string;
    playbackToken: string;
    expiresAtMs: number;
};

type DirectSessionResp = {
    sessionId: string;
    trackId: string;
    streamUrl: string;
    mode: string;
    expiresAtMs: number;
};

async function createPlaybackSession(params: { baseUrl: string; trackId: number; userId: string }): Promise<PlaybackSessionResp> {
    const res = await fetchWithTimeout(`${params.baseUrl}/api/stream/v3/session`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-user-id': params.userId,
        },
        body: JSON.stringify({ trackId: params.trackId, mode: 'hls', supportedCodecs: ['aac'] }),
    }, 15_000);

    if (res.status !== 200) {
        const body = await res.text().catch(() => '');
        throw new Error(`direct v3 session failed: status=${res.status} body=${body.slice(0, 512)}`);
    }

    const data = await res.json() as PlaybackSessionResp;
    if (!data || typeof data.sessionId !== 'string' || typeof data.playbackToken !== 'string' || typeof data.manifestUrl !== 'string') {
        throw new Error('direct v3 session response missing auth fields');
    }
    return data;
}

async function createDirectSession(params: { baseUrl: string; trackId: number; userId: string }): Promise<{ data: DirectSessionResp; cookie: string }> {
    const res = await fetchWithTimeout(`${params.baseUrl}/api/stream/v3/session`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-user-id': params.userId,
        },
        body: JSON.stringify({ trackId: params.trackId, mode: 'direct', quality: 'lossless' }),
    }, 15_000);

    if (res.status !== 200) {
        const body = await res.text().catch(() => '');
        throw new Error(`direct v3 session failed: status=${res.status} body=${body.slice(0, 512)}`);
    }

    const data = await res.json() as DirectSessionResp;
    const cookie = String(res.headers.get('set-cookie') || '').split(';')[0] || '';
    if (!data || data.mode !== 'direct' || typeof data.sessionId !== 'string' || typeof data.streamUrl !== 'string') {
        throw new Error('direct v3 session response missing direct stream fields');
    }
    if (!cookie) {
        throw new Error('direct v3 session response missing stream cookie');
    }
    return { data, cookie };
}

function resolveDirectUrl(baseUrl: string, raw: string): string {
    const s = String(raw || '').trim();
    if (!s) throw new Error('empty direct url');
    return new URL(s, baseUrl).toString();
}

describe('direct-stream-service v3 media security invariants', () => {
    const env = loadIntegrationEnv();
    const readyTrackId = env.readyTrackId;

    let directReady: Promise<void> | null = null;
    const ensureDirectUp = async () => {
        if (!directReady) {
            directReady = waitForHealthy({ url: `${env.directStreamBaseUrl}/health`, timeoutMs: 10_000, intervalMs: 250, requestTimeoutMs: 1000 });
        }
        await directReady;
    };

    if (!readyTrackId) {
        test.skip('requires IT_TRACK_READY_ID', () => {
            expect(true).toBe(true);
        });
        return;
    }

    test('direct session is opaque v3 stream and legacy file URLs are fail-closed', async () => {
        await ensureDirectUp();

        const legacySessionRes = await fetchWithTimeout(`${env.directStreamBaseUrl}/api/stream/v2/session`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-user-id': env.testUserId },
            body: JSON.stringify({ trackId: readyTrackId }),
        }, 10_000);
        expect(legacySessionRes.status).toBe(410);
        expect(String(legacySessionRes.headers.get('cache-control') || '').toLowerCase()).toContain('no-store');

        const session = await createDirectSession({ baseUrl: env.directStreamBaseUrl, trackId: readyTrackId, userId: env.testUserId });
        expect(session.data.streamUrl).toContain('/audio/v3/direct/');
        expect(session.data.streamUrl).not.toContain('/audio/v1/');
        expect(session.data.streamUrl).not.toContain('/source/');
        expect(session.data.streamUrl).not.toContain('.flac');
        expect(session.data.streamUrl).not.toContain('sig=');

        const streamUrl = resolveDirectUrl(env.directStreamBaseUrl, session.data.streamUrl);
        const noCookieRes = await fetchWithTimeout(streamUrl, { method: 'GET', headers: { range: 'bytes=0-1023' } }, 10_000);
        expect(noCookieRes.status).toBe(401);

        const directRes = await fetchWithTimeout(streamUrl, {
            method: 'GET',
            headers: { cookie: session.cookie, range: 'bytes=0-9999999', 'sec-fetch-dest': 'audio' },
        }, 10_000);
        expect(directRes.status).toBe(206);
        expect(String(directRes.headers.get('content-range') || '')).toContain('bytes 0-262143/');

        const sourceRes = await fetchWithTimeout(`${env.directStreamBaseUrl}/audio/v1/${readyTrackId}/source/deadbeefdeadbeef.m4a`, {
            method: 'GET',
        }, 10_000);
        expect(sourceRes.status).toBe(403);
        expect(String(sourceRes.headers.get('cache-control') || '').toLowerCase()).toContain('no-store');
    });

    test('v3 HLS media requires matching playback session and bearer token', async () => {
        await ensureDirectUp();
        const session = await createPlaybackSession({ baseUrl: env.directStreamBaseUrl, trackId: readyTrackId, userId: env.testUserId });
        const masterUrl = resolveDirectUrl(env.directStreamBaseUrl, session.manifestUrl);

        const unauthRes = await fetchWithTimeout(masterUrl, { method: 'GET' }, 10_000);
        expect(unauthRes.status).toBe(401);
        expect(String(unauthRes.headers.get('cache-control') || '').toLowerCase()).toContain('no-store');

        const wrongTrackRef = String(session.trackId || '') === '1' ? '2' : '1';
        const wrongTrackUrl = new URL(`/audio/v3/tracks/${wrongTrackRef}/master.m3u8`, env.directStreamBaseUrl).toString();
        const wrongTrackRes = await fetchWithTimeout(wrongTrackUrl, {
            method: 'GET',
            headers: {
                authorization: `Bearer ${session.playbackToken}`,
                'x-playback-session': session.sessionId,
            },
        }, 10_000);
        expect(wrongTrackRes.status).toBe(403);
        expect(String(wrongTrackRes.headers.get('cache-control') || '').toLowerCase()).toContain('no-store');
    });
});
