import { TextEncoder as NodeTextEncoder } from 'util';
import {
    buildPartyConnectError,
    decodePartyWsTokenClaims,
    getUserIdFromPartyWsToken,
    rememberPartyWsTicket,
    resolvePartyFrameUserId,
    takeRememberedPartyWsTicket,
} from '../partyConnection';

const TestTextEncoder = typeof TextEncoder === 'function' ? TextEncoder : NodeTextEncoder;

function encodePayload(payload) {
    const json = JSON.stringify(payload);
    const bytes = new TestTextEncoder().encode(json);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

describe('party connection helpers', () => {
    test('decodes user id from ws token payload without checking signature client-side', () => {
        const token = `${encodePayload({ v: 1, partyId: 'p1', userId: 'u42', expMs: 123 })}.signature`;

        expect(decodePartyWsTokenClaims(token)).toMatchObject({ userId: 'u42', partyId: 'p1' });
        expect(getUserIdFromPartyWsToken(token)).toBe('u42');
    });

    test('returns empty values for malformed token', () => {
        expect(decodePartyWsTokenClaims('not-a-token')).toBeNull();
        expect(getUserIdFromPartyWsToken('not-a-token')).toBe('');
    });

    test('resolves party frame user id from strongest available source', () => {
        expect(resolvePartyFrameUserId('', null, 'from-ticket', 'from-sync')).toBe('from-ticket');
        expect(resolvePartyFrameUserId('', null, '', 'from-sync')).toBe('from-sync');
    });

    test('stores one fresh party ws ticket for immediate connect', () => {
        const token = `${encodePayload({ v: 1, partyId: 'p1', userId: 'u42', expMs: Date.now() + 60000 })}.signature`;

        expect(rememberPartyWsTicket('p1', token)).toBe(true);
        expect(takeRememberedPartyWsTicket('p1')).toBe(token);
        expect(takeRememberedPartyWsTicket('p1')).toBe('');
    });

    test('normalizes connection errors for UI state', () => {
        expect(buildPartyConnectError({ status: 403, details: { code: 'NOT_AUTHORIZED' } })).toMatchObject({
            code: 'NOT_AUTHORIZED',
            status: 403,
        });
    });
});
