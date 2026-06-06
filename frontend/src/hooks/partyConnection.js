export function decodePartyWsTokenClaims(token) {
    const raw = typeof token === 'string' ? token.trim() : '';
    if (!raw) return null;

    const dot = raw.indexOf('.');
    const payload = dot > 0 ? raw.slice(0, dot) : raw;
    if (!payload) return null;

    try {
        const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
        const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
        const atobFn = typeof window !== 'undefined' ? window.atob : null;
        if (typeof atobFn !== 'function') return null;

        const binary = atobFn(padded);
        let json = '';
        if (typeof TextDecoder === 'function') {
            const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
            json = new TextDecoder().decode(bytes);
        } else {
            json = binary;
        }

        const claims = JSON.parse(json);
        return claims && typeof claims === 'object' ? claims : null;
    } catch {
        return null;
    }
}

export function getUserIdFromPartyWsToken(token) {
    const claims = decodePartyWsTokenClaims(token);
    const uid = claims?.userId != null ? String(claims.userId).trim() : '';
    return uid;
}

const pendingPartyWsTickets = new Map();
const PARTY_WS_TICKET_SKEW_MS = 5000;

export function rememberPartyWsTicket(partyId, ticket) {
    const pid = partyId != null ? String(partyId).trim() : '';
    const tok = typeof ticket === 'string' ? ticket.trim() : '';
    if (!pid || !tok) return false;

    const claims = decodePartyWsTokenClaims(tok);
    const expMs = Number(claims?.expMs);
    if (!Number.isFinite(expMs) || expMs <= Date.now() + PARTY_WS_TICKET_SKEW_MS) {
        return false;
    }

    pendingPartyWsTickets.set(pid, { ticket: tok, expMs });
    return true;
}

export function takeRememberedPartyWsTicket(partyId) {
    const pid = partyId != null ? String(partyId).trim() : '';
    if (!pid) return '';

    const rec = pendingPartyWsTickets.get(pid);
    if (!rec) return '';
    pendingPartyWsTickets.delete(pid);

    if (!rec.ticket || rec.expMs <= Date.now() + PARTY_WS_TICKET_SKEW_MS) {
        return '';
    }
    return rec.ticket;
}

export function resolvePartyFrameUserId(...candidates) {
    for (const candidate of candidates) {
        const value = candidate != null ? String(candidate).trim() : '';
        if (value) return value;
    }
    return '';
}

export function buildPartyConnectError(error, fallbackCode = 'WS_TICKET_FAILED') {
    const e = error && typeof error === 'object' ? error : null;
    const details = e && e.details && typeof e.details === 'object' ? e.details : null;
    const code =
        (details && typeof details.code === 'string' && details.code.trim())
        || (e && typeof e.code === 'string' && e.code.trim())
        || fallbackCode;
    const status = e && Number.isFinite(Number(e.status)) ? Number(e.status) : undefined;
    const message =
        (e && typeof e.message === 'string' && e.message.trim())
        || (status === 401 || status === 403 ? 'Authentication required' : 'Unable to open party connection');

    return {
        code,
        message,
        ...(status ? { status } : {}),
    };
}
