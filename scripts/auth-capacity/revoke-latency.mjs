#!/usr/bin/env node
/**
 * PEND-SEC-CAPACITY-001 — revoke → hot token 401 latency (p99 target ≤2000ms).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateDeviceMaterial,
  loginRegisterDevice,
  exchangeProofAccessToken,
  hotProfile,
  listSessionsWithProof,
  revokeSessionWithProof,
} from './lib/deviceProof.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const baseUrl = process.env.CAPACITY_BASE_URL || 'http://127.0.0.1:18080';
const origin = process.env.CAPACITY_ORIGIN || baseUrl;
const email = process.env.CAPACITY_EMAIL || process.env.AUTH_E2E_EMAIL || 'pop-e2e@earflow.test';
const password = process.env.CAPACITY_PASSWORD || process.env.AUTH_E2E_PASSWORD || 'PopE2eTest1';
const outFile =
  process.env.CAPACITY_REVOKE_SUMMARY ||
  path.join(ROOT, 'artifacts/auth-capacity/revoke-latency-summary.json');
const pollMs = Number(process.env.CAPACITY_REVOKE_POLL_MS || 100);
const timeoutMs = Number(process.env.CAPACITY_REVOKE_TIMEOUT_MS || 5000);

async function createSession() {
  const material = await generateDeviceMaterial();
  const { jar, sid } = await loginRegisterDevice({
    baseUrl,
    origin,
    email,
    password,
    material,
  });
  const tokenInfo = await exchangeProofAccessToken({ baseUrl, origin, jar, material });
  return { jar, material, sid, token: tokenInfo.token };
}

async function main() {
  console.log('revoke latency: bootstrap victim + revoker sessions...');
  const victim = await createSession();
  const revoker = await createSession();

  console.log(`revoke victim sid=${victim.sid.slice(0, 12)}...`);
  const list = await listSessionsWithProof({
    baseUrl,
    origin,
    jar: revoker.jar,
    material: revoker.material,
  });
  const listed = (list.data?.sessions || []).map((s) => s.sid).filter(Boolean);
  if (!listed.includes(victim.sid)) {
    throw new Error(
      `victim_sid_not_listed (listed=${listed.length}) — run revoke before bootstrap pool or cleanup stale sessions`,
    );
  }

  const revokeStart = performance.now();
  const revoke = await revokeSessionWithProof({
    baseUrl,
    origin,
    jar: revoker.jar,
    material: revoker.material,
    targetSid: victim.sid,
  });
  if (revoke.status !== 200 && revoke.status !== 204) {
    const code = revoke.data?.code || revoke.data?.error || '';
    throw new Error(`revoke_failed_${revoke.status}_${code}`);
  }

  const samples = [];
  let first401Ms = null;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const sampleStart = performance.now();
    const resp = await hotProfile({
      baseUrl,
      origin,
      jar: victim.jar,
      material: victim.material,
      token: victim.token,
    });
    const elapsed = performance.now() - revokeStart;
    samples.push({ status: resp.status, elapsedMs: elapsed });
    if (resp.status === 401) {
      first401Ms = elapsed;
      break;
    }
    const wait = pollMs - (performance.now() - sampleStart);
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  const sorted = [...samples.map((s) => s.elapsedMs)].sort((a, b) => a - b);
  const pct = (p) => {
    if (!sorted.length) return null;
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  };

  const pass = first401Ms != null && first401Ms <= 2000;
  const summary = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    revokeStatus: revoke.status,
    first401Ms,
    p50Ms: pct(50),
    p95Ms: pct(95),
    p99Ms: pct(99),
    maxMs: sorted.length ? sorted[sorted.length - 1] : null,
    pass,
    targetMs: 2000,
    pollMs,
    timeoutMs,
    samples: samples.length,
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(
    `revoke → 401: ${first401Ms != null ? `${first401Ms.toFixed(0)}ms` : 'TIMEOUT'} ` +
      `(target ≤2000ms) → ${pass ? 'PASS' : 'FAIL'}`,
  );
  if (!pass) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
