import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';

import { createStreamTicketVerifier } from './streamTicket';
import { StreamTicketEpochCache } from './streamTicketEpochCache';

const secret = new TextEncoder().encode('test-stream-ticket-jwt-secret-32chars-min');

function signSessionJwt(claims: Record<string, unknown>, nowSec: number): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
        type: 'stream_session_ticket',
        aud: 'earflow-stream-session',
        sid: 'sid_test_1',
        authDeviceId: 'adev_test',
        sessionEpoch: 1,
        deviceEpoch: 1,
        scope: { sessionId: 'ps_testsession123456789012345', trackId: '42' },
        sub: '7',
        iat: nowSec,
        exp: nowSec + 60,
        ...claims,
    })).toString('base64url');
    const signingInput = `${header}.${payload}`;
    const sig = createHmac('sha256', Buffer.from(secret)).update(signingInput).digest('base64url');
    return `${signingInput}.${sig}`;
}

describe('streamTicket verifier', () => {
    test('valid stream_session JWT passes epoch + scope', () => {
        const epochCache = new StreamTicketEpochCache();
        const verifier = createStreamTicketVerifier({
            jwtSecret: secret,
            redisGet: async () => null,
            epochCache,
        });
        const nowSec = Math.floor(Date.now() / 1000);
        const token = signSessionJwt({}, nowSec);
        const ticket = verifier.verifyStreamSessionJwt(token, Date.now());
        expect(ticket?.kind).toBe('stream_session');
        expect(ticket?.userId).toBe('7');
        expect(verifier.validateScope(ticket!, {
            sessionId: 'ps_testsession123456789012345',
            trackRef: '42',
        })).toBe(true);
    });

    test('stale session epoch rejects ticket', () => {
        const epochCache = new StreamTicketEpochCache();
        epochCache.bumpSessionEpoch('sid_test_1', 5);
        const verifier = createStreamTicketVerifier({
            jwtSecret: secret,
            redisGet: async () => null,
            epochCache,
        });
        const nowSec = Math.floor(Date.now() / 1000);
        const token = signSessionJwt({ sessionEpoch: 1 }, nowSec);
        const ticket = verifier.verifyStreamSessionJwt(token, Date.now());
        expect(ticket).not.toBeNull();
        expect(verifier.verifyEpochs(ticket!)).toBe('session_epoch_stale');
    });

    test('valid media opaque from redis passes', async () => {
        const epochCache = new StreamTicketEpochCache();
        const record = JSON.stringify({
            ticketType: 'media_access_ticket',
            sid: 'sid_media',
            authDeviceId: 'adev_media',
            userId: '9',
            sessionEpoch: 2,
            deviceEpoch: 2,
            scope: { sessionId: 'ps_mediasession1234567890123456', trackId: '100' },
            oneTime: false,
        });
        const verifier = createStreamTicketVerifier({
            jwtSecret: secret,
            redisGet: async (key) => (key.endsWith('opaque_ticket_1') ? record : null),
            epochCache,
        });
        const ticket = await verifier.verifyMediaOpaque('opaque_ticket_1');
        expect(ticket?.kind).toBe('media');
        expect(ticket?.userId).toBe('9');
        expect(verifier.validateScope(ticket!, {
            sessionId: 'ps_mediasession1234567890123456',
            recordTrackId: 100,
        })).toBe(true);
    });

    test('wrong scope track fails validation', () => {
        const epochCache = new StreamTicketEpochCache();
        const verifier = createStreamTicketVerifier({
            jwtSecret: secret,
            redisGet: async () => null,
            epochCache,
        });
        const nowSec = Math.floor(Date.now() / 1000);
        const token = signSessionJwt({}, nowSec);
        const ticket = verifier.verifyStreamSessionJwt(token, Date.now());
        expect(verifier.validateScope(ticket!, {
            sessionId: 'ps_testsession123456789012345',
            trackRef: '999',
        })).toBe(false);
    });
});
