/**
 * PEND-SEC-013 browser DoD Playwright config.
 */
const { defineConfig } = require('@playwright/test');

const BASE_URL = process.env.AUTH_E2E_BASE_URL || 'http://127.0.0.1:18080';

module.exports = defineConfig({
  testDir: './e2e',
  testMatch: 'device-proof-access-token-dod.spec.js',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'e2e/artifacts/auth-proof-token-dod/report' }],
    ['json', { outputFile: 'e2e/artifacts/auth-proof-token-dod/results.json' }],
  ],
  outputDir: 'e2e/artifacts/auth-proof-token-dod/test-results',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
