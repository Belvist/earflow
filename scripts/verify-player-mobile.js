#!/usr/bin/env node
/**
 * Gate for mobile player sheet + accent backdrop changes.
 * Usage: node scripts/verify-player-mobile.js
 */
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'frontend');

const patterns = [
  'playerSheet',
  'gesture',
  'listenerCover',
  'playerSheetSettle',
  'playerSheetArchitecture',
  'sheetScrollHandoff',
].join('|');

function run(command, cwd) {
  console.log(`\n> ${command}\n`);
  const r = spawnSync(command, {
    cwd,
    stdio: 'inherit',
    shell: true,
  });
  return r.status === 0;
}

let ok = true;

const unitCmd = `npm run test:unit:ci -- --testPathPattern="${patterns}"`;
ok = run(unitCmd, frontend) && ok;

console.log('\n--- E2E gestures (playground, starts dev server if needed) ---\n');
const e2eEnv = 'npx cross-env CI=true REACT_APP_DEVICE_PROOF_REQUIRED=0';

ok = run(`${e2eEnv} npm run test:e2e:gestures`, frontend) && ok;

console.log('\n--- E2E homepage gestures (real /) ---\n');
ok = run(`${e2eEnv} npm run test:e2e:homepage`, frontend) && ok;

console.log('\n--- E2E modal surfaces (queue scroll handoff, lyrics gate) ---\n');
ok = run(`${e2eEnv} npx playwright test e2e/modal-surfaces.spec.js`, frontend) && ok;

console.log('\n--- E2E player gesture contract (album H/V, SNAPPING, chrome) ---\n');
ok = run(`${e2eEnv} npx playwright test e2e/player-gestures-contract.spec.js`, frontend) && ok;

console.log('\n--- E2E freeze regression (waveform seek + rapid mini L/R) ---\n');
ok = run(`${e2eEnv} npx playwright test e2e/gestures.freeze-regression.spec.js`, frontend) && ok;

console.log('\n--- E2E gesture stress (30 actions, stability) ---\n');
ok = run(`${e2eEnv} E2E_STRESS_ACTIONS=30 npx playwright test e2e/gestures.stress.spec.js`, frontend) && ok;

if (!ok) {
  console.error('\nverify-player-mobile: FAILED\n');
  process.exit(1);
}

console.log('\nverify-player-mobile: PASS (unit + e2e gestures + homepage + modal + freeze + stress)\n');
console.log('Manual: deploy frontend, open track, partial swipe + accent backdrop on earflow.ru/covers/\n');
