/**
 * react-modal-sheet Sheet.Scroller pattern: dismiss drag only when scrollTop === 0.
 * INV-SHEET-008 (see docs/MOBILE_PLAYER_SHEET_DESIGN.md §5).
 */

const SCROLL_AREA_SELECTOR = '[data-queue-scrollarea], [data-sheet-scrollarea]';

export function getScrollTopFromGestureTarget(target) {
  if (typeof document === 'undefined') return 0;
  if (!target || !(target instanceof Element)) return 0;

  const scrollArea = target.closest(SCROLL_AREA_SELECTOR);
  if (!scrollArea) return 0;
  if (scrollArea.scrollHeight <= scrollArea.clientHeight + 1) return 0;

  return Math.max(0, Number(scrollArea.scrollTop) || 0);
}

/** True when vertical sheet dismiss may start (scroll at top). */
export function canSheetDragDismissFromTarget(target) {
  return getScrollTopFromGestureTarget(target) <= 0;
}

/** Queue panel open with list scrolled — block sheet dismiss from any touch (header included). */
export function isQueueScrollBlockingSheetDismiss() {
  if (typeof document === 'undefined') return false;
  const scrollArea = document.querySelector('[data-queue-scrollarea]');
  if (!scrollArea) return false;
  if (scrollArea.scrollHeight <= scrollArea.clientHeight + 1) return false;
  return (Number(scrollArea.scrollTop) || 0) > 0;
}
