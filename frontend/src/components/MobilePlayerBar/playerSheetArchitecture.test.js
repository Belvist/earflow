/**
 * Architecture guard — static checks for mobile player sheet ownership (INV-SHEET-*).
 */
import fs from 'fs';
import path from 'path';

const barDir = path.join(__dirname);
const componentsDir = path.join(__dirname, '..');
const gesturesDir = path.join(__dirname, '..', '..', 'gestures');

function readRel(...segments) {
  return fs.readFileSync(path.join(...segments), 'utf8');
}

function fileExists(...segments) {
  return fs.existsSync(path.join(...segments));
}

const modalSrc = readRel(componentsDir, 'MobilePlayerModal.js');
const stateSrc = readRel(barDir, 'usePlayerSheetState.js');
const panSrc = readRel(barDir, 'useMiniPlayerPan.js');
const sessionSrc = readRel(barDir, 'useMiniPlayerGestureSession.js');
const bottomSheetSrc = readRel(componentsDir, 'BottomSheet.js');
const indexSrc = readRel(barDir, 'index.js');
const phaseSrc = readRel(barDir, 'playerSheetPhase.js');
const appSrc = readRel(componentsDir, '..', 'App.js');
const playerChromeSrc = readRel(componentsDir, 'PlayerChrome', 'index.js');
const scrollHandoffSrc = readRel(componentsDir, '..', 'utils', 'sheetScrollHandoff.js');

describe('player sheet architecture (INV-SHEET-*)', () => {
  it('INV-SHEET-010: legacy mini gesture stack removed', () => {
    expect(fileExists(barDir, 'useMiniPlayerGestureMachine.js')).toBe(false);
    expect(fileExists(barDir, 'useMiniPlayerGestures.js')).toBe(false);
    expect(fileExists(barDir, 'useMiniPlayerGestureCoordinator.js')).toBe(false);
    expect(fileExists(gesturesDir, 'useMiniPlayerGestureCaptureRouting.js')).toBe(false);
  });

  it('INV-SHEET-010: single pan controller owns mini pointer stream', () => {
    expect(sessionSrc).toContain('useMiniPlayerPan');
    expect(sessionSrc).not.toContain('useMiniPlayerGestureMachine');
    expect(sessionSrc).not.toContain('useMiniPlayerGestureCaptureRouting');
    expect(panSrc).toMatch(/document\.addEventListener\('pointerdown'/);
    expect(panSrc).toMatch(/document\.addEventListener\('pointermove'/);
    expect(panSrc).toMatch(/document\.addEventListener\('pointerup'/);
    expect(panSrc).toContain('classifyMiniBarSheetIntent');
    expect(indexSrc).not.toMatch(/onPointerDown=\{miniGestureHandlers/);
  });

  it('INV-SHEET-001/006: modal does not animate yMotion for dismiss', () => {
    expect(modalSrc).not.toMatch(/animate\s*\(\s*yMotion/);
    expect(modalSrc).not.toMatch(/animateDismissClose/);
    expect(modalSrc).toContain('useOwnedSheetDrag');
    expect(modalSrc).toContain('onSheetDragStart');
    expect(modalSrc).toContain('onSheetDragSettle');
  });

  it('INV-SHEET-003: modal overlay does not Framer-animate sheet y', () => {
    expect(modalSrc).toMatch(/animate=\{undefined\}/);
  });

  it('INV-SHEET-005: state owner exports anchor drag API', () => {
    expect(stateSrc).toContain('beginSheetDrag');
    expect(stateSrc).toContain('applySheetDragDelta');
    expect(stateSrc).toContain('applySheetDragStep');
    expect(stateSrc).toContain('beginExpandPan');
    expect(stateSrc).toMatch(/settleDrag[\s\S]{0,120}stopSnapAnimation/);
  });

  it('INV-SHEET-005: pan uses step moves + settle on pointerup only', () => {
    expect(panSrc).toContain('applySheetDragStep');
    expect(panSrc).toContain('settleDrag');
    expect(panSrc).not.toMatch(/if \(dy >= 0\)[\s\S]{0,120}settleDrag/);
    expect(panSrc).not.toMatch(/finally \{[\s\S]{0,200}settleDrag/);
  });

  it('gestures call sheet API only', () => {
    expect(panSrc).toContain('beginExpandPan');
    expect(panSrc).not.toMatch(/setSheetPosition/);
    expect(panSrc).not.toMatch(/sheet\.cancel\(\)/);
  });

  it('index wires modal to sheet owner', () => {
    expect(indexSrc).toContain('onSheetDragStart={sheet.beginSheetDrag}');
    expect(indexSrc).toContain('onSheetDragMove={sheet.applySheetDragDelta}');
    expect(indexSrc).toContain('onSheetDragSettle={sheet.settleDrag}');
  });

  it('INV-SHEET-008: player chrome mounted via body portal (L3)', () => {
    expect(appSrc).toContain('<PlayerChrome');
    expect(playerChromeSrc).toContain('PlayerChromePortal');
  });

  it('INV-SHEET-008: modal dismiss off while mini-originated drag', () => {
    expect(modalSrc).toMatch(/disabled:\s*draggingFromMini/);
    expect(modalSrc).toMatch(/useModalAlbumGestures/);
    expect(fileExists(componentsDir, 'MobilePlayerModal', 'useModalAlbumTrackSwipe.js')).toBe(false);
    expect(modalSrc).toMatch(/showPlayerControls/);
    expect(modalSrc).not.toMatch(/controlsOpacity/);
    expect(modalSrc).not.toMatch(/chromeSettled/);
    expect(modalSrc).toContain('ControlsDock');
    expect(modalSrc).not.toMatch(/ContentLayer[\s\S]{0,200}dismissGestureHandlers/);
    expect(modalSrc).toMatch(/headerDismissHandlers/);
    expect(indexSrc).toContain('draggingFromMini={sheet.draggingFromMini}');
    expect(modalSrc).toMatch(/pointerEvents:\s*draggingFromMini\s*\?\s*'none'/);
  });

  it('INV-SHEET-005: watchdog never settles mini drag while finger is down', () => {
    expect(stateSrc).toContain('getActiveMiniPanPointerId');
    expect(stateSrc).toContain('hasExclusiveMiniPointer');
  });

  it('INV-SHEET-011: explicit SNAPPING phase in sheet machine', () => {
    expect(phaseSrc).toContain("SNAPPING: 'snapping'");
    expect(stateSrc).toMatch(/PLAYER_SHEET_PHASE\.SNAPPING/);
    expect(stateSrc).toMatch(/setPhaseSafe\(PLAYER_SHEET_PHASE\.SNAPPING\)/);
    expect(stateSrc).not.toMatch(/snapToClosed[\s\S]{0,280}setPhaseSafe\(PLAYER_SHEET_PHASE\.CLOSED\)[\s\S]{0,80}runSnap/);
  });

  it('INV-GESTURE-012: BottomSheet uses arbiter-native drag (no Framer drag)', () => {
    expect(bottomSheetSrc).not.toMatch(/drag="y"/);
    expect(bottomSheetSrc).toContain('useSheetDragArbitration');
  });
});
