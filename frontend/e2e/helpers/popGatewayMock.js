/**
 * Playwright mock gateway: enforces PoP on /api/profile like production middleware.
 * Cookie mp_sid without X-Auth-Device-* → 401 DEVICE_PROOF_REQUIRED.
 */

const DEFAULT_USER = { id: 901, userId: 901, username: 'e2e-pop-user' };

const json = (data, status = 200, extraHeaders = {}) => ({
  status,
  contentType: 'application/json',
  headers: extraHeaders,
  body: JSON.stringify(data),
});

function requestHasSessionCookie(request) {
  const cookie = String(request.headers().cookie || '');
  return /(?:^|;\s*)mp_sid=/.test(cookie);
}

function requestHasDeviceProof(request) {
  const h = request.headers();
  return !!(
    String(h['x-auth-device-id'] || '').trim()
    && String(h['x-auth-device-proof'] || '').trim()
    && String(h['x-auth-device-proof-ts'] || '').trim()
    && String(h['x-auth-device-proof-nonce'] || '').trim()
  );
}

async function installPopGatewayRoutes(page, user = DEFAULT_USER) {
  await page.route('**/api/auth/csrf', async (route) => {
    await route.fulfill(json({ ok: true }, 204, {
      'Set-Cookie': 'mp_csrf=e2e-pop-csrf; Path=/; SameSite=Lax',
    }));
  });

  await page.route('**/api/auth/device/register', async (route) => {
    await route.fulfill(json({ ok: true, authDeviceId: 'adev_e2e_pop_device_00001', sidHash: 'e2e-sid-hash-mock' }));
  });

  const profileHandler = async (route) => {
    const req = route.request();
    const hasSid = requestHasSessionCookie(req);
    const hasProof = requestHasDeviceProof(req);

    if (hasSid && !hasProof) {
      await route.fulfill(json({
        error: 'Device proof required',
        code: 'DEVICE_PROOF_REQUIRED',
        reauthRequired: true,
      }, 401));
      return;
    }
    if (hasSid && hasProof) {
      await route.fulfill(json(user));
      return;
    }
    await route.fulfill(json({
      error: 'Authentication required',
      code: 'NO_SESSION',
      reauthRequired: true,
    }, 401));
  };

  await page.route('**/api/profile', profileHandler);
  await page.route('**/api/auth/profile', profileHandler);
}

module.exports = {
  DEFAULT_USER,
  installPopGatewayRoutes,
  requestHasDeviceProof,
};
