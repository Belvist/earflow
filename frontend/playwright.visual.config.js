/**
 * Visual / local e2e: видимый браузер, slowMo, скриншот + видео + trace на КАЖДЫЙ тест.
 *
 *   npm run test:e2e:visual          — walkthrough со скриншотами каждого шага
 *   npm run test:e2e:visual:player   — gestures + homepage suite
 *   npm run test:e2e:visual:open     — HTML-отчёт
 *
 * Артефакты: frontend/e2e/artifacts/
 * Manifest для AI: frontend/e2e/artifacts/visual-manifest.json
 */
const { defineConfig } = require('@playwright/test');
const baseConfig = require('./playwright.config');

const slowMo = Number(process.env.E2E_SLOW_MO || 220);

module.exports = defineConfig({
  ...baseConfig,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: 'e2e/artifacts/test-results',
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'e2e/artifacts/report' }],
    ['./e2e/reporters/visual-manifest-reporter.js', { outputFile: 'e2e/artifacts/visual-manifest.json' }],
  ],
  use: {
    ...baseConfig.use,
    headless: false,
    launchOptions: {
      slowMo,
    },
    screenshot: 'on',
    video: 'on',
    trace: 'on',
  },
});
