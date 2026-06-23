#!/usr/bin/env node
/**
 * SEC-005 Phase 2 OBSERVE — gateway mint integration (no consume/enforce).
 */
import {
  exchangeProofAccessToken,
  generateDeviceMaterial,
  loginRegisterDevice,
  mintStreamTicketWithFullProof,
  mintStreamTicketWithProofToken,
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

  const scopeMedia = { sessionId: 'sess_observe_1', trackId: 'track_observe_1' };

  const media = await mintStreamTicketWithProofToken({
    baseUrl,
    origin,
    jar,
    material,
    proofToken: token,
    kind: 'media',
    scope: scopeMedia,
  });
  assert(media.status === 200, `media mint HTTP ${media.status}`);
  assert(media.data?.ticketType === 'media_access_ticket', 'media ticketType');
  assert(media.data?.transport === 'query', 'media transport query');
  assert(typeof media.data?.ticket === 'string' && media.data.ticket.length > 8, 'media opaque ticket');

  const session = await mintStreamTicketWithProofToken({
    baseUrl,
    origin,
    jar,
    material,
    proofToken: token,
    kind: 'stream_session',
    scope: scopeMedia,
  });
  assert(session.status === 200, `stream_session mint HTTP ${session.status}`);
  assert(session.data?.ticketType === 'stream_session_ticket', 'stream_session ticketType');
  assert(session.data?.transport === 'header', 'stream_session transport header');

  const wsTokenOnly = await mintStreamTicketWithProofToken({
    baseUrl,
    origin,
    jar,
    material,
    proofToken: token,
    kind: 'ws',
    scope: { deviceId: 'dev_observe_1' },
  });
  assert(wsTokenOnly.status === 401, `ws proof-token-only HTTP ${wsTokenOnly.status} (want 401)`);

  const ws = await mintStreamTicketWithFullProof({
    baseUrl,
    origin,
    jar,
    material,
    kind: 'ws',
    scope: { deviceId: 'dev_observe_1' },
  });
  assert(ws.status === 200, `ws full-proof mint HTTP ${ws.status}`);
  assert(ws.data?.ticketType === 'ws_connect_ticket', 'ws ticketType');
  assert(ws.data?.transport === 'query', 'ws transport query');

  console.log('');
  console.log('SEC-005 stream ticket OBSERVE mint: PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
