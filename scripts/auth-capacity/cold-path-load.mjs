#!/usr/bin/env node
/**
 * PEND-SEC-CAPACITY-001 — cold path load (proof/token + refresh with full ECDSA).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deserializeMaterial,
  exchangeProofAccessToken,
  parseCookieHeader,
  refreshWithFullProof,
} from './lib/deviceProof.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const sessionsFile =
  process.env.CAPACITY_SESSIONS_FILE ||
  path.join(ROOT, 'artifacts/auth-capacity/sessions.json');
const outFile =
  process.env.CAPACITY_COLD_SUMMARY ||
  path.join(ROOT, 'artifacts/auth-capacity/cold-path-summary.json');

const baseUrl = process.env.CAPACITY_BASE_URL || 'http://127.0.0.1:18080';
const origin = process.env.CAPACITY_ORIGIN || baseUrl;
const durationMs = Number(process.env.CAPACITY_COLD_DURATION_MS || 30000);
const concurrency = Number(process.env.CAPACITY_COLD_CONCURRENCY || 10);
const scenario = process.env.CAPACITY_COLD_SCENARIO || 'both'; // proof_token | refresh | both

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function runScenario(name, session) {
  const latencies = [];
  let errors = 0;
  let total = 0;
  const end = Date.now() + durationMs;
  const material = await deserializeMaterial(session);
  const jar = parseCookieHeader(session.cookieHeader);
  jar.mp_csrf = session.mpCsrf || jar.mp_csrf;

  async function worker() {
    while (Date.now() < end) {
      const start = performance.now();
      try {
        if (name === 'proof_token') {
          await exchangeProofAccessToken({ baseUrl, origin, jar, material });
        } else {
          await refreshWithFullProof({ baseUrl, origin, jar, material });
        }
        latencies.push(performance.now() - start);
      } catch {
        errors += 1;
      }
      total += 1;
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  latencies.sort((a, b) => a - b);
  return {
    scenario: name,
    durationMs,
    concurrency,
    total,
    errors,
    errorRate: total ? errors / total : 0,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    max: latencies.length ? latencies[latencies.length - 1] : 0,
    rps: total / (durationMs / 1000),
  };
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
  const sessions = raw.sessions || [];
  if (!sessions.length) {
    throw new Error('no sessions — run bootstrap-sessions.mjs first');
  }
  const session = sessions[0];
  const results = [];

  if (scenario === 'proof_token' || scenario === 'both') {
    console.log('cold path: POST /api/auth/proof/token (full ECDSA)...');
    results.push(await runScenario('proof_token', session));
  }
  if (scenario === 'refresh' || scenario === 'both') {
    console.log('cold path: POST /api/auth/refresh (full ECDSA)...');
    results.push(await runScenario('refresh', session));
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    results,
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(summary, null, 2)}\n`);
  for (const r of results) {
    console.log(
      `${r.scenario}: total=${r.total} err=${(r.errorRate * 100).toFixed(2)}% ` +
        `p95=${r.p95.toFixed(1)}ms rps=${r.rps.toFixed(1)}`,
    );
  }
  console.log(`Wrote ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
