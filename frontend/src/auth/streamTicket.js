import { signDeviceProofRequest, isDeviceProofEnforced } from './authDeviceCrypto';
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

/**
 * Check if PoP is actually ready for stream ticket minting.
 * Returns false if:
 * - Stream ticket mint is disabled via env
 * - PoP is not enforced (legacy path should be used)
 * - PoP is enforced but device proof is not available
 *   This prevents 403 on /api/auth/stream-ticket when ENFORCE=1 but PoP not ready.
 */
function isPoPReadyForStreamTicket() {
  const mintFlag = String(process.env.REACT_APP_STREAM_TICKET_MINT_ENABLED || '0').trim() === '1';
  if (!mintFlag) return false;
  if (!isProofAccessTokenEnabled()) return false;
  if (!isDeviceProofEnforced()) return false;
  return true;
}

/** Grep prod/staging bundles in verify-stream-ticket-phase4.sh (CRA inlines at build). */
export const STREAM_TICKET_MINT_BUILD_MARKER =
  String(process.env.REACT_APP_STREAM_TICKET_MINT_ENABLED || '0').trim() === '1'
    ? 'earflow:stream-ticket-mint:1'
    : 'earflow:stream-ticket-mint:0';

// Side effect: CRA must retain marker string in main bundle (verify-stream-ticket-phase4.sh).
if (typeof window !== 'undefined') {
  try {
    Object.defineProperty(window, '__EARFLOW_STREAM_TICKET_MINT_BUILD__', {
      value: STREAM_TICKET_MINT_BUILD_MARKER,
      enumerable: false,
      configurable: true,
    });
  } catch {
    window.__EARFLOW_STREAM_TICKET_MINT_BUILD__ = STREAM_TICKET_MINT_BUILD_MARKER;
  }
}

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
  if (!sid || !tid) return null;

  // If PoP is not ready, don't even try — return null so caller uses legacy path.
  // This prevents 403 storms when STREAM_TICKET_ENFORCE=1 but PoP device key not registered.
  if (!isStreamTicketMintEnabled()) {
    return null;
  }

  const cacheKey = `${sid}:${tid}`;
  const now = Date.now();
  const cached = mediaTicketCache.get(cacheKey);
  if (cached && cached.expiresAtMs > now + 5000) {
    return cached.ticket;
  }

  // getHotPathProofHeaders handles PoP-sensitive paths (including /api/auth/stream-ticket)
  // by using full ECDSA proof. If proof fails, it falls back to empty headers.
  // We detect the fallback and abort early to avoid 403 on the server.
  const proofHeaders = await getHotPathProofHeaders('POST', '/api/auth/stream-ticket');
  if (!proofHeaders || Object.keys(proofHeaders).length === 0) {
    // PoP proof unavailable — don't mint, use legacy path
    return null;
  }

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
    // Stream ticket endpoint disabled on server — use legacy path
    return null;
  }
  if (resp.status === 403) {
    // PoP proof rejected — clear cache, don't retry
    mediaTicketCache.delete(cacheKey);
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

export async function mintWsConnectStreamTicket({ deviceId, signal } = {}) {
  const did = String(deviceId || '').trim();
  if (!did) return null;

  // If PoP is not ready, don't even try — return null so caller uses legacy path.
  if (!isStreamTicketMintEnabled()) {
    return null;
  }

  // ws_connect_ticket — одноразовый (GetDel на стороне device-sync), поэтому
  // НЕ кэшируем: каждый connect/reconnect минтит свежий тикет.
  const mintPath = '/api/auth/stream-ticket';
  const signed = await signDeviceProofRequest('POST', `${apiBaseUrl()}${mintPath}`);
  if (!signed?.headers) {
    // PoP proof unavailable — don't mint, use legacy path
    return null;
  }

  const csrf = getCsrfToken();
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...signed.headers,
  };
  if (csrf) {
    headers['X-CSRF-Token'] = csrf;
  }

  const resp = await fetch(`${apiBaseUrl()}${mintPath}`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({
      kind: 'ws',
      scope: { deviceId: did },
      client: 'web',
    }),
    signal,
  });

  if (resp.status === 404) {
    // Stream ticket endpoint disabled on server — use legacy path
    return null;
  }
  if (resp.status === 403) {
    // PoP proof rejected — don't retry
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
