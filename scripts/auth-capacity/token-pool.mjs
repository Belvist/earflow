#!/usr/bin/env node
/**
 * PEND-SEC-CAPACITY-001 — local HTTP sidecar: fresh proof tokens for k6 VUs.
 * GET /session/:idx → { cookieHeader, authDeviceId, proofToken }
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deserializeMaterial,
  exchangeProofAccessToken,
  parseCookieHeader,
} from './lib/deviceProof.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const port = Number(process.env.CAPACITY_TOKEN_POOL_PORT || 19876);
const sessionsFile =
  process.env.CAPACITY_SESSIONS_FILE ||
  path.join(ROOT, 'artifacts/auth-capacity/sessions.json');
const refreshMs = Number(process.env.CAPACITY_TOKEN_REFRESH_MS || 45000);
const baseUrl = process.env.CAPACITY_BASE_URL || 'http://127.0.0.1:18080';
const origin = process.env.CAPACITY_ORIGIN || baseUrl;

/** @type {{ sessions: any[], baseUrl: string, origin: string }} */
let state = { sessions: [], baseUrl, origin };
const refreshing = new Set();

function loadSessions() {
  if (!fs.existsSync(sessionsFile)) {
    throw new Error(`sessions file missing: ${sessionsFile} (run bootstrap-sessions.mjs first)`);
  }
  const raw = fs.readFileSync(sessionsFile, 'utf8');
  const parsed = JSON.parse(raw);
  state = {
    sessions: parsed.sessions || [],
    baseUrl: parsed.baseUrl || baseUrl,
    origin: parsed.origin || origin,
  };
  if (!state.sessions.length) {
    throw new Error(`sessions file has zero sessions: ${sessionsFile}`);
  }
}

async function refreshSession(idx) {
  if (refreshing.has(idx)) return;
  refreshing.add(idx);
  try {
    const session = state.sessions[idx];
    if (!session) return;
    const material = await deserializeMaterial(session);
    const jar = parseCookieHeader(session.cookieHeader);
    jar.mp_csrf = session.mpCsrf || jar.mp_csrf;
    const tokenInfo = await exchangeProofAccessToken({
      baseUrl: state.baseUrl,
      origin: state.origin,
      jar,
      material,
    });
    session.proofToken = tokenInfo.token;
    session.proofTokenExp = tokenInfo.exp;
    session.proofExpiresIn = tokenInfo.expiresIn;
    session.cookieHeader = Object.entries(jar)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  } finally {
    refreshing.delete(idx);
  }
}

async function ensureFresh(idx) {
  const session = state.sessions[idx];
  if (!session) return null;
  const now = Math.floor(Date.now() / 1000);
  if (!session.proofToken || session.proofTokenExp - now < 20) {
    await refreshSession(idx);
  }
  return session;
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(`${JSON.stringify(body)}\n`);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/health') {
      json(res, 200, { ok: true, sessions: state.sessions.length });
      return;
    }
    const match = req.url?.match(/^\/session\/(\d+)$/);
    if (match && req.method === 'GET') {
      const idx = Number(match[1]) % Math.max(1, state.sessions.length);
      const session = await ensureFresh(idx);
      if (!session) {
        json(res, 404, { error: 'session_not_found' });
        return;
      }
      json(res, 200, {
        index: idx,
        authDeviceId: session.authDeviceId,
        proofToken: session.proofToken,
        cookieHeader: session.cookieHeader,
      });
      return;
    }
    json(res, 404, { error: 'not_found' });
  } catch (err) {
    json(res, 500, { error: String(err?.message || err) });
  }
});

try {
  loadSessions();
} catch (err) {
  console.error(`token-pool startup failed: ${err.message}`);
  process.exit(1);
}
server.listen(port, '127.0.0.1', () => {
  console.log(`token-pool listening on http://127.0.0.1:${port} (${state.sessions.length} sessions)`);
});

setInterval(() => {
  loadSessions();
  for (let i = 0; i < state.sessions.length; i += 1) {
    const s = state.sessions[i];
    const now = Math.floor(Date.now() / 1000);
    if (!s?.proofToken || s.proofTokenExp - now < 30) {
      refreshSession(i).catch((err) => {
        console.error(`refresh session ${i} failed:`, err.message);
      });
    }
  }
}, refreshMs);

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
