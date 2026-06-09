import { getHotPathProofHeaders, isProofAccessTokenEnabled } from './proofAccessToken';
import { getCsrfToken } from './cookieHelpers';

/** In-memory only — never localStorage (SEC-005 red flag). */
const mediaTicketCache = new Map();

const apiBaseUrl = () => {
  const raw = String(process.env.REACT_APP_API_URL || '').trim();
  if (raw) return raw.replace(/\/+$/, '');
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, '');
  }
  return '';
};

export function isStreamTicketMintEnabled() {
  const mintFlag = String(process.env.REACT_APP_STREAM_TICKET_MINT_ENABLED || '0').trim() === '1';
  return mintFlag && isProofAccessTokenEnabled() === true;
}

export function clearStreamTicketCache() {
  mediaTicketCache.clear();
}

export function attachMediaTicketToUrl(rawUrl, ticket) {
  const raw = String(rawUrl || '').trim();
  const opaque = String(ticket || '').trim();
  if (!raw || !opaque) return raw;

  try {
    const base =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'http://localhost';
    const u = new URL(raw, base);
    u.searchParams.set('st', opaque);
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      return u.toString();
    }
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    const sep = raw.includes('?') ? '&' : '?';
    return `${raw}${sep}st=${encodeURIComponent(opaque)}`;
  }
}

export function applyMediaTicketToPlaybackSession(result, ticket) {
  if (!result || !ticket) return result;
  const attach = (url) => (url ? attachMediaTicketToUrl(url, ticket) : url);
  const next = { ...result, url: attach(result.url) };
  if (next.masterUrl) next.masterUrl = attach(next.masterUrl);
  if (next.manifestUrl) next.manifestUrl = attach(next.manifestUrl);
  if (Array.isArray(next.qualities)) {
    next.qualities = next.qualities.map((q) => (
      q && typeof q === 'object' ? { ...q, url: attach(q.url) } : q
    ));
  }
  return next;
}

export async function mintMediaStreamTicket({ sessionId, trackId, signal } = {}) {
  const sid = String(sessionId || '').trim();
  const tid = String(trackId || '').trim();
  if (!sid || !tid || !isStreamTicketMintEnabled()) {
    return null;
  }

  const cacheKey = `${sid}:${tid}`;
  const now = Date.now();
  const cached = mediaTicketCache.get(cacheKey);
  if (cached && cached.expiresAtMs > now + 5000) {
    return cached.ticket;
  }

  const proofHeaders = await getHotPathProofHeaders('POST', '/api/auth/stream-ticket');
  const csrf = getCsrfToken();
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...proofHeaders,
  };
  if (csrf) {
    headers['X-CSRF-Token'] = csrf;
  }

  const resp = await fetch(`${apiBaseUrl()}/api/auth/stream-ticket`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({
      kind: 'media',
      scope: { sessionId: sid, trackId: tid },
      client: 'web',
    }),
    signal,
  });

  if (resp.status === 404) {
    return null;
  }
  if (!resp.ok) {
    return null;
  }

  let body = {};
  try {
    body = await resp.json();
  } catch {
    return null;
  }

  const ticket = String(body?.ticket || '').trim();
  if (!ticket) {
    return null;
  }

  const expiresIn = Number(body?.expiresIn);
  const expiresAtMs =
    Number.isFinite(expiresIn) && expiresIn > 0 ? now + expiresIn * 1000 : now + 60_000;
  mediaTicketCache.set(cacheKey, { ticket, expiresAtMs });
  return ticket;
}

export async function attachMediaTicketToDirectSession(result, trackId, signal) {
  if (!result || !result.sessionId) {
    return result;
  }
  const ticket = await mintMediaStreamTicket({
    sessionId: result.sessionId,
    trackId: String(trackId),
    signal,
  });
  if (!ticket) {
    return result;
  }
  return applyMediaTicketToPlaybackSession(result, ticket);
}
