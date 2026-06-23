/**
 * Playwright — живой сайт (https://earflow.ru), без локального dev server и без API-моков.
 *
 * 1) Один раз сохранить сессию после ручного входа:
 *    npm run test:e2e:live:login
 * 2) Прогнать жесты на домене (видно в окне браузера):
 *    npm run test:e2e:live
 */
const fs = require('fs');
const path = require('path');
const { defineConfig, devices } = require('@playwright/test');

const LIVE_URL = (process.env.E2E_LIVE_URL || 'https://earflow.ru').replace(/\/$/, '');
const AUTH_FILE = path.join(__dirname, 'e2e', '.auth', 'earflow-live.json');
const HAS_AUTH = fs.existsSync(AUTH_FILE);

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'e2e/report-live' }],
  ],
  use: {
    baseURL: LIVE_URL,
    trace: 'retain-on-failure',
    screenshot: 'on',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
    ignoreHTTPSErrors: false,
  },
  projects: [
    ...(HAS_AUTH
      ? []
      : [{
        name: 'setup',
        testMatch: /live\.setup\.auth\.js/,
        use: {
          ...devices['Pixel 7'],
          hasTouch: true,
          isMobile: true,
        },
      }]),
    {
      name: 'live',
      testMatch: /live-earflow-gestures\.spec\.js/,
      dependencies: HAS_AUTH ? [] : ['setup'],
      use: {
        ...devices['Pixel 7'],
        hasTouch: true,
        isMobile: true,
        /** Файл создаётся setup-проектом в том же прогоне или через test:e2e:live:login */
        storageState: AUTH_FILE,
      },
    },
  ],
});
