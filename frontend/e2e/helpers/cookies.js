/** Matches `CookieConsentBanner` STORAGE_KEY / writeConsent shape. */
const STORAGE_KEY = 'earflow_cookie_consent_v1';

async function seedCookieConsent(page) {
  await page.addInitScript((key) => {
    try {
      localStorage.setItem(key, JSON.stringify({ status: 'accepted', ts: Date.now() }));
    } catch {
      // ignore quota / private mode in e2e
    }
  }, STORAGE_KEY);
}

async function acceptCookiesIfVisible(page) {
  const accept = page.getByRole('button', { name: 'Принять' });
  if (!(await accept.isVisible({ timeout: 800 }).catch(() => false))) return;
  await accept.click({ force: true });
  await accept.waitFor({ state: 'hidden', timeout: 2_000 }).catch(() => undefined);
}

module.exports = { STORAGE_KEY, seedCookieConsent, acceptCookiesIfVisible };
