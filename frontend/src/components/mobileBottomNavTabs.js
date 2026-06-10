/** Tab order for mobile bottom nav — left swipe → next, right swipe → prev (iOS tab bar). */
export const MOBILE_NAV_TAB_ORDER = Object.freeze(['home', 'social', 'search', 'profile']);

/**
 * @param {string} activeTab
 * @param {-1|1|0} direction from shouldCommitHorizontalSwipe (-1 = left / next tab)
 * @returns {string|null}
 */
export function resolveAdjacentNavTab(activeTab, direction) {
  if (!direction) return null;
  const idx = MOBILE_NAV_TAB_ORDER.indexOf(activeTab);
  if (idx < 0) return null;
  const nextIdx = direction < 0 ? idx + 1 : idx - 1;
  if (nextIdx < 0 || nextIdx >= MOBILE_NAV_TAB_ORDER.length) return null;
  return MOBILE_NAV_TAB_ORDER[nextIdx];
}
