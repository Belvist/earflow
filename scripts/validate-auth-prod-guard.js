'use strict';

/**
 * PEND-SEC-000: CI guard — PoP bypass env vars must not appear in production deploy artifacts.
 * Dev/e2e configs (playwright, verify-player-mobile) are allowlisted.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

const ALLOWLIST = new Set([
  'frontend/playwright.config.js',
  'frontend/playwright.pop-live.config.js',
  'frontend/playwright.visual.config.js',
  'frontend/playwright.live.config.js',
  'frontend/e2e/device-proof-cookie-transplant.spec.js',
  'frontend/e2e/device-proof-live-gateway.spec.js',
  'frontend/e2e/helpers/popGatewayMock.js',
  'frontend/e2e/helpers/popLiveGateway.browser.js',
  'scripts/verify-player-mobile.js',
  'scripts/validate-auth-prod-guard.js',
  'docs/SECURITY_ROADMAP.md',
  'docs/AUTH_TARGET_ARCHITECTURE.md',
  'docs/DECISIONS.md',
  'docs/PENDING.md',
  'docs/ARCHITECTURE_INVARIANTS.md',
  'reports/SECURITY.md',
  'AGENTS.md',
  '.env.example',
]);

const PROD_SCAN_PATHS = [
  'docker-compose.yml',
  'docker-compose.prod.yml',
  'docker-compose.override.yml',
  'frontend/Dockerfile',
  'artist-frontend/Dockerfile',
  'backend/go-api-gateway/Dockerfile',
  'k8s',
  '.github/workflows',
];

const FORBIDDEN_PATTERNS = [
  {
    re: /ALLOW_COOKIE_AUTH_WITHOUT_PROOF\s*[:=]\s*["']?1["']?/,
    message: 'ALLOW_COOKIE_AUTH_WITHOUT_PROOF=1 forbidden in production deploy config',
  },
  {
    re: /REACT_APP_ALLOW_COOKIE_AUTH_WITHOUT_PROOF\s*[:=]\s*["']?1["']?/,
    message: 'REACT_APP_ALLOW_COOKIE_AUTH_WITHOUT_PROOF=1 forbidden in production frontend build/deploy',
  },
  {
    re: /REACT_APP_DEVICE_PROOF_REQUIRED\s*[:=]\s*["']?0["']?/,
    message: 'REACT_APP_DEVICE_PROOF_REQUIRED=0 forbidden in production frontend build/deploy',
  },
];

function toRel(filePath) {
  return path.relative(root, filePath).replace(/\\/g, '/');
}

function isAllowlisted(relPath) {
  if (ALLOWLIST.has(relPath)) return true;
  if (relPath.startsWith('docs/') || relPath.startsWith('reports/')) return true;
  return false;
}

function walk(dirPath, files = []) {
  if (!fs.existsSync(dirPath)) return files;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      walk(full, files);
      continue;
    }
    if (entry.isFile()) files.push(full);
  }
  return files;
}

function collectProdFiles() {
  const files = [];
  for (const rel of PROD_SCAN_PATHS) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    if (fs.statSync(abs).isDirectory()) {
      files.push(...walk(abs));
    } else {
      files.push(abs);
    }
  }
  return files;
}

function runAuthProdGuard() {
  const errors = [];

  const harnessGo = path.join(root, 'backend/go-api-gateway/internal/auth/pop_e2e_harness.go');
  if (fs.existsSync(harnessGo)) {
    const content = fs.readFileSync(harnessGo, 'utf8');
    if (!content.startsWith('//go:build pop_e2e_harness')) {
      errors.push('backend/go-api-gateway/internal/auth/pop_e2e_harness.go must use //go:build pop_e2e_harness');
    }
  }
  const harnessMain = path.join(root, 'backend/go-api-gateway/cmd/pop-e2e-harness/main.go');
  if (fs.existsSync(harnessMain)) {
    const mainContent = fs.readFileSync(harnessMain, 'utf8');
    if (!mainContent.startsWith('//go:build pop_e2e_harness')) {
      errors.push('backend/go-api-gateway/cmd/pop-e2e-harness/main.go must use //go:build pop_e2e_harness');
    }
  }

  for (const filePath of collectProdFiles()) {
    const relPath = toRel(filePath);
    const ext = path.extname(relPath).toLowerCase();
    if (!['.yml', '.yaml', '.env', '.example', ''].includes(ext) && !relPath.endsWith('Dockerfile')) {
      if (!relPath.includes('workflows')) continue;
    }
    if (isAllowlisted(relPath)) continue;
    const content = fs.readFileSync(filePath, 'utf8');
    for (const { re, message } of FORBIDDEN_PATTERNS) {
      if (re.test(content)) {
        errors.push(`${relPath}: ${message}`);
      }
    }
  }

  return errors;
}

function main() {
  const errors = runAuthProdGuard();
  if (errors.length) {
    console.error('validate-auth-prod-guard: FAILED\n');
    for (const err of errors) console.error(`  - ${err}`);
    process.exit(1);
  }
  console.log('validate-auth-prod-guard: OK');
}

module.exports = { runAuthProdGuard };

if (require.main === module) {
  main();
}
