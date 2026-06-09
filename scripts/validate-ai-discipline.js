'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const strict = process.argv.includes('--strict');
const errors = [];
const warnings = [];
const SELF = 'scripts/validate-ai-discipline.js';

const LEGACY_MINI_GESTURE_FILES = [
  'frontend/src/components/MobilePlayerBar/useMiniPlayerGestureMachine.js',
  'frontend/src/components/MobilePlayerBar/useMiniPlayerGestures.js',
  'frontend/src/components/MobilePlayerBar/useMiniPlayerGestureCoordinator.js',
  'frontend/src/gestures/useMiniPlayerGestureCaptureRouting.js',
];

const TEXT_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.go', '.sql', '.yml', '.yaml', '.json', '.md', '.mdc', '.sh', '.ps1', '.css', '.html', '.conf', '.toml', '.env', '.example', '.txt'
]);

const CODE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.go', '.sql', '.yml', '.yaml']);
const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', 'certbot', 'backups', 'dist', 'build', 'coverage']);

function toRel(filePath) {
  return path.relative(root, filePath).replace(/\\/g, '/');
}

function exists(relPath) {
  return fs.existsSync(path.join(root, relPath));
}

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function addError(relPath, message) {
  errors.push({ relPath, message });
}

function addWarning(relPath, message) {
  warnings.push({ relPath, message });
}

function assertFile(relPath) {
  if (!exists(relPath)) addError(relPath, 'required file is missing');
}

function assertContains(relPath, pattern, message) {
  if (!exists(relPath)) return;
  const content = read(relPath);
  const ok = typeof pattern === 'string' ? content.includes(pattern) : pattern.test(content);
  if (!ok) addError(relPath, message);
}

function walk(dirPath, files = []) {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dirPath, entry.name), files);
      continue;
    }
    if (!entry.isFile()) continue;
    const filePath = path.join(dirPath, entry.name);
    const ext = path.extname(entry.name).toLowerCase();
    if (TEXT_EXTENSIONS.has(ext) || entry.name.endsWith('.env.example')) files.push(filePath);
  }
  return files;
}

function isCodeFile(filePath) {
  return CODE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function scanPlayerSheetArchitecture(filePath, content) {
  const relPath = toRel(filePath);
  if (relPath.endsWith('playerSheetArchitecture.test.js')) return;
  const playerSheetArea =
    relPath.startsWith('frontend/src/components/MobilePlayerBar/')
    || relPath.startsWith('frontend/src/components/MobilePlayerModal');

  if (!playerSheetArea && relPath !== 'frontend/src/utils/playerSheetPhysics.js') return;

  if (relPath === 'frontend/src/components/MobilePlayerModal.js') {
    if (/animate\s*\(\s*yMotion/.test(content)) {
      addError(relPath, 'INV-SHEET-006: modal must not animate(yMotion); use onSheetDragSettle');
    }
    if (/animateDismissClose|animateDismissBack/.test(content)) {
      addError(relPath, 'INV-SHEET-006: legacy modal dismiss animators forbidden');
    }
    if (!content.includes('useOwnedSheetDrag')) {
      addError(relPath, 'MobilePlayerModal must wire owned sheet drag (useOwnedSheetDrag)');
    }
    if (/!sheetFullyOpen\)\s*return\s*true/.test(content)) {
      addError(relPath, 'INV-SHEET-005: dismiss must work during snap-open, not only when sheetFullyOpen');
    }
  }

  if (relPath === 'frontend/src/components/MobilePlayerBar/usePlayerSheetState.js') {
    if (!content.includes('beginSheetDrag')) {
      addError(relPath, 'usePlayerSheetState must export beginSheetDrag (INV-SHEET-005)');
    }
    if (!content.includes('applySheetDragDelta')) {
      addError(relPath, 'usePlayerSheetState must export applySheetDragDelta (INV-SHEET-005)');
    }
    if (/\bapplyDragOffset\b/.test(content)) {
      addError(relPath, 'use applySheetDragDelta (anchor-based drag), not applyDragOffset');
    }
    if (!/miniBarPointerEvents:\s*sheetOpen\s*\|\|\s*\(modalVisible\s*&&\s*!draggingFromMini\)/.test(content)) {
      addError(relPath, 'INV-SHEET-008: miniBarPointerEvents must be none when sheetOpen || (modalVisible && !draggingFromMini)');
    }
    if (!/dragSourceRef/.test(content)) {
      addError(relPath, 'INV-SHEET-008: sheet drag must track source (mini vs modal)');
    }
  }

  if (relPath === 'frontend/src/App.js') {
    if (/<MobilePlayerBar[\s\S]{0,80}onOpenEq/.test(content) && !/<PlayerChrome/.test(content)) {
      addError(relPath, 'INV-SHEET-008: mobile player must mount via PlayerChrome portal, not inline MobilePlayerBar');
    }
  }

  if (relPath === 'frontend/src/playground/MobilePlayerPlayground.js') {
    if (/<MobilePlayerBar/.test(content) && !/<PlayerChrome/.test(content)) {
      addError(relPath, 'INV-SHEET-008: playground must use PlayerChrome (same L3 as prod)');
    }
  }

  if (relPath === 'frontend/src/components/MobilePlayerModal.js') {
    if (!content.includes('canSheetDragDismissFromTarget')) {
      addError(relPath, 'INV-SHEET-008: modal dismiss must use sheetScrollHandoff (scrollTop gate)');
    }
  }

  if (relPath === 'frontend/src/components/MobilePlayerBar/useMiniPlayerPan.js') {
    if (/\bsetSheetPosition\b/.test(content)) {
      addError(relPath, 'INV-SHEET-010: pan must not call setSheetPosition; use usePlayerSheetState API');
    }
    if (!content.includes('beginExpandPan')) {
      addError(relPath, 'INV-SHEET-010: pan must call beginExpandPan for vertical expand');
    }
    if (!content.includes('applySheetDragStep')) {
      addError(relPath, 'INV-SHEET-010: pan must use applySheetDragStep during expand drag');
    }
    if (!/document\.addEventListener\('pointerdown'/.test(content)) {
      addError(relPath, 'INV-SHEET-010: pan must capture pointerdown on document (rail steal)');
    }
    if (!/document\.addEventListener\('pointermove'/.test(content)) {
      addError(relPath, 'INV-SHEET-010: pan must listen pointermove on document (capture) until release');
    }
    if (/if \(dy >= 0\)[\s\S]{0,120}settleDrag/.test(content)) {
      addError(relPath, 'INV-SHEET-010: mid-drag settle on dy>=0 forbidden; settle only on pointerup');
    }
  }

  if (relPath === 'frontend/src/components/MobilePlayerBar/index.js') {
    if (/onPointerDown=\{/.test(content) && /<MiniPlayerShell/.test(content)) {
      addError(relPath, 'INV-SHEET-010: MiniPlayerShell must not use React pointer handlers; use useMiniPlayerPan');
    }
  }

  if (relPath === 'frontend/src/components/MobilePlayerBar/useMiniPlayerGestureSession.js') {
    if (/useMiniPlayerGestureMachine|useMiniPlayerGestureCaptureRouting|useMiniPlayerGestures/.test(content)) {
      addError(relPath, 'INV-SHEET-010: session must wire useMiniPlayerPan only');
    }
  }

  if (relPath === 'frontend/src/gestures/gestureProfiles.js') {
    if (/MINI_PLAYER_OPEN[\s\S]{0,200}classifyMiniPlayerOpenIntent\(input\)/.test(content)) {
      addError(relPath, 'INV-SHEET-007: MINI_PLAYER_OPEN must use classifyMiniBarSheetIntent');
    }
  }

  if (playerSheetArea) {
    if (/playerSheetController/.test(content)) {
      addError(relPath, 'playerSheetController removed; use usePlayerSheetState');
    }
    if (/blurredBackdropCache|blurCoverBackdrop|usePlayerBackdropPhase|useBlurredBackdropUrl/.test(content)) {
      addError(relPath, 'canvas blur backdrop removed; use PlayerBackdrop accent fill');
    }
  }
}

function scanCodeFile(filePath, content) {
  const relPath = toRel(filePath);
  if (relPath === SELF) return;

  if (/\b(?:TODO|FIXME)\b/.test(content)) {
    addError(relPath, 'TODO/FIXME in code is forbidden; record known gaps in docs/PENDING.md');
  }

  if (/localStorage\.setItem\(\s*['"`](?:token|jwt|accessToken|refreshToken|authToken)/i.test(content)) {
    addError(relPath, 'frontend must not persist auth tokens in localStorage');
  }

  if (/transferTo\s*\(\s*self\b/.test(content) || /transferTo\(self\)/.test(content)) {
    addError(relPath, 'frontend self-transfer before play is forbidden; use cmd:play intent');
  }

  if (relPath === 'frontend/src/hooks/useDeviceSync.js') {
    const forbidden = [
      ['isStaleActiveRevision', 'frontend stale active revision filtering is forbidden'],
      ['isStaleNowPlayingState', 'frontend stale nowPlaying filtering is forbidden'],
      ["connectionState: 'standby'", 'REST standby state is forbidden; WebSocket opens after register'],
      ['STANDBY_LIST_POLL_MS', 'REST standby polling is forbidden'],
      ['isActive: d.id === activeId', 'local rebuild of devices[].isActive is forbidden'],
    ];
    for (const [needle, message] of forbidden) {
      if (content.includes(needle)) addError(relPath, message);
    }
  }

  if (relPath === 'frontend/src/components/DeviceSync/DeviceSyncProvider.js') {
    const forbidden = [
      ['ACTIVE_POSITION_PUBLISH_MS', 'periodic active position publish is forbidden'],
      ['AUTO_CLAIM_SUPPRESS_MS', 'frontend auto-claim suppression is forbidden'],
      ['claimInFlightRef', 'frontend ownership claim state is forbidden'],
      ['suppressAutoClaimUntilRef', 'frontend auto-claim state is forbidden'],
    ];
    for (const [needle, message] of forbidden) {
      if (content.includes(needle)) addError(relPath, message);
    }
    if (/setInterval[\s\S]{0,240}publishNowPlayingIfDue/.test(content)) {
      addError(relPath, 'periodic nowPlaying publish loop is forbidden');
    }
  }
}

function scanRootMarkdown() {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith('.md')) continue;
    if (entry.name !== 'AGENTS.md') {
      addWarning(entry.name, 'root markdown should live in docs/, reports/, or backend/<service>/CONTEXT.md');
    }
  }
}

function scanServiceContexts() {
  const backendDir = path.join(root, 'backend');
  if (!fs.existsSync(backendDir)) return;
  for (const entry of fs.readdirSync(backendDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const relDir = `backend/${entry.name}`;
    const serviceDir = path.join(backendDir, entry.name);
    const hasServiceMarker = ['package.json', 'go.mod', 'requirements.txt', 'server.js'].some((marker) => fs.existsSync(path.join(serviceDir, marker)));
    if (hasServiceMarker && !fs.existsSync(path.join(serviceDir, 'CONTEXT.md'))) {
      addWarning(relDir, 'service has no CONTEXT.md; create one when this service is touched');
    }
  }
}

function scanEscapeHatchPatterns(filePath, content) {
  const relPath = toRel(filePath);
  if (relPath === SELF) return;

  const isApplyToDom =
    /function\s+apply\w+ToDom\b/.test(content) || /export\s+function\s+apply\w+ToDom\b/.test(content);
  if (!isApplyToDom) return;

  const pending = read('docs/PENDING.md');
  const fnMatch = content.match(/function\s+(apply\w+ToDom)\b/) || content.match(/export\s+function\s+(apply\w+ToDom)\b/);
  const fnName = fnMatch ? fnMatch[1] : 'apply*ToDom';
  addError(
    relPath,
    `${fnName} is forbidden imperative DOM paint for UI prefs (INV-FE-007); use external store + React + :root dataset CSS`
  );
}

function assertLegacyMiniGestureStackRemoved() {
  LEGACY_MINI_GESTURE_FILES.forEach((relPath) => {
    if (exists(relPath)) {
      addError(relPath, 'INV-SHEET-010: legacy mini gesture file must stay deleted');
    }
  });
}

function main() {
  [
    'AGENTS.md',
    'docs/ARCHITECTURE_INVARIANTS.md',
    'docs/DECISIONS.md',
    'docs/PENDING.md',
    'docs/SERVICE_CONTEXT_TEMPLATE.md',
    '.windsurf/workflows/load-context.md',
    '.windsurf/rules/earflow-context-discipline.mdc',
    '.cursor/rules/earflow-context-discipline.mdc',
    '.cursor/rules/earflow-ui-client-prefs.mdc',
    '.cursor/rules/earflow-frontend-branch.mdc',
    'docs/MOBILE_PLAYER_SHEET_DESIGN.md',
    '.cursor/skills/earflow-player-sheet/SKILL.md',
    '.cursor/skills/engineering-verification/SKILL.md',
    'docs/ENGINEERING_VERIFICATION_PLAYBOOK.md',
    '.cursor/rules/earflow-player-sheet.mdc',
    '.windsurf/rules/earflow-ui-client-prefs.mdc',
    '.windsurf/rules/earflow-player-sheet.mdc',
  ].forEach(assertFile);

  assertContains('AGENTS.md', 'docs/DECISIONS.md', 'AGENTS.md must point agents to docs/DECISIONS.md');
  assertContains('AGENTS.md', 'ENGINEERING_VERIFICATION_PLAYBOOK.md', 'AGENTS.md must point agents to engineering verification playbook');
  assertContains('AGENTS.md', 'engineering-verification', 'AGENTS.md must reference engineering-verification skill');
  assertContains('AGENTS.md', 'earflow-ui-client-prefs.mdc', 'AGENTS.md must point agents to earflow-ui-client-prefs rule');
  assertContains('.windsurf/rules/earflow-context-discipline.mdc', 'alwaysApply: true', 'Windsurf discipline rule must always apply');
  assertContains('.cursor/rules/earflow-context-discipline.mdc', 'alwaysApply: true', 'Cursor discipline rule must always apply');
  assertContains('.cursor/rules/earflow-ui-client-prefs.mdc', 'alwaysApply: true', 'Cursor UI prefs / escape hatch rule must always apply');
  assertContains('.cursor/rules/earflow-frontend-branch.mdc', 'alwaysApply: true', 'Cursor frontend branch rule must always apply');
  assertContains('.cursor/rules/earflow-frontend-branch.mdc', 'git push origin main:frontend', 'Frontend branch rule must document main→frontend sync');
  assertContains('.windsurf/rules/earflow-ui-client-prefs.mdc', 'INV-ARCH-001', 'Windsurf UI prefs rule must reference INV-ARCH-001');
  assertContains('docs/ARCHITECTURE_INVARIANTS.md', 'INV-DS-001', 'DeviceSync backend-authority invariant is missing');
  assertContains('docs/ARCHITECTURE_INVARIANTS.md', 'INV-ARCH-001', 'Cross-cutting escape-hatch invariant is missing');
  assertContains('docs/ARCHITECTURE_INVARIANTS.md', 'INV-SHEET-001', 'Player sheet Y-owner invariant is missing');
  assertContains('docs/ARCHITECTURE_INVARIANTS.md', 'INV-SHEET-006', 'Player sheet dismiss API invariant is missing');
  assertContains('docs/ARCHITECTURE_INVARIANTS.md', 'INV-SHEET-008', 'Player sheet portal/pointer-events invariant is missing');
  assertContains('docs/ARCHITECTURE_INVARIANTS.md', 'INV-SHEET-010', 'Player sheet single pan controller invariant is missing');
  assertContains('docs/ARCHITECTURE_INVARIANTS.md', 'INV-FE-008', 'AI user-disclosure invariant is missing');
  assertContains('AGENTS.md', 'INV-SHEET-010', 'AGENTS.md must reference mini pan rewrite invariant');
  assertContains('AGENTS.md', 'useMiniPlayerPan', 'AGENTS.md must reference useMiniPlayerPan as mini gesture owner');
  assertContains('AGENTS.md', 'MOBILE_PLAYER_SHEET_DESIGN.md', 'AGENTS.md must point to mobile player sheet design doc');
  assertContains('AGENTS.md', 'earflow-player-sheet.mdc', 'AGENTS.md must point agents to earflow-player-sheet rule');
  assertContains('docs/DECISIONS.md', 'Frontend authority в DeviceSync', 'historical DeviceSync anti-pattern decision is missing');
  assertContains('docs/DECISIONS.md', 'AI escape-hatch discipline', 'escape-hatch discipline decision is missing');
  assertContains('docs/PENDING.md', 'PEND-DS-001', 'DeviceSync Stage 2 pending item is missing');

  assertLegacyMiniGestureStackRemoved();

  const { runAuthProdGuard } = require('./validate-auth-prod-guard.js');
  for (const message of runAuthProdGuard()) {
    addError('scripts/validate-auth-prod-guard.js', message);
  }

  for (const filePath of walk(root)) {
    const content = fs.readFileSync(filePath, 'utf8');
    if (!isCodeFile(filePath)) continue;
    scanCodeFile(filePath, content);
    scanPlayerSheetArchitecture(filePath, content);
    scanEscapeHatchPatterns(filePath, content);
  }

  scanRootMarkdown();
  scanServiceContexts();

  for (const item of errors) {
    console.error(`[ai-discipline:error] ${item.relPath}: ${item.message}`);
  }
  for (const item of warnings) {
    console.warn(`[ai-discipline:warn] ${item.relPath}: ${item.message}`);
  }

  if (errors.length > 0 || (strict && warnings.length > 0)) {
    console.error(`[ai-discipline] failed: ${errors.length} error(s), ${warnings.length} warning(s)`);
    process.exit(1);
  }

  console.log(`[ai-discipline] ok: ${errors.length} error(s), ${warnings.length} warning(s)`);
}

main();
