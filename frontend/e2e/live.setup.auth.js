/**
 * Сохранить cookies/сессию после РУЧНОГО входа на https://earflow.ru
 *
 *   npm run test:e2e:live:login
 *
 * В открывшемся Chromium: войди (Telegram/пароль), дождись mini-player внизу.
 * Тест сам сохранит e2e/.auth/earflow-live.json для следующих прогонов.
 */
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const {
  AUTH_FILE,
  LIVE_HOME_PATH,
  SELECTORS,
  acceptCookiesIfVisible,
} = require('./helpers/liveSite');

const authDir = path.dirname(AUTH_FILE);

test.describe.configure({ mode: 'serial' });

test('manual login on earflow.ru → save storage state', async ({ page }) => {
  test.setTimeout(600_000);

  fs.mkdirSync(authDir, { recursive: true });

  await page.goto(LIVE_HOME_PATH, { waitUntil: 'domcontentloaded' });
  await acceptCookiesIfVisible(page);

  // eslint-disable-next-line no-console
  console.log('\n[LIVE LOGIN] Войди на earflow.ru в открытом окне. Ждём mini-player до 8 минут...\n');

  if (process.env.E2E_LIVE_PAUSE === '1') {
    await page.pause();
  }

  await expect(page.locator(SELECTORS.HOME_ROOT)).toBeVisible({ timeout: 120_000 });
  await expect(page.locator(SELECTORS.MINI_BAR)).toBeVisible({ timeout: 480_000 });

  await page.context().storageState({ path: AUTH_FILE });
  // eslint-disable-next-line no-console
  console.log(`\n[LIVE LOGIN] Сохранено: ${AUTH_FILE}\nТеперь: npm run test:e2e:live\n`);
});
