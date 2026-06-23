#!/usr/bin/env node
/**
 * SEC-005 Phase 8 — mint ws_connect opaque ticket → upgrade /ws/devices (dual-mode).
 */
import {
  apiFetch,
  buildProofHeaders,
  cookieHeader,
  exchangeProofAccessToken,
  generateDeviceMaterial,
  loginRegisterDevice,
  mintStreamTicketWithFullProof,
} from '../auth-capacity/lib/deviceProof.mjs';

const baseUrl = process.env.AUTH_E2E_BASE_URL || 'http://127.0.0.1:18080';
const origin = process.env.AUTH_E2E_ORIGIN || baseUrl;
const email = process.env.AUTH_E2E_EMAIL || '';
const password = process.env.AUTH_E2E_PASSWORD || '';

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL  ${msg}`);
    process.exit(1);
  }
  console.log(`PASS  ${msg}`);
}

function wsUrlFromHttpBase(httpBase, ticket) {
  const u = new URL(httpBase);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = '/ws/devices';
  u.search = `ticket=${encodeURIComponent(ticket)}`;
  return u.toString();
}

async function tryWsOpen(url, { origin: wsOrigin }) {
  if (typeof WebSocket === 'undefined') {
    assert(false, 'WebSocket global unavailable (need Node 22+)');
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* noop */ }
      resolve({ ok: false, reason: 'timeout' });
    }, 8000);
    const ws = new WebSocket(url, { headers: { Origin: wsOrigin } });
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      try { ws.close(); } catch { /* noop */ }
      resolve({ ok: true });
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      resolve({ ok: false, reason: 'error' });
    });
    ws.addEventListener('close', (ev) => {
      clearTimeout(timer);
      resolve({ ok: false, reason: `close:${ev.code}` });
    });
  });
}

async function main() {
  assert(email && password, 'AUTH_E2E_EMAIL and AUTH_E2E_PASSWORD required');

  const material = await generateDeviceMaterial();
  const { jar } = await loginRegisterDevice({
    baseUrl,
    origin,
    email,
    password,
    material,
  });
  const { token } = await exchangeProofAccessToken({ baseUrl, origin, jar, material });

  const reg = await apiFetch(baseUrl, origin, '/api/devices/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader(jar),
      'X-Auth-Device-Id': material.authDeviceId,
      'X-Auth-Proof-Access-Token': token,
    },
    body: JSON.stringify({ name: 'sec005-ws-gate', kind: 'web' }),
  });
  if (reg.status === 503) {
    assert(false, 'device-sync disabled (set DEVICE_SYNC_ENABLED=1 on auth-e2e)');
  }
  assert(reg.status === 201 || reg.status === 200, `device register status=${reg.status}`);
  const deviceId = String(reg.data?.device?.id || '').trim();
  assert(deviceId, 'device id missing from register');

  const legacyTicket = await apiFetch(baseUrl, origin, '/api/devices/ws-ticket', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader(jar),
      'X-Auth-Device-Id': material.authDeviceId,
      'X-Auth-Proof-Access-Token': token,
    },
    body: JSON.stringify({ deviceId }),
  });
  assert(legacyTicket.status === 200 && legacyTicket.data?.token, 'legacy ws-ticket mint');

  const legacyWs = await tryWsOpen(wsUrlFromHttpBase(baseUrl, legacyTicket.data.token), { origin });
  assert(legacyWs.ok, `legacy ws upgrade (${legacyWs.reason || 'ok'})`);

  const opaqueMint = await mintStreamTicketWithFullProof({
    baseUrl,
    origin,
    jar,
    material,
    kind: 'ws',
    scope: { deviceId },
  });
  assert(opaqueMint.status === 200, `opaque ws mint status=${opaqueMint.status}`);
  const opaque = String(opaqueMint.data?.ticket || '').trim();
  assert(opaque && !opaque.includes('.'), 'opaque ws ticket shape');

  const opaqueWs = await tryWsOpen(wsUrlFromHttpBase(baseUrl, opaque), { origin });
  assert(opaqueWs.ok, `opaque ws upgrade (${opaqueWs.reason || 'ok'})`);

  const garbage = await tryWsOpen(wsUrlFromHttpBase(baseUrl, 'not-a-valid-ticket'), { origin });
  assert(!garbage.ok, 'garbage ticket must not open ws');
}

main().catch((e) => {
  console.error('FAIL ', e?.message || e);
  process.exit(1);
});
