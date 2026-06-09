#!/usr/bin/env node
/**
 * SEC-005 Phase 3 ACCEPT — mint media ticket → consume on direct-stream (dual-mode).
 */
import {
  apiFetch,
  cookieHeader,
  exchangeProofAccessToken,
  generateDeviceMaterial,
  loginRegisterDevice,
  mintStreamTicketWithProofToken,
} from '../auth-capacity/lib/deviceProof.mjs';

const baseUrl = process.env.AUTH_E2E_BASE_URL || 'http://127.0.0.1:18080';
const origin = process.env.AUTH_E2E_ORIGIN || baseUrl;
const streamBase = (process.env.DIRECT_STREAM_BASE_URL || 'http://127.0.0.1:3096').replace(/\/$/, '');
const email = process.env.AUTH_E2E_EMAIL || '';
const password = process.env.AUTH_E2E_PASSWORD || '';

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL  ${msg}`);
    process.exit(1);
  }
  console.log(`PASS  ${msg}`);
}

function sessionHeaders(jar, material, token) {
  return {
    'Content-Type': 'application/json',
    Cookie: cookieHeader(jar),
    'X-CSRF-Token': jar.mp_csrf || '',
    'X-Auth-Device-Id': material.authDeviceId,
    'X-Auth-Proof-Access-Token': token,
  };
}

async function createPlaybackSession(ctx, trackId) {
  return apiFetch(ctx.baseUrl, ctx.origin, '/api/stream/v3/session', {
    method: 'POST',
    headers: sessionHeaders(ctx.jar, ctx.material, ctx.token),
    body: JSON.stringify({ trackId, mode: 'direct' }),
  });
}

async function collectTrackCandidates(ctx) {
  const candidates = [];
  const explicit = Number(process.env.AUTH_E2E_TRACK_ID || '');
  if (Number.isInteger(explicit) && explicit > 0) {
    candidates.push(explicit);
  }

  const rec = await apiFetch(ctx.baseUrl, ctx.origin, '/api/recommendations/init', {
    method: 'POST',
    headers: sessionHeaders(ctx.jar, ctx.material, ctx.token),
    body: JSON.stringify({ limit: 12 }),
  });
  if (rec.ok && Array.isArray(rec.data?.tracks)) {
    for (const t of rec.data.tracks) {
      const id = Number(t?.id);
      if (Number.isInteger(id) && id > 0 && !candidates.includes(id)) {
        candidates.push(id);
      }
    }
  }

  return candidates;
}

async function resolveStreamableTrackId(ctx) {
  const candidates = await collectTrackCandidates(ctx);
  if (candidates.length === 0) {
    assert(false, 'no track candidates (set AUTH_E2E_TRACK_ID or seed songs with file_path)');
  }

  const attempts = [];
  for (const id of candidates) {
    const sessionRes = await createPlaybackSession(ctx, id);
    if (sessionRes.status === 200) {
      console.log(`PASS  resolved streamable trackId=${id}`);
      return { trackId: id, sessionRes };
    }
    const code = sessionRes.data?.code || sessionRes.data?.error || '';
    attempts.push(`${id}:${sessionRes.status}${code ? `/${code}` : ''}`);
  }

  assert(false, `no streamable track (tried ${attempts.join(', ')})`);
  return { trackId: 0, sessionRes: null };
}

async function headStream(path, headers = {}) {
  const res = await fetch(`${streamBase}${path}`, { method: 'HEAD', headers });
  return res.status;
}

async function main() {
  if (!email || !password) {
    console.error('AUTH_E2E_EMAIL and AUTH_E2E_PASSWORD required');
    process.exit(1);
  }

  const material = await generateDeviceMaterial();
  const { jar } = await loginRegisterDevice({
    baseUrl,
    origin,
    email,
    password,
    material,
  });

  const { token } = await exchangeProofAccessToken({
    baseUrl,
    origin,
    jar,
    material,
  });

  const ctx = { baseUrl, origin, jar, material, token };
  const { trackId, sessionRes } = await resolveStreamableTrackId(ctx);
  assert(true, 'playback session HTTP 200');
  Object.assign(jar, sessionRes.cookies || {});
  const sessionId = String(sessionRes.data?.sessionId || '').trim();
  const scopeTrackId = String(sessionRes.data?.trackId || trackId).trim();
  assert(/^ps_[A-Za-z0-9_-]{20,96}$/.test(sessionId), 'playback sessionId shape');

  const media = await mintStreamTicketWithProofToken({
    baseUrl,
    origin,
    jar,
    material,
    proofToken: token,
    kind: 'media',
    scope: { sessionId, trackId: scopeTrackId },
  });
  assert(media.status === 200, `media mint HTTP ${media.status}`);
  const opaque = String(media.data?.ticket || '').trim();
  assert(opaque.length > 8, 'opaque media ticket');

  const okPath = `/audio/v3/direct/${encodeURIComponent(sessionId)}/stream?st=${encodeURIComponent(opaque)}`;
  const okStatus = await headStream(okPath);
  assert(okStatus === 200 || okStatus === 206, `HEAD with valid ticket → ${okStatus} (want 200/206)`);

  const badPath = `/audio/v3/direct/${encodeURIComponent(sessionId)}/stream?st=garbage_ticket_value`;
  const badStatus = await headStream(badPath);
  assert(badStatus === 401, `HEAD with garbage ticket → ${badStatus} (want 401)`);

  if (jar.mp_stream) {
    const legacyStatus = await headStream(
      `/audio/v3/direct/${encodeURIComponent(sessionId)}/stream`,
      { Cookie: `mp_stream=${jar.mp_stream}` },
    );
    assert(legacyStatus === 200 || legacyStatus === 206, `legacy cookie HEAD → ${legacyStatus}`);
  } else {
    console.log('SKIP  legacy cookie (Set-Cookie mp_stream not in session response)');
  }

  console.log('');
  console.log('SEC-005 stream ticket ACCEPT consume: PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
