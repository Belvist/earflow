/**
 * Sheet phase machine — closed | dragging | snapping | open.
 *
 * Invariants (see usePlayerSheetState):
 * INV-SHEET-001 sheetDragY — sole Y driver (style.y on modal)
 * INV-SHEET-002 OPEN via finishOpen or runSnap onComplete only
 * INV-SHEET-003 modal — no Framer animate y
 * INV-SHEET-004 overlay chrome — no spring lag on sheetProgress
 * INV-SHEET-005 beginSheetDrag stops snap; applySheetDragDelta(anchor+dy)
 * INV-SHEET-006 modal dismiss — onSheetDragStart/Move/Settle only
 * INV-SHEET-007 mini ignores page scroll
 * INV-SHEET-008 portal L3 + dragSource + pointer-events + scroll handoff
 * INV-SHEET-011 SNAPPING — finger-up spring; explicit pointer-events / gesture rules
 *
 * Rule: .cursor/rules/earflow-player-sheet.mdc
 * Guard: playerSheetArchitecture.test.js + validate-ai-discipline.js
 */

export const PLAYER_SHEET_PHASE = Object.freeze({
  CLOSED: 'closed',
  DRAGGING: 'dragging',
  SNAPPING: 'snapping',
  OPEN: 'open',
});

export function isSheetSnapping(phase) {
  return phase === PLAYER_SHEET_PHASE.SNAPPING;
}

export function isSheetModalVisible(phase) {
  return (
    phase === PLAYER_SHEET_PHASE.DRAGGING
    || phase === PLAYER_SHEET_PHASE.SNAPPING
    || phase === PLAYER_SHEET_PHASE.OPEN
  );
}

export function isSheetDragging(phase) {
  return phase === PLAYER_SHEET_PHASE.DRAGGING;
}

export function isSheetOpen(phase) {
  return phase === PLAYER_SHEET_PHASE.OPEN;
}

/** Sheet accepts new drag (interrupt snap or continue finger drag). */
export function isSheetGestureActive(phase) {
  return isSheetDragging(phase) || isSheetSnapping(phase);
}
