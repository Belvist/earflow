/** Tab order for mobile bottom nav — drag left → next tab (iOS Liquid Glass tab bar). */
export const MOBILE_NAV_TAB_ORDER = Object.freeze(['home', 'social', 'search', 'profile']);

const TAB_COUNT = MOBILE_NAV_TAB_ORDER.length;

/** Map off-tab routes to nearest anchor so drag still works (e.g. /artists → home). */
export function normalizeNavTabForSwipe(activeTab) {
  if (MOBILE_NAV_TAB_ORDER.includes(activeTab)) return activeTab;
  if (activeTab === 'artists') return 'home';
  return 'home';
}

export function getNavTabIndex(activeTab) {
  return MOBILE_NAV_TAB_ORDER.indexOf(normalizeNavTabForSwipe(activeTab));
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Liquid Glass–style settle: fractional index from drag, optional velocity nudge.
 * @returns {string|null} tab id when changed, else null
 */
export function resolveTabFromDragOffset({
  activeTab,
  dx = 0,
  segmentWidthPx = 1,
  velocityX = 0,
} = {}) {
  const activeIdx = getNavTabIndex(activeTab);
  if (activeIdx < 0 || segmentWidthPx <= 0) return null;

  const seg = segmentWidthPx;
  let fractional = activeIdx - dx / seg;

  if (Math.abs(velocityX) >= 520) {
    fractional += velocityX < 0 ? 0.42 : -0.42;
  }

  const targetIdx = Math.round(clamp(fractional, 0, TAB_COUNT - 1));
  if (targetIdx === activeIdx) return null;
  return MOBILE_NAV_TAB_ORDER[targetIdx];
}

/**
 * @param {string} activeTab
 * @param {-1|1|0} direction from shouldCommitHorizontalSwipe (-1 = left / next tab)
 * @returns {string|null}
 */
export function resolveAdjacentNavTab(activeTab, direction) {
  if (!direction) return null;
  const idx = getNavTabIndex(activeTab);
  if (idx < 0) return null;
  const nextIdx = direction < 0 ? idx + 1 : idx - 1;
  if (nextIdx < 0 || nextIdx >= TAB_COUNT) return null;
  return MOBILE_NAV_TAB_ORDER[nextIdx];
}

export function getNavTabCount() {
  return TAB_COUNT;
}

/**
 * Project pointer X onto chip track — chip center follows finger (clamped inside pill).
 */
export function pointerClientXToChipX({
  clientX,
  trackRect,
  innerPadPx = 0,
  segmentWidthPx,
  tabCount = TAB_COUNT,
} = {}) {
  if (!trackRect || segmentWidthPx <= 0) return 0;
  const innerLeft = trackRect.left + innerPadPx;
  const innerWidth = trackRect.width - 2 * innerPadPx;
  const chipW = segmentWidthPx;
  const maxX = Math.max(0, innerWidth - chipW);
  const x = clientX - innerLeft - chipW / 2;
  return clamp(x, 0, maxX);
}

/** Nearest tab slot from chip X (release snap). */
export function snapIndexFromChipX(chipX, segmentWidthPx) {
  if (segmentWidthPx <= 0) return 0;
  return clamp(Math.round(chipX / segmentWidthPx), 0, TAB_COUNT - 1);
}

export function snapTabFromChipX(chipX, segmentWidthPx) {
  return MOBILE_NAV_TAB_ORDER[snapIndexFromChipX(chipX, segmentWidthPx)];
}
