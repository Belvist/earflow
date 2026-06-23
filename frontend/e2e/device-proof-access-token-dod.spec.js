/**
 * PEND-SEC-013 browser DoD — 8/8 checks (full-stack, no mock).
 * Requires auth-e2e stack — see docs/AUTH_ROLLOUT_GATES.md.
 */
const { test, expect, chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const DOD_BRIDGE = fs.readFileSync(
  path.join(__dirname, 'helpers', 'proofAccessTokenDod.browser.js'),
  'utf8',
);

const EMAIL = process.env.AUTH_E2E_EMAIL || '';
const PASSWORD = process.env.AUTH_E2E_PASSWORD || '';
const TTL_MIN = Number(process.env.AUTH_E2E_PROOF_TTL_MIN || 30);
const TTL_MAX = Number(process.env.AUTH_E2E_PROOF_TTL_MAX || 95);
const TTL_WAIT_MS = Number(process.env.AUTH_E2E_PROOF_TTL_WAIT_MS || (TTL_MIN + 2) * 1000);

async function readMpSidFromContext(context) {
  const cookies = await context.cookies();
  const sid = cookies.find((c) => c.name === 'mp_sid');
  return sid?.value || '';
}

test.describe('SEC-013 Proof Access Token browser DoD', () => {
  test.beforeAll(() => {
    if (!EMAIL || !PASSWORD) {
      throw new Error('AUTH_E2E_EMAIL and AUTH_E2E_PASSWORD must be set');
    }
  });

  test('8/8 — exchange, hot path, sensitive ECDSA, TTL, cross-device revoke', async () => {
    test.setTimeout(180_000);

    const browser = await chromium.launch();
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await pageA.addInitScript(DOD_BRIDGE);
    await pageA.goto('/');

    const setupA = await pageA.evaluate(
      async ({ email, password }) => window.__proofAccessTokenDod.loginRegisterDevice(email, password),
      { email: EMAIL, password: PASSWORD },
    );
    expect(setupA.ok, JSON.stringify(setupA)).toBe(true);

    // 1) POST /api/auth/proof/token → 200, expiresIn in range
    const exchange = await pageA.evaluate(async () => {
      const material = await window.__proofAccessTokenDod.loadMaterial();
      return window.__proofAccessTokenDod.exchangeProofAccessToken(material);
    });
    expect(exchange.status, JSON.stringify(exchange)).toBe(200);
    expect(exchange.hasToken).toBe(true);
    expect(exchange.expiresIn).toBeGreaterThanOrEqual(TTL_MIN - 5);
    expect(exchange.expiresIn).toBeLessThanOrEqual(TTL_MAX);

    const tokenA = exchange.token;

    // 2–3) Hot GET profile: proof access token, no device proof headers
    const hotA = await pageA.evaluate(async (token) => {
      const material = await window.__proofAccessTokenDod.loadMaterial();
      return window.__proofAccessTokenDod.hotProfileWithToken(material, token);
    }, tokenA);
    expect(hotA.status).toBe(200);
    expect(hotA.sentHeaders.hasProofAccessToken).toBe(true);
    expect(hotA.sentHeaders.hasDeviceProof).toBe(false);
    expect(hotA.sentHeaders.hasDeviceId).toBe(true);

    // 4) refresh: full ECDSA ok; token-only → 401
    const refreshProof = await pageA.evaluate(async () => {
      const material = await window.__proofAccessTokenDod.loadMaterial();
      return window.__proofAccessTokenDod.refreshWithFullProof(material);
    });
    expect([200, 204]).toContain(refreshProof.status);

    const refreshTokenOnly = await pageA.evaluate(async (token) => {
      const material = await window.__proofAccessTokenDod.loadMaterial();
      return window.__proofAccessTokenDod.refreshTokenOnly(material, token);
    }, tokenA);
    expect(refreshTokenOnly.status).toBe(401);

    // 5) logout + sessions revoke: token-only → 401
    const logoutTokenOnly = await pageA.evaluate(async (token) => {
      const material = await window.__proofAccessTokenDod.loadMaterial();
      return window.__proofAccessTokenDod.logoutTokenOnly(material, token);
    }, tokenA);
    expect(logoutTokenOnly.status).toBe(401);

    // Device B — second session, same user
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await pageB.addInitScript(DOD_BRIDGE);
    await pageB.goto('/');

    const setupB = await pageB.evaluate(
      async ({ email, password }) => window.__proofAccessTokenDod.loginRegisterDevice(email, password),
      { email: EMAIL, password: PASSWORD },
    );
    expect(setupB.ok, JSON.stringify(setupB)).toBe(true);

    const sidB = await readMpSidFromContext(contextB);
    expect(sidB.length, 'mp_sid is httpOnly — read via Playwright cookies, not document.cookie').toBeGreaterThan(10);

    const exchangeB = await pageB.evaluate(async () => {
      const material = await window.__proofAccessTokenDod.loadMaterial();
      return window.__proofAccessTokenDod.exchangeProofAccessToken(material);
    });
    expect(exchangeB.status).toBe(200);
    const tokenB = exchangeB.token;

    const hotBBefore = await pageB.evaluate(async (token) => {
      const material = await window.__proofAccessTokenDod.loadMaterial();
      return window.__proofAccessTokenDod.hotProfileWithToken(material, token);
    }, tokenB);
    expect(hotBBefore.status).toBe(200);

    const revokeTokenOnly = await pageA.evaluate(async ({ token, sid }) => {
      const material = await window.__proofAccessTokenDod.loadMaterial();
      return window.__proofAccessTokenDod.revokeSessionTokenOnly(material, token, sid);
    }, { token: tokenA, sid: sidB });
    expect(revokeTokenOnly.status).toBe(401);

    // 8) A revokes B with full ECDSA → B hot GET 401 within 2s
    const revokeB = await pageA.evaluate(async (sid) => {
      const material = await window.__proofAccessTokenDod.loadMaterial();
      return window.__proofAccessTokenDod.revokeSessionWithProof(material, sid);
    }, sidB);
    expect(revokeB.status).toBe(200);

    const deadline = Date.now() + 2000;
    let hotBAfter = { status: 200 };
    while (Date.now() < deadline) {
      hotBAfter = await pageB.evaluate(async (token) => {
        const material = await window.__proofAccessTokenDod.loadMaterial();
        return window.__proofAccessTokenDod.hotProfileWithToken(material, token);
      }, tokenB);
      if (hotBAfter.status === 401) break;
      await pageB.waitForTimeout(200);
    }
    expect(hotBAfter.status).toBe(401);

    // 6) TTL — expired token → 401; new exchange succeeds
    await pageA.waitForTimeout(TTL_WAIT_MS);
    const hotExpired = await pageA.evaluate(async (token) => {
      const material = await window.__proofAccessTokenDod.loadMaterial();
      return window.__proofAccessTokenDod.hotProfileWithToken(material, token);
    }, tokenA);
    expect(hotExpired.status).toBe(401);

    const reExchange = await pageA.evaluate(async () => {
      const material = await window.__proofAccessTokenDod.loadMaterial();
      return window.__proofAccessTokenDod.exchangeProofAccessToken(material);
    });
    expect(reExchange.status).toBe(200);
    expect(reExchange.token).not.toBe(tokenA);

    await browser.close();
  });
});
