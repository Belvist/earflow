/**
 * Playwright config для e2e тестов жестов мобильного плеера.
 *
 * Запуск:
 *   1. npm run test:e2e:install   (один раз - скачать chromium)
 *   2. npm run test:e2e:gestures  (Playwright сам запустит dev server)
 *
 * Если dev server уже запущен (npm start) - Playwright reuse его.
 *
 * Тесты эмулируют iPhone 14 (touch, viewport, user-agent).
 */
const { defineConfig, devices } = require('@playwright/test');

const PORT = Number(process.env.E2E_PORT || 3000);
const BASE_URL = process.env.E2E_BASE_URL || `http://localhost:${PORT}`;

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e/report' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 5_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      /**
       * Pixel 7 - chromium-based mobile эмуляция (touch, mobile viewport).
       * Используем chromium вместо WebKit потому что:
       *   1) Chromium встроен в Playwright install по умолчанию
       *   2) PointerEvent API поведение совпадает с реальными Android/Chrome
       *   3) setPointerCapture работает идентично на iOS Safari (то что мы фиксили)
       * Если нужны iOS-specific тесты - запусти `npx playwright install webkit`
       * и добавь проект с device 'iPhone 14'.
       */
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 7'],
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
  /**
   * Playwright поднимает dev server сам если он не запущен.
   * reuseExistingServer: true - если ты уже запустил npm start в другом терминале,
   * Playwright использует существующий сервер вместо запуска нового.
   *
   * BROWSER=none не даёт CRA открыть отдельную вкладку в дефолтном браузере.
   */
  webServer: {
    command: process.platform === 'win32'
      ? 'cmd /c "set BROWSER=none&& set REACT_APP_DEVICE_PROOF_REQUIRED=0&& npm start"'
      : 'BROWSER=none REACT_APP_DEVICE_PROOF_REQUIRED=0 npm start',
    url: BASE_URL,
    /** CI always starts a fresh dev server; local runs may reuse `npm start`. */
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
