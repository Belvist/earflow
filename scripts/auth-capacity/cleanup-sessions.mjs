#!/usr/bin/env node
/**
 * PEND-SEC-CAPACITY-001 — revoke bootstrap test sessions (auth-e2e only).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deserializeMaterial,
  parseCookieHeader,
  revokeOthersWithProof,
  revokeSessionWithProof,
} from './lib/deviceProof.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const sessionsFile =
  process.env.CAPACITY_SESSIONS_FILE ||
  path.join(ROOT, 'artifacts/auth-capacity/sessions.json');
const baseUrl = process.env.CAPACITY_BASE_URL || 'http://127.0.0.1:18080';
const origin = process.env.CAPACITY_ORIGIN || baseUrl;

async function main() {
  if (!fs.existsSync(sessionsFile)) {
    console.log('cleanup: no sessions file — skip');
    return;
  }
  const raw = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
  const sessions = raw.sessions || [];
  if (!sessions.length) {
    console.log('cleanup: empty sessions — skip');
    return;
  }

  const keeper = sessions[0];
  const material = await deserializeMaterial(keeper);
  const jar = parseCookieHeader(keeper.cookieHeader);
  jar.mp_csrf = keeper.mpCsrf || jar.mp_csrf;

  const others = await revokeOthersWithProof({ baseUrl, origin, jar, material });
  console.log(`cleanup revoke-others: ${others.status}`);

  const self = await revokeSessionWithProof({
    baseUrl,
    origin,
    jar,
    material,
    targetSid: keeper.sid,
  });
  console.log(`cleanup revoke self: ${self.status}`);
}

main().catch((err) => {
  console.error('cleanup failed:', err.message);
  process.exit(1);
});
