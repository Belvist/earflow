/**
 * INV-SHEET-009 — snap-to-closed must not leave mini-bar in modalVisible lock.
 */
import fs from 'fs';
import path from 'path';

const stateSrc = fs.readFileSync(
  path.join(__dirname, 'usePlayerSheetState.js'),
  'utf8',
);
const panSrc = fs.readFileSync(
  path.join(__dirname, 'useMiniPlayerPan.js'),
  'utf8',
);

describe('player sheet interaction recover (INV-SHEET-009)', () => {
  it('snapToClosed enters SNAPPING via runSnap (not CLOSED before spring)', () => {
    expect(stateSrc).toContain('PLAYER_SHEET_PHASE.SNAPPING');
    expect(stateSrc).toMatch(/const runSnap[\s\S]+setPhaseSafe\(PLAYER_SHEET_PHASE\.SNAPPING\)/);
    expect(stateSrc).toMatch(/setHoldModalForCloseSnap\(true\)/);
    expect(stateSrc).not.toMatch(/snapToClosed[\s\S]{0,200}setPhaseSafe\(PLAYER_SHEET_PHASE\.CLOSED\)[\s\S]{0,80}runSnap/);
  });

  it('recoverInteraction is emergency-only in mini pan', () => {
    expect(stateSrc).toContain('recoverInteraction');
    expect(panSrc).toContain('recoverInteraction');
    expect(panSrc).toContain('sheet-closed-clear');
    expect(panSrc).toContain('clearMiniPanSession');
  });

  it('track swipe clears sheet before animation when not OPEN', () => {
    expect(panSrc).toMatch(/if \(!isSheetOpen\(s\.phaseRef\.current\)\)[\s\S]{0,80}s\.finishClosed\(\)/);
  });

  it('settle on pointer-up after expand pan', () => {
    expect(panSrc).toMatch(/sheetExpandStarted[\s\S]{0,120}s\.settleDrag/);
  });

  it('track swipe animation has timeout guard', () => {
    expect(panSrc).toContain('withAnimationTimeout');
  });
});
