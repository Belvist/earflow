import { createHmac, timingSafeEqual as cryptoTse } from 'node:crypto';

import { StreamTicketEpochCache } from './streamTicketEpochCache';

const OPAQUE_KEY_PREFIX = 'auth:stream_ticket:opaque:';
const JWT_TYPE_SESSION = 'stream_session_ticket';
const JWT_AUD_SESSION = 'earflow-stream-session';
const TICKET_TYPE_MEDIA = 'media_access_ticket';
const TICKET_TYPE_SESSION = 'stream_session_ticket';

export type StreamTicketScope = {
    sessionId?: string;
    trackId?: string;
    partyId?: string;
    deviceId?: string;
    roomId?: string;
};

export type VerifiedStreamTicket = {
    kind: 'stream_session' | 'media';
    userId: string;
    sid: string;
    authDeviceId: string;
    sessionEpoch: number;
    deviceEpoch: number;
    scope: StreamTicketScope;
};

export type StreamTicketTryResult =
    | { present: false }
    | { present: true; ok: true; ticket: VerifiedStreamTicket }
    | { present: true; ok: false; reason: string };

export type StreamTicketMetrics = {
    incConsume(result: 'ok' | 'deny' | 'legacy'): void;
    incEpochStale(): void;
};

type OpaqueStreamTicketRecord = {
    ticketType?: string;
    sid?: string;
    authDeviceId?: string;
    userId?: string;
    sessionEpoch?: number;
    deviceEpoch?: number;
    scope?: StreamTicketScope;
    oneTime?: boolean;
};

function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.byteLength !== b.byteLength) return false;
    try {
        return cryptoTse(Buffer.from(a), Buffer.from(b));
    } catch {
        return false;
    }
}

function parseBase64UrlJson(raw: string): unknown {
    return JSON.parse(Buffer.from(String(raw || ''), 'base64url').toString('utf8'));
}

function parseScope(raw: unknown): StreamTicketScope {
    if (!raw) return {};
    if (typeof raw === 'string') {
        try {
            return parseScope(JSON.parse(raw));
        } catch {
            return {};
        }
    }
    if (typeof raw !== 'object') return {};
    const obj = raw as Record<string, unknown>;
    const pick = (key: string) => {
        const v = obj[key];
        return typeof v === 'string' ? v.trim() : '';
    };
    return {
        sessionId: pick('sessionId'),
        trackId: pick('trackId'),
        partyId: pick('partyId'),
        deviceId: pick('deviceId'),
        roomId: pick('roomId'),
    };
}

function normalizeOpaqueId(raw: string): string | null {
    const v = String(raw || '').trim();
    if (!v || v.length > 128 || !/^[A-Za-z0-9_-]+$/.test(v)) return null;
    return v;
}

export function extractStreamTicketMaterial(req: Request, url: URL): {
    present: boolean;
    mediaOpaque: string;
    sessionJwt: string;
} {
    const mediaHeader = String(req.headers.get('x-stream-media-ticket') || '').trim();
    const sessionHeader = String(req.headers.get('x-stream-session-ticket') || '').trim();
    const queryOpaque = String(url.searchParams.get('st') || '').trim();

    let bearerJwt = '';
    const authRaw = String(req.headers.get('authorization') || '').trim();
    const bearerMatch = /^Bearer\s+(.+)$/i.exec(authRaw);
    if (bearerMatch) {
        const candidate = String(bearerMatch[1] || '').trim();
        if (candidate.split('.').length === 3) {
            try {
                const payloadPart = candidate.split('.')[1] || '';
                const payload = parseBase64UrlJson(payloadPart) as Record<string, unknown>;
                const typ = String(payload?.type || '').trim();
                if (typ === JWT_TYPE_SESSION) bearerJwt = candidate;
            } catch {
                // not a stream session JWT
            }
        }
    }

    const mediaOpaque = mediaHeader || queryOpaque;
    const sessionJwt = sessionHeader || bearerJwt;
    const present = Boolean(mediaOpaque || sessionJwt);
    return { present, mediaOpaque, sessionJwt };
}

export function createStreamTicketVerifier(params: {
    jwtSecret: Uint8Array;
    redisGet: (key: string) => Promise<string | null>;
    epochCache: StreamTicketEpochCache;
    metrics?: StreamTicketMetrics;
    logConsume?: (fields: Record<string, string | number>) => void;
}) {
    const logConsume = params.logConsume ?? (() => undefined);

    function verifyEpochs(ticket: VerifiedStreamTicket): string | null {
        if (params.epochCache.isSessionRevoked(ticket.sid)) return 'session_revoked';
        if (params.epochCache.sessionEpochStale(ticket.sid, ticket.sessionEpoch)) return 'session_epoch_stale';
        if (ticket.authDeviceId && params.epochCache.deviceEpochStale(ticket.authDeviceId, ticket.deviceEpoch)) {
            return 'device_epoch_stale';
        }
        return null;
    }

    function verifyStreamSessionJwt(token: string, nowMs: number): VerifiedStreamTicket | null {
        const raw = String(token || '').trim();
        if (!raw || raw.length > 4096) return null;
        const parts = raw.split('.');
        if (parts.length !== 3) return null;

        const [headerPart, payloadPart, sigPart] = parts;
        if (!headerPart || !payloadPart || !sigPart) return null;

        let header: Record<string, unknown>;
        let payload: Record<string, unknown>;
        try {
            header = parseBase64UrlJson(headerPart) as Record<string, unknown>;
            payload = parseBase64UrlJson(payloadPart) as Record<string, unknown>;
        } catch {
            return null;
        }

        if (header?.alg !== 'HS256') return null;
        if (String(payload?.type || '').trim() !== JWT_TYPE_SESSION) return null;
        const aud = payload?.aud;
        const audOk = aud === JWT_AUD_SESSION || (Array.isArray(aud) && aud.includes(JWT_AUD_SESSION));
        if (!audOk) return null;

        let sig: Uint8Array;
        try {
            sig = new Uint8Array(Buffer.from(sigPart, 'base64url'));
        } catch {
            return null;
        }
        if (sig.byteLength !== 32) return null;

        const signingInput = `${headerPart}.${payloadPart}`;
        const secret = params.jwtSecret;
        if (!(secret instanceof Uint8Array) || secret.byteLength === 0) return null;
        const expected = new Uint8Array(createHmac('sha256', Buffer.from(secret)).update(signingInput).digest());
        if (!safeEqual(expected, sig)) return null;

        const exp = Number(payload.exp);
        const iat = Number(payload.iat);
        const nowSec = Math.floor(nowMs / 1000);
        if (!Number.isFinite(exp) || exp <= 0 || nowSec > exp) return null;
        if (!Number.isFinite(iat) || iat > nowSec + 30) return null;

        const sid = String(payload.sid || '').trim();
        const authDeviceId = String(payload.authDeviceId || '').trim();
        const userId = String(payload.sub || '').trim();
        const sessionEpoch = Number(payload.sessionEpoch);
        const deviceEpoch = Number(payload.deviceEpoch);
        if (!sid || !userId || !/^\d{1,32}$/.test(userId)) return null;
        if (!Number.isFinite(sessionEpoch) || sessionEpoch < 0) return null;
        if (!Number.isFinite(deviceEpoch) || deviceEpoch < 0) return null;

        return {
            kind: 'stream_session',
            userId,
            sid,
            authDeviceId,
            sessionEpoch: Math.trunc(sessionEpoch),
            deviceEpoch: Math.trunc(deviceEpoch),
            scope: parseScope(payload.scope),
        };
    }

    async function verifyMediaOpaque(id: string): Promise<VerifiedStreamTicket | null> {
        const opaqueId = normalizeOpaqueId(id);
        if (!opaqueId) return null;
        const raw = await params.redisGet(`${OPAQUE_KEY_PREFIX}${opaqueId}`).catch(() => null);
        if (!raw) return null;

        let rec: OpaqueStreamTicketRecord;
        try {
            rec = JSON.parse(raw) as OpaqueStreamTicketRecord;
        } catch {
            return null;
        }

        if (String(rec.ticketType || '').trim() !== TICKET_TYPE_MEDIA) return null;
        const sid = String(rec.sid || '').trim();
        const authDeviceId = String(rec.authDeviceId || '').trim();
        const userId = String(rec.userId || '').trim();
        const sessionEpoch = Number(rec.sessionEpoch);
        const deviceEpoch = Number(rec.deviceEpoch);
        if (!sid || !userId || !/^\d{1,32}$/.test(userId)) return null;
        if (!Number.isFinite(sessionEpoch) || sessionEpoch < 0) return null;
        if (!Number.isFinite(deviceEpoch) || deviceEpoch < 0) return null;

        return {
            kind: 'media',
            userId,
            sid,
            authDeviceId,
            sessionEpoch: Math.trunc(sessionEpoch),
            deviceEpoch: Math.trunc(deviceEpoch),
            scope: parseScope(rec.scope),
        };
    }

    function validateScope(
        ticket: VerifiedStreamTicket,
        context: { sessionId?: string; trackId?: string; trackRef?: string; recordTrackId?: number; recordTrackRef?: string },
    ): boolean {
        const scopeSession = String(ticket.scope.sessionId || '').trim();
        const scopeTrack = String(ticket.scope.trackId || '').trim();
        if (!scopeSession || !scopeTrack) return false;

        if (context.sessionId && scopeSession !== context.sessionId) return false;

        const hasTrackContext = Boolean(
            context.trackId || context.trackRef || context.recordTrackId !== undefined || context.recordTrackRef,
        );
        if (!hasTrackContext) return true;

        const candidates = new Set<string>();
        if (context.trackId) candidates.add(String(context.trackId).trim().toLowerCase());
        if (context.trackRef) candidates.add(String(context.trackRef).trim().toLowerCase());
        if (context.recordTrackId !== undefined) candidates.add(String(context.recordTrackId).trim().toLowerCase());
        if (context.recordTrackRef) candidates.add(String(context.recordTrackRef).trim().toLowerCase());

        return candidates.has(scopeTrack.toLowerCase());
    }

    async function tryVerify(
        req: Request,
        url: URL,
        context: { sessionId?: string; trackId?: string; trackRef?: string; recordTrackId?: number; recordTrackRef?: string },
    ): Promise<StreamTicketTryResult> {
        const material = extractStreamTicketMaterial(req, url);
        if (!material.present) return { present: false };

        let ticket: VerifiedStreamTicket | null = null;
        if (material.sessionJwt) {
            ticket = verifyStreamSessionJwt(material.sessionJwt, Date.now());
        } else if (material.mediaOpaque) {
            ticket = await verifyMediaOpaque(material.mediaOpaque);
        }

        if (!ticket) {
            params.metrics?.incConsume('deny');
            logConsume({ kind: material.sessionJwt ? 'stream_session' : 'media', result: 'deny', reason: 'invalid' });
            return { present: true, ok: false, reason: 'invalid' };
        }

        const epochReason = verifyEpochs(ticket);
        if (epochReason) {
            params.metrics?.incEpochStale();
            params.metrics?.incConsume('deny');
            logConsume({ kind: ticket.kind, result: 'deny', reason: epochReason });
            return { present: true, ok: false, reason: epochReason };
        }

        if (!validateScope(ticket, context)) {
            params.metrics?.incConsume('deny');
            logConsume({ kind: ticket.kind, result: 'deny', reason: 'scope_mismatch' });
            return { present: true, ok: false, reason: 'scope_mismatch' };
        }

        params.metrics?.incConsume('ok');
        const uid = ticket.userId.length > 12 ? `${ticket.userId.slice(0, 12)}…` : ticket.userId;
        logConsume({ kind: ticket.kind, result: 'ok', userId: uid });
        return { present: true, ok: true, ticket };
    }

    return {
        tryVerify,
        verifyStreamSessionJwt,
        verifyMediaOpaque,
        validateScope,
        verifyEpochs,
        constants: {
            JWT_TYPE_SESSION,
            TICKET_TYPE_MEDIA,
            TICKET_TYPE_SESSION,
        },
    };
}
