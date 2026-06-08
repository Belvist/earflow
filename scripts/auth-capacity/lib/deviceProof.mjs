/**
 * PEND-SEC-CAPACITY-001 — Node device proof helpers (mirrors browser PoP path).
 * Node 18+ (Web Crypto via globalThis or node:crypto). No external deps.
 */
import { webcrypto } from 'node:crypto';

/** ESM has no bare `crypto` on Node 18 — use explicit Web Crypto binding. */
const crypto = globalThis.crypto?.subtle ? globalThis.crypto : webcrypto;

const CANONICAL_V1 = (method, path, query, ts, nonce, sidHash) =>
  ['v1', method, path, query, ts, nonce, sidHash].join('\n');

export function generateAuthDeviceId() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const b64 = Buffer.from(bytes).toString('base64url');
  return `adev_${b64}`.slice(0, 64);
}

export function parseSetCookie(setCookieHeader) {
  const jar = {};
  const parts = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : [];
  for (const raw of parts) {
    const segment = String(raw).split(';')[0];
    const eq = segment.indexOf('=');
    if (eq <= 0) continue;
    const name = segment.slice(0, eq).trim();
    const value = segment.slice(eq + 1).trim();
    if (name) jar[name] = value;
  }
  return jar;
}

export function cookieHeader(jar) {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

export async function exportSpki(publicKey) {
  const raw = await crypto.subtle.exportKey('spki', publicKey);
  return Buffer.from(raw).toString('base64url');
}

export async function signProof(privateKey, body) {
  const sigBuf = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(body),
  );
  return Buffer.from(sigBuf).toString('base64url');
}

export async function generateDeviceMaterial(authDeviceId = generateAuthDeviceId()) {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
  const publicKeySpki = await exportSpki(keyPair.publicKey);
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  return {
    authDeviceId,
    publicKeySpki,
    privateKeyPkcs8: Buffer.from(pkcs8).toString('base64'),
    privateKey,
    sidHash: '',
  };
}

export async function buildProofHeaders(method, path, sidHash, material) {
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = `nonce_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  const body = CANONICAL_V1(method, path, '', ts, nonce, sidHash || '');
  const proof = await signProof(material.privateKey, body);
  return {
    'X-Auth-Device-Id': material.authDeviceId,
    'X-Auth-Device-Proof': proof,
    'X-Auth-Device-Proof-Ts': ts,
    'X-Auth-Device-Proof-Nonce': nonce,
  };
}

export async function apiFetch(baseUrl, origin, path, options = {}) {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  const headers = {
    Accept: 'application/json',
    Origin: origin,
    ...options.headers,
  };
  const resp = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body,
    redirect: 'manual',
  });
  const setCookie = resp.headers.getSetCookie?.() ?? [];
  if (setCookie.length === 0) {
    const single = resp.headers.get('set-cookie');
    if (single) setCookie.push(single);
  }
  const text = await resp.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return {
    status: resp.status,
    ok: resp.ok,
    data,
    cookies: parseSetCookie(setCookie),
  };
}

export async function loginRegisterDevice({
  baseUrl,
  origin,
  email,
  password,
  material,
}) {
  let jar = {};
  const login = await apiFetch(baseUrl, origin, '/api/auth/email/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  jar = { ...jar, ...login.cookies };
  if (!login.ok) {
    const detail = login.data?.code || login.data?.error || login.data?.raw || '';
    const snippet = String(detail).slice(0, 120);
    throw new Error(`login_failed_${login.status}${snippet ? `_${snippet}` : ''}`);
  }

  const csrf = await apiFetch(baseUrl, origin, '/api/auth/csrf', {
    headers: { Cookie: cookieHeader(jar) },
  });
  jar = { ...jar, ...csrf.cookies };

  const reg = await apiFetch(baseUrl, origin, '/api/auth/device/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader(jar),
      'X-CSRF-Token': jar.mp_csrf || '',
    },
    body: JSON.stringify({
      authDeviceId: material.authDeviceId,
      publicKeySpki: material.publicKeySpki,
    }),
  });
  if (reg.status !== 200 || !reg.data?.sidHash) {
    throw new Error(`register_failed_${reg.status}`);
  }
  material.sidHash = reg.data.sidHash;

  return { jar, material, sid: jar.mp_sid || '' };
}

export async function exchangeProofAccessToken({ baseUrl, origin, jar, material }) {
  const proofHeaders = await buildProofHeaders(
    'POST',
    '/api/auth/proof/token',
    material.sidHash,
    material,
  );
  const resp = await apiFetch(baseUrl, origin, '/api/auth/proof/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader(jar),
      'X-CSRF-Token': jar.mp_csrf || '',
      ...proofHeaders,
    },
  });
  if (resp.status !== 200 || !resp.data?.token) {
    throw new Error(`proof_token_failed_${resp.status}_${resp.data?.code || ''}`);
  }
  return {
    token: resp.data.token,
    expiresIn: resp.data.expiresIn,
    exp: decodeJwtExp(resp.data.token),
  };
}

export async function hotProfile({ baseUrl, origin, jar, material, token }) {
  return apiFetch(baseUrl, origin, '/api/profile', {
    headers: {
      Cookie: cookieHeader(jar),
      'X-Auth-Device-Id': material.authDeviceId,
      'X-Auth-Proof-Access-Token': token,
    },
  });
}

export async function refreshWithFullProof({ baseUrl, origin, jar, material }) {
  const proofHeaders = await buildProofHeaders(
    'POST',
    '/api/auth/refresh',
    material.sidHash,
    material,
  );
  return apiFetch(baseUrl, origin, '/api/auth/refresh', {
    method: 'POST',
    headers: {
      Cookie: cookieHeader(jar),
      ...proofHeaders,
    },
  });
}

export async function listSessionsWithProof({ baseUrl, origin, jar, material }) {
  const proofHeaders = await buildProofHeaders(
    'GET',
    '/api/auth/sessions',
    material.sidHash,
    material,
  );
  return apiFetch(baseUrl, origin, '/api/auth/sessions', {
    headers: {
      Cookie: cookieHeader(jar),
      ...proofHeaders,
    },
  });
}

export async function revokeOthersWithProof({ baseUrl, origin, jar, material }) {
  const proofHeaders = await buildProofHeaders(
    'POST',
    '/api/auth/sessions/revoke-others',
    material.sidHash,
    material,
  );
  return apiFetch(baseUrl, origin, '/api/auth/sessions/revoke-others', {
    method: 'POST',
    headers: {
      Cookie: cookieHeader(jar),
      'X-CSRF-Token': jar.mp_csrf || '',
      ...proofHeaders,
    },
  });
}

export async function revokeSessionWithProof({
  baseUrl,
  origin,
  jar,
  material,
  targetSid,
}) {
  const proofHeaders = await buildProofHeaders(
    'POST',
    '/api/auth/sessions/revoke',
    material.sidHash,
    material,
  );
  return apiFetch(baseUrl, origin, '/api/auth/sessions/revoke', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader(jar),
      'X-CSRF-Token': jar.mp_csrf || '',
      ...proofHeaders,
    },
    body: JSON.stringify({ sid: targetSid }),
  });
}

export function decodeJwtExp(token) {
  try {
    const payload = token.split('.')[1];
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number(json.exp) || 0;
  } catch {
    return 0;
  }
}

export function serializeSession({ jar, material, token, expiresIn, sid }) {
  return {
    sid,
    authDeviceId: material.authDeviceId,
    sidHash: material.sidHash,
    cookieHeader: cookieHeader(jar),
    mpCsrf: jar.mp_csrf || '',
    privateKeyPkcs8: material.privateKeyPkcs8,
    publicKeySpki: material.publicKeySpki,
    proofToken: token,
    proofTokenExp: decodeJwtExp(token),
    proofExpiresIn: expiresIn,
  };
}

export async function deserializeMaterial(session) {
  const pkcs8 = Buffer.from(session.privateKeyPkcs8, 'base64');
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  return {
    authDeviceId: session.authDeviceId,
    publicKeySpki: session.publicKeySpki,
    privateKeyPkcs8: session.privateKeyPkcs8,
    privateKey,
    sidHash: session.sidHash,
  };
}

export function parseCookieHeader(header) {
  const jar = {};
  for (const part of String(header || '').split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    jar[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return jar;
}
