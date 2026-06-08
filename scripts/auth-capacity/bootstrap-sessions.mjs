#!/usr/bin/env node
/**
 * PEND-SEC-CAPACITY-001 — bootstrap N auth sessions with proof tokens.
 * Usage: node scripts/auth-capacity/bootstrap-sessions.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateDeviceMaterial,
  loginRegisterDevice,
  exchangeProofAccessToken,
  serializeSession,
} from './lib/deviceProof.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const baseUrl = process.env.CAPACITY_BASE_URL || 'http://127.0.0.1:18080';
const origin = process.env.CAPACITY_ORIGIN || baseUrl;
const email = process.env.CAPACITY_EMAIL || process.env.AUTH_E2E_EMAIL || 'pop-e2e@earflow.test';
const password = process.env.CAPACITY_PASSWORD || process.env.AUTH_E2E_PASSWORD || 'PopE2eTest1';
const count = Math.max(1, Number(process.env.CAPACITY_SESSION_COUNT || 20));
const outDir = process.env.CAPACITY_ARTIFACT_DIR || path.join(ROOT, 'artifacts/auth-capacity');
const outFile = path.join(outDir, 'sessions.json');

async function bootstrapOne(index) {
  const material = await generateDeviceMaterial();
  const { jar, sid } = await loginRegisterDevice({
    baseUrl,
    origin,
    email,
    password,
    material,
  });
  const tokenInfo = await exchangeProofAccessToken({ baseUrl, origin, jar, material });
  return serializeSession({
    jar,
    material,
    token: tokenInfo.token,
    expiresIn: tokenInfo.expiresIn,
    sid,
  });
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const sessions = [];
  for (let i = 0; i < count; i += 1) {
    process.stdout.write(`bootstrap session ${i + 1}/${count}... `);
    try {
      const session = await bootstrapOne(i);
      sessions.push(session);
      console.log('ok');
    } catch (err) {
      console.log('FAIL');
      throw err;
    }
  }
  const payload = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    origin,
    email,
    sessionCount: sessions.length,
    sessions,
  };
  fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote ${sessions.length} sessions → ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
