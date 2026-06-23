import { getAuthDeviceHeaders, isDeviceProofEnforced, signDeviceProofRequest } from './authDeviceCrypto';
import { getArtistCsrfToken } from './cookieHelpers';

const PROOF_ACCESS_TOKEN_ENABLED =
  String(process.env.REACT_APP_PROOF_ACCESS_TOKEN_ENABLED || '1').trim() !== '0';

const PROOF_SKIP_PATHS = new Set([
  '/api/auth/email/login',
  '/api/auth/email/register',
  '/api/auth/telegram/login',
  '/api/auth/csrf',
  '/api/auth/device/register',
  '/api/public-config',
]);

const PROOF_SENSITIVE_PATHS = new Set([
  '/api/auth/logout',
  '/api/auth/refresh',
  '/api/auth/proof/token',
  '/api/auth/device/register',
  '/api/auth/telegram/unlink',
]);

const PROOF_SENSITIVE_PREFIXES = [
  '/api/auth/sessions',
  '/api/auth/devices',
  '/api/auth/password',
  '/api/auth/security',
  '/api/auth/2fa',
  '/api/auth/stream-ticket',
];

let cached = null;
let exchangeInFlight = null;

export function isProofAccessTokenEnabled() {
  return PROOF_ACCESS_TOKEN_ENABLED && isDeviceProofEnforced();
}

export function clearProofAccessToken() {
  cached = null;
  exchangeInFlight = null;
}

const endpointPath = (endpoint) => {
  const raw = String(endpoint || '').trim();
  if (!raw) return '';
  try {
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      return new URL(raw).pathname;
    }
  } catch {
    // ignore
  }
  const q = raw.indexOf('?');
  return q >= 0 ? raw.slice(0, q) : raw;
};

const isSensitiveProofPath = (path) => {
  if (PROOF_SENSITIVE_PATHS.has(path)) return true;
  return PROOF_SENSITIVE_PREFIXES.some((prefix) => path.startsWith(prefix));
};

const apiBaseUrl = () => {
  const raw = String(process.env.REACT_APP_API_URL || '').trim();
  if (raw) return raw.replace(/\/+$/, '');
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, '');
  }
  return '';
};

async function exchangeProofAccessToken() {
  if (exchangeInFlight) {
    return exchangeInFlight;
  }
  exchangeInFlight = (async () => {
    const signed = await signDeviceProofRequest('POST', `${apiBaseUrl()}/api/auth/proof/token`);
    if (!signed?.headers || !signed.authDeviceId) {
      throw new Error('device_proof_unavailable');
    }
    const csrf = getArtistCsrfToken();
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...signed.headers,
    };
    if (csrf) {
      headers['X-CSRF-Token'] = csrf;
    }
    const resp = await fetch(`${apiBaseUrl()}/api/auth/proof/token`, {
      method: 'POST',
      credentials: 'include',
      headers,
    });
    if (!resp.ok) {
      clearProofAccessToken();
      throw new Error(`proof_token_exchange_${resp.status}`);
    }
    const body = await resp.json();
    const token = String(body?.token || '').trim();
    const expiresAtMs = Date.parse(String(body?.expiresAt || ''));
    if (!token) {
      throw new Error('proof_token_empty');
    }
    cached = {
      token,
      authDeviceId: signed.authDeviceId,
      expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : Date.now() + 60_000,
    };
    return cached;
  })();
  try {
    return await exchangeInFlight;
  } finally {
    exchangeInFlight = null;
  }
}

export async function getHotPathProofHeaders(method, endpoint) {
  if (!isProofAccessTokenEnabled()) {
    return getAuthDeviceHeaders(method, endpoint);
  }
  const path = endpointPath(endpoint);
  if (PROOF_SKIP_PATHS.has(path) || isSensitiveProofPath(path)) {
    return getAuthDeviceHeaders(method, endpoint);
  }

  const now = Date.now();
  if (cached && cached.expiresAtMs > now + 5000) {
    return {
      'X-Auth-Device-Id': cached.authDeviceId,
      'X-Auth-Proof-Access-Token': cached.token,
    };
  }

  try {
    const next = await exchangeProofAccessToken();
    return {
      'X-Auth-Device-Id': next.authDeviceId,
      'X-Auth-Proof-Access-Token': next.token,
    };
  } catch {
    return getAuthDeviceHeaders(method, endpoint);
  }
}
