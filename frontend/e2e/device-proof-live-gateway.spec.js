/**
 * PEND-SEC-001a: PoP e2e against live gateway harness (pop-e2e-harness + miniredis).
 * No Playwright route mock — real SessionAuthMiddleware + DeviceProofMiddleware.
 */
const { test, expect, chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const POP_BRIDGE = fs.readFileSync(
  path.join(__dirname, 'helpers', 'popLiveGateway.browser.js'),
  'utf8',
);

test.describe('PoP live gateway (no mock)', () => {
  test('cookie transplant fails; proof path succeeds; refresh without proof fails', async () => {
    test.setTimeout(60_000);

    const browser = await chromium.launch();
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await pageA.addInitScript(POP_BRIDGE);

    await pageA.goto('/e2e/fixture.html');

    const flowA = await pageA.evaluate(async () => window.__pop.loginWithDeviceProof());
    expect(flowA.ok, JSON.stringify(flowA)).toBe(true);
    expect(flowA.profile.status).toBe(200);
    expect(await pageA.evaluate(() => window.__pop.hasIndexedDbDeviceKey())).toBe(true);

    const cookies = await contextA.cookies();

    const contextB = await browser.newContext();
    await contextB.addCookies(cookies);
    const pageB = await contextB.newPage();
    await pageB.addInitScript(POP_BRIDGE);
    await pageB.goto('/e2e/fixture.html');

    expect(await pageB.evaluate(() => window.__pop.hasIndexedDbDeviceKey())).toBe(false);

    const cookieOnlyB = await pageB.evaluate(() => window.__pop.fetchProfileCookieOnly());
    expect(cookieOnlyB.status).toBe(401);
    expect(cookieOnlyB.code).toBe('DEVICE_PROOF_REQUIRED');

    const refreshB = await pageB.evaluate(() => window.__pop.fetchRefreshCookieOnly());
    expect(refreshB.status).toBe(401);
    expect(refreshB.code).toBe('DEVICE_PROOF_REQUIRED');

    const stillA = await pageA.evaluate(() => window.__pop.profileWithStoredKey());
    expect(stillA.status).toBe(200);

    await browser.close();
  });
});
