#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const FRONTEND_SRC = path.join(ROOT, 'frontend', 'src');

const APPROVED_CAPTURE_FILES = new Set([
  path.normalize('frontend/src/gestures/usePointerGestureMachine.js'),
  path.normalize('frontend/src/components/hooks/usePointerSeek.js'),
  path.normalize('frontend/src/components/PlaylistSection/hooks/usePointerDragScroll.js'),
  path.normalize('frontend/src/components/BottomSheet.js'),
  path.normalize('frontend/src/components/MobilePlayerBar.js'),
  path.normalize('frontend/src/components/MobilePlayerModal.js'),
  path.normalize('frontend/src/components/PlaylistPage.js'),
]);

const APPROVED_TOUCH_NONE_FILES = new Set([
  path.normalize('frontend/src/components/BottomSheet.js'),
  path.normalize('frontend/src/components/GlobalPlayerBar.styles.js'),
  path.normalize('frontend/src/components/MobilePlayerBar.js'),
  path.normalize('frontend/src/components/MobilePlayerModal.styles.js'),
  path.normalize('frontend/src/components/Party/PartyDrawer/PartyDrawer.styles.js'),
  path.normalize('frontend/src/components/PlaylistPage.js'),
]);

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'build') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
      continue;
    }
    if (/\.(test|spec)\.(js|jsx|ts|tsx)$/.test(entry.name)) continue;
    if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

function relative(file) {
  return path.normalize(path.relative(ROOT, file));
}

const violations = [];

for (const file of walk(FRONTEND_SRC)) {
  const rel = relative(file);
  const text = fs.readFileSync(file, 'utf8');
  if (text.includes('setPointerCapture') && !APPROVED_CAPTURE_FILES.has(rel)) {
    violations.push(`${rel}: setPointerCapture must go through gesture runtime or an approved low-level owner.`);
  }
  if (/touch-action\s*:\s*none/.test(text) && !APPROVED_TOUCH_NONE_FILES.has(rel)) {
    violations.push(`${rel}: touch-action:none requires an approved gesture surface.`);
  }
}

if (violations.length > 0) {
  console.error('Gesture policy violations:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log('Gesture policy check passed.');
