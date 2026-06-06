/**
 * PEND-SEC-001 full-stack auth PoP e2e.
 * Stack must be running (docker compose auth-e2e overlay). No webServer, no harness.
 */
const path = require('path');
const { defineConfig } = require('@playwright/test');

const BASE_URL = process.env.AUTH_E2E_BASE_URL || 'http://127.0.0.1:18080';

module.exports = defineConfig({
  testDir: './e2e',
  testMatch: 'device-proof-fullstack.spec.js',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'e2e/artifacts/auth-fullstack/report' }],
    ['json', { outputFile: 'e2e/artifacts/auth-fullstack/results.json' }],
  ],
  outputDir: 'e2e/artifacts/auth-fullstack/test-results',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
