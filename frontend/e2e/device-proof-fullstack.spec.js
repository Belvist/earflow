/**
 * PEND-SEC-001: full-stack PoP e2e (docker compose + real login path).
 * Requires running stack — see docs/AUTH_FULLSTACK_E2E_RUNBOOK.md.
 * NOT the pop-e2e-harness (no seed-session, no /e2e/*).
 */
const { test, expect, chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const POP_BRIDGE = fs.readFileSync(
  path.join(__dirname, 'helpers', 'popFullStack.browser.js'),
  'utf8',
);

const EMAIL = process.env.AUTH_E2E_EMAIL || '';
const PASSWORD = process.env.AUTH_E2E_PASSWORD || '';

test.describe('PoP full-stack (docker compose, no mock)', () => {
  test.beforeAll(() => {
    if (!EMAIL || !PASSWORD) {
      throw new Error(
        'AUTH_E2E_EMAIL and AUTH_E2E_PASSWORD must be set (see docs/AUTH_FULLSTACK_E2E_RUNBOOK.md)',
      );
    }
  });

  test('login → device register → profile 200; cookie transplant 401; refresh 401', async () => {
    test.setTimeout(120_000);

    const browser = await chromium.launch();
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await pageA.addInitScript(POP_BRIDGE);

    await pageA.goto('/');

    const flowA = await pageA.evaluate(
      async ({ email, password }) => window.__popFullStack.loginRegisterDeviceProfile(email, password),
      { email: EMAIL, password: PASSWORD },
    );
    expect(flowA.ok, JSON.stringify(flowA)).toBe(true);
    expect(flowA.profile.status).toBe(200);
    expect(await pageA.evaluate(() => window.__popFullStack.hasIndexedDbDeviceKey())).toBe(true);

    const cookies = await contextA.cookies();

    const contextB = await browser.newContext();
    await contextB.addCookies(cookies);
    const pageB = await contextB.newPage();
    await pageB.addInitScript(POP_BRIDGE);
    await pageB.goto('/');

    expect(await pageB.evaluate(() => window.__popFullStack.hasIndexedDbDeviceKey())).toBe(false);

    const cookieOnlyB = await pageB.evaluate(() => window.__popFullStack.fetchProfileCookieOnly());
    expect(cookieOnlyB.status).toBe(401);
    expect(cookieOnlyB.code).toBe('DEVICE_PROOF_REQUIRED');

    const refreshB = await pageB.evaluate(() => window.__popFullStack.fetchRefreshCookieOnly());
    expect(refreshB.status).toBe(401);
    expect(refreshB.code).toBe('DEVICE_PROOF_REQUIRED');

    const stillA = await pageA.evaluate(() => window.__popFullStack.profileWithStoredKey());
    expect(stillA.status).toBe(200);

    await browser.close();
  });
});
