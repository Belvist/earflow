/**
 * Playwright config for PEND-SEC-001a: live gateway PoP harness e2e (not full docker stack).
 *
 * Starts pop-e2e-harness (real go-api-gateway auth stack + miniredis, isProduction=true).
 */
const path = require('path');
const { defineConfig } = require('@playwright/test');

const PORT = Number(process.env.POP_E2E_PORT || 39201);
const BASE_URL = process.env.POP_E2E_BASE_URL || `http://127.0.0.1:${PORT}`;
const gatewayDir = path.join(__dirname, '..', 'backend', 'go-api-gateway');

module.exports = defineConfig({
  testDir: './e2e',
  testMatch: 'device-proof-live-gateway.spec.js',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'go run -tags pop_e2e_harness ./cmd/pop-e2e-harness/main.go',
    cwd: gatewayDir,
    url: `${BASE_URL}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      POP_E2E_PORT: String(PORT),
    },
  },
});
