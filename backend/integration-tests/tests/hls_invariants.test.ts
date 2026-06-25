import { describe, expect, test } from 'bun:test';
import { loadIntegrationEnv } from '../src/env';
import {
    assertCacheControlHas,
    fetchWithTimeout,
    parseM3u8FirstUri,
    parseM3u8FirstSegmentUri,
    parseM3u8InitUri,
    parseSetCookiesFromHeaders,
    resolvePath,
    waitForHealthy,
} from '../src/http';

type SessionResp = { masterUrl: string };

function splitSetCookieCombinedHeader(value: string): string[] {
    const s = String(value || '').trim();
    if (!s) return [];

    const out: string[] = [];
    let start = 0;
    let inExpires = false;

    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === ';') {
            inExpires = false;
            continue;
        }

        if (ch === ',') {
            if (!inExpires) {
                const part = s.slice(start, i).trim();
                if (part) out.push(part);
                start = i + 1;
            }
            continue;
        }

        if (!inExpires && (ch === 'E' || ch === 'e')) {
            const tail = s.slice(i, i + 8).toLowerCase();
            if (tail === 'expires=') {
                inExpires = true;
            }
        }
    }

    const last = s.slice(start).trim();
    if (last) out.push(last);
    return out;
}

function countSetCookieName(headers: Headers, cookieName: string): number {
    const h: any = headers as any;
    const getSetCookie = typeof h?.getSetCookie === 'function' ? h.getSetCookie.bind(h) : null;
    const values: string[] = getSetCookie ? (getSetCookie() as string[]) : [headers.get('set-cookie') || ''];

    let count = 0;
    for (const v of values) {
        const parts = splitSetCookieCombinedHeader(v);
        for (const p of parts) {
            const firstPart = p.split(';')[0] || '';
            const idx = firstPart.indexOf('=');
            if (idx <= 0) continue;
            const name = firstPart.slice(0, idx).trim();
            if (name === cookieName) count += 1;
        }
    }
    return count;
}

async function createHlsSession(params: {
    baseUrl: string;
    trackId: number;
    userId: string;
    gatewayCookie: string | null;
    csrfToken: string | null;
    origin: string;
    prefetch?: boolean;
}): Promise<{ masterUrl: string; mpHlsCookie: string; mpLyricsCookie: string; calledBaseUrl: string }> {
    const headers: Record<string, string> = {
        'content-type': 'application/json',
    };

    if (params.gatewayCookie && params.csrfToken) {
        headers.cookie = params.gatewayCookie;
        headers['x-csrf-token'] = params.csrfToken;
        headers.origin = params.origin;
    } else {
        headers['x-user-id'] = params.userId;
    }

    if (params.prefetch) {
        headers['x-earflow-session-intent'] = 'prefetch';
    }

    const res = await fetchWithTimeout(`${params.baseUrl}/api/ebap-hls/v1/session`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            trackId: params.trackId,
            ...(params.prefetch ? { prefetch: true } : {}),
        }),
    }, 15_000);

    if (res.status !== 200) {
        const body = await res.text().catch(() => '');
        throw new Error(`session failed: status=${res.status} body=${body.slice(0, 512)}`);
    }

    const mpHlsSetCount = countSetCookieName(res.headers, 'mp_hls');
    if (params.prefetch) {
        if (mpHlsSetCount !== 0) {
            throw new Error(`prefetch session must not set mp_hls, got ${mpHlsSetCount}`);
        }
    } else if (mpHlsSetCount !== 1) {
        throw new Error(`session response must set mp_hls exactly once, got ${mpHlsSetCount}`);
    }

    const j = (await res.json()) as SessionResp & { prefetch?: boolean };
    if (!j || typeof j.masterUrl !== 'string' || !j.masterUrl) {
        throw new Error('session response missing masterUrl');
    }

    const cookies = parseSetCookiesFromHeaders(res.headers);
    const mpHlsCookie = cookies['mp_hls'] || '';
    if (!params.prefetch && !mpHlsCookie) {
        throw new Error('session response missing mp_hls cookie');
    }

    const mpLyricsCookie = cookies['mp_lyrics'] || '';
    if (!params.prefetch && !mpLyricsCookie) {
        throw new Error('session response missing mp_lyrics cookie');
    }

    return { masterUrl: j.masterUrl, mpHlsCookie, mpLyricsCookie, calledBaseUrl: params.baseUrl };
}

async function fetchLyricsViaAdapter(params: { baseUrl: string; mpLyricsCookie: string }): Promise<Response> {
    return await fetchWithTimeout(`${params.baseUrl}/api/ebap-hls/v1/lyrics`, {
        method: 'GET',
        headers: {
            cookie: `mp_lyrics=${params.mpLyricsCookie}`,
        },
    }, 10_000);
}

async function fetchLyricsBinViaAdapter(params: { baseUrl: string; mpLyricsCookie: string }): Promise<Response> {
    return await fetchWithTimeout(`${params.baseUrl}/api/ebap-hls/v1/lyrics.bin`, {
        method: 'GET',
        headers: {
            cookie: `mp_lyrics=${params.mpLyricsCookie}`,
        },
    }, 10_000);
}

describe('ebap-hls-adapter HLS invariants', () => {
    const env = loadIntegrationEnv();
    const readyTrackId = env.readyTrackId;
    const notReadyTrackId = env.notReadyTrackId;

    let adapterReady: Promise<void> | null = null;
    const ensureAdapterUp = async () => {
        if (!adapterReady) {
            adapterReady = waitForHealthy({ url: `${env.adapterBaseUrl}/health`, timeoutMs: 10_000, intervalMs: 250, requestTimeoutMs: 1000 });
        }
        await adapterReady;
    };

    let gatewayReady: Promise<void> | null = null;
    const ensureGatewayUp = async () => {
        if (!gatewayReady) {
            gatewayReady = waitForHealthy({ url: `${env.gatewayBaseUrl}/health`, timeoutMs: 10_000, intervalMs: 250, requestTimeoutMs: 1000 });
        }
        await gatewayReady;
    };

    if (!readyTrackId || !notReadyTrackId) {
        test.skip('requires IT_TRACK_READY_ID and IT_TRACK_NOT_READY_ID', () => {
            expect(true).toBe(true);
        });
        return;
    }

    test('not ready track: master.m3u8 -> 503 with retry-after', async () => {
        await ensureAdapterUp();
        const sessionBaseUrl = env.gatewayCookie && env.csrfToken ? env.gatewayBaseUrl : env.adapterBaseUrl;
        if (sessionBaseUrl === env.gatewayBaseUrl) {
            await ensureGatewayUp();
        }
        const sess = await createHlsSession({
            baseUrl: sessionBaseUrl,
            trackId: notReadyTrackId,
            userId: env.testUserId,
            gatewayCookie: env.gatewayCookie,
            csrfToken: env.csrfToken,
            origin: env.origin,
        });
        const masterUrl = resolvePath(env.deliveryBaseUrl, sess.masterUrl);

        const res = await fetch(masterUrl, {
            method: 'GET',
            headers: { cookie: `mp_hls=${sess.mpHlsCookie}` },
        });

        expect(res.status).toBe(503);
        expect(res.headers.get('retry-after')).toBe('1');
    });

    test('ready track: playlists no-store; segments no-store; Range -> 206', async () => {
        await ensureAdapterUp();
        const sessionBaseUrl = env.gatewayCookie && env.csrfToken ? env.gatewayBaseUrl : env.adapterBaseUrl;
        if (sessionBaseUrl === env.gatewayBaseUrl) {
            await ensureGatewayUp();
        }
        const sess = await createHlsSession({
            baseUrl: sessionBaseUrl,
            trackId: readyTrackId,
            userId: env.testUserId,
            gatewayCookie: env.gatewayCookie,
            csrfToken: env.csrfToken,
            origin: env.origin,
        });
        const masterUrl = resolvePath(env.deliveryBaseUrl, sess.masterUrl);

        const masterRes = await fetch(masterUrl, { headers: { cookie: `mp_hls=${sess.mpHlsCookie}` } });
        expect(masterRes.status).toBe(200);
        assertCacheControlHas(masterRes, ['private', 'no-store']);

        const masterBody = await masterRes.text();
        const variantRel = parseM3u8FirstUri(masterBody);
        const variantUrl = new URL(variantRel, masterUrl).toString();

        const variantRes = await fetch(variantUrl, { headers: { cookie: `mp_hls=${sess.mpHlsCookie}` } });
        expect(variantRes.status).toBe(200);
        assertCacheControlHas(variantRes, ['private', 'no-store']);

        const variantBody = await variantRes.text();
        const initRel = parseM3u8InitUri(variantBody);
        const segRel = parseM3u8FirstSegmentUri(variantBody);

        const initUrl = new URL(initRel, variantUrl).toString();
        const segUrl = new URL(segRel, variantUrl).toString();

        const initRangeRes = await fetch(initUrl, {
            headers: { cookie: `mp_hls=${sess.mpHlsCookie}`, range: 'bytes=0-1' },
        });
        expect(initRangeRes.status).toBe(206);
        assertCacheControlHas(initRangeRes, ['private', 'no-store']);
        expect(String(initRangeRes.headers.get('content-range') || '')).toMatch(/^bytes 0-1\//);

        const segRangeRes = await fetch(segUrl, {
            headers: { cookie: `mp_hls=${sess.mpHlsCookie}`, range: 'bytes=0-1' },
        });
        expect(segRangeRes.status).toBe(206);
        assertCacheControlHas(segRangeRes, ['private', 'no-store']);
        expect(String(segRangeRes.headers.get('content-range') || '')).toMatch(/^bytes 0-1\//);
    }, 15_000);

    test('signed URLs: session returns masterUrl?token=... and playlists embed tokenized URIs', async () => {
        if (!env.hlsSignedUrls) {
            expect(true).toBe(true);
            return;
        }

        await ensureAdapterUp();
        const sessionBaseUrl = env.gatewayCookie && env.csrfToken ? env.gatewayBaseUrl : env.adapterBaseUrl;
        if (sessionBaseUrl === env.gatewayBaseUrl) {
            await ensureGatewayUp();
        }

        const sess = await createHlsSession({
            baseUrl: sessionBaseUrl,
            trackId: readyTrackId,
            userId: env.testUserId,
            gatewayCookie: env.gatewayCookie,
            csrfToken: env.csrfToken,
            origin: env.origin,
        });

        const masterUrl = resolvePath(env.deliveryBaseUrl, sess.masterUrl);
        expect(masterUrl).toContain('token=');

        const masterRes = await fetch(masterUrl);
        expect(masterRes.status).toBe(200);
        assertCacheControlHas(masterRes, ['private', 'no-store']);

        const masterBody = await masterRes.text();
        const variantRel = parseM3u8FirstUri(masterBody);
        expect(variantRel).toContain('token=');

        const variantUrl = new URL(variantRel, masterUrl).toString();
        const variantRes = await fetch(variantUrl);
        expect(variantRes.status).toBe(200);
        assertCacheControlHas(variantRes, ['private', 'no-store']);

        const variantBody = await variantRes.text();
        const initRel = parseM3u8InitUri(variantBody);
        const segRel = parseM3u8FirstSegmentUri(variantBody);
        expect(initRel).toContain('token=');
        expect(segRel).toContain('token=');
    }, 20_000);

    test('signed URLs: reject wrong fileName; enforce token-only on binary assets when configured', async () => {
        if (!env.hlsSignedUrls) {
            expect(true).toBe(true);
            return;
        }

        await ensureAdapterUp();
        const sessionBaseUrl = env.gatewayCookie && env.csrfToken ? env.gatewayBaseUrl : env.adapterBaseUrl;
        if (sessionBaseUrl === env.gatewayBaseUrl) {
            await ensureGatewayUp();
        }

        const sess = await createHlsSession({
            baseUrl: sessionBaseUrl,
            trackId: readyTrackId,
            userId: env.testUserId,
            gatewayCookie: env.gatewayCookie,
            csrfToken: env.csrfToken,
            origin: env.origin,
        });

        const masterUrl = resolvePath(env.deliveryBaseUrl, sess.masterUrl);
        const masterRes = await fetch(masterUrl);
        expect(masterRes.status).toBe(200);

        const masterBody = await masterRes.text();
        const variantRel = parseM3u8FirstUri(masterBody);
        const variantUrl = new URL(variantRel, masterUrl).toString();

        const variantRes = await fetch(variantUrl);
        expect(variantRes.status).toBe(200);

        const variantBody = await variantRes.text();
        const initRel = parseM3u8InitUri(variantBody);
        const segRel = parseM3u8FirstSegmentUri(variantBody);
        const initUrl = new URL(initRel, variantUrl).toString();
        const segUrl = new URL(segRel, variantUrl).toString();

        const initNoToken = initUrl.split('?')[0];
        const segNoToken = segUrl.split('?')[0];

        const initNoTokenWithCookie = await fetch(initNoToken, {
            headers: { cookie: `mp_hls=${sess.mpHlsCookie}`, range: 'bytes=0-1' },
        });
        const segNoTokenWithCookie = await fetch(segNoToken, {
            headers: { cookie: `mp_hls=${sess.mpHlsCookie}`, range: 'bytes=0-1' },
        });

        if (env.hlsAssetTokenOnly) {
            expect(initNoTokenWithCookie.status).toBe(401);
            expect(segNoTokenWithCookie.status).toBe(401);
        } else {
            expect(initNoTokenWithCookie.status).toBe(206);
            expect(segNoTokenWithCookie.status).toBe(206);
        }

        const initOk = await fetch(initUrl, { headers: { range: 'bytes=0-1' } });
        expect([200, 206]).toContain(initOk.status);

        const segOk = await fetch(segUrl, { headers: { range: 'bytes=0-1' } });
        expect([200, 206]).toContain(segOk.status);

        const wrongFileNameUrl = initUrl.replace(/init\.mp4(\?|$)/, 'seg_00001.m4s$1');
        const wrongRes = await fetch(wrongFileNameUrl, { headers: { range: 'bytes=0-1' } });
        expect(wrongRes.status).toBe(401);
    }, 25_000);

    test('lyrics endpoint requires mp_lyrics cookie (direct adapter)', async () => {
        const env = loadIntegrationEnv();
        const res = await fetchWithTimeout(`${env.adapterBaseUrl}/api/ebap-hls/v1/lyrics`, { method: 'GET' }, 10_000);
        expect(res.status).toBe(401);
    }, 10_000);

    test('lyrics.bin endpoint requires mp_lyrics cookie (direct adapter)', async () => {
        const env = loadIntegrationEnv();
        const res = await fetchWithTimeout(`${env.adapterBaseUrl}/api/ebap-hls/v1/lyrics.bin`, { method: 'GET' }, 10_000);
        expect(res.status).toBe(401);
    }, 10_000);

    test('lyrics endpoint is session-scoped and returns 200 or 204', async () => {
        const env = loadIntegrationEnv();
        const trackId = env.readyTrackId ?? env.notReadyTrackId ?? 1;
        const { mpLyricsCookie, calledBaseUrl } = await createHlsSession({
            baseUrl: env.adapterBaseUrl,
            trackId,
            userId: env.testUserId,
            gatewayCookie: env.gatewayCookie,
            csrfToken: env.csrfToken,
            origin: env.origin,
        });

        const res = await fetchLyricsViaAdapter({ baseUrl: calledBaseUrl, mpLyricsCookie });
        expect([200, 204]).toContain(res.status);
        if (res.status === 200) {
            const j = await res.json().catch(() => null);
            const songId = j && typeof j === 'object' ? (j as any).songId : null;
            if (songId !== null) {
                expect(Number(songId)).toBe(Number(trackId));
            }
        }
    }, 20_000);

    test('lyrics.bin endpoint is session-scoped and returns 200 or 204', async () => {
        const env = loadIntegrationEnv();
        const trackId = env.readyTrackId ?? env.notReadyTrackId ?? 1;
        const { mpLyricsCookie, calledBaseUrl } = await createHlsSession({
            baseUrl: env.adapterBaseUrl,
            trackId,
            userId: env.testUserId,
            gatewayCookie: env.gatewayCookie,
            csrfToken: env.csrfToken,
            origin: env.origin,
        });

        const res = await fetchLyricsBinViaAdapter({ baseUrl: calledBaseUrl, mpLyricsCookie });
        expect([200, 204]).toContain(res.status);
        if (res.status === 200) {
            expect(String(res.headers.get('content-type') || '')).toContain('application/octet-stream');
        }
    }, 20_000);

    test('prefetch session: masterUrl without mp_hls Set-Cookie', async () => {
        await ensureAdapterUp();
        const sessionBaseUrl = env.gatewayCookie && env.csrfToken ? env.gatewayBaseUrl : env.adapterBaseUrl;
        if (sessionBaseUrl === env.gatewayBaseUrl) {
            await ensureGatewayUp();
        }
        const sess = await createHlsSession({
            baseUrl: sessionBaseUrl,
            trackId: readyTrackId,
            userId: env.testUserId,
            gatewayCookie: env.gatewayCookie,
            csrfToken: env.csrfToken,
            origin: env.origin,
            prefetch: true,
        });
        expect(sess.mpHlsCookie).toBe('');
        expect(sess.masterUrl).toMatch(/token=/);
    }, 15_000);
});
