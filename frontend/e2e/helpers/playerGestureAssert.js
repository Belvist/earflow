/**
 * Assertions for mini-bar interaction health after aggressive gestures.
 * Uses computed styles + hit-test — same signals a user would notice as "frozen".
 */
const { expect } = require('@playwright/test');

const DEFAULT_MINI = '[data-testid="mini-player-bar"]';
const DEFAULT_MODAL = '[data-testid="mobile-player-modal"]';

async function readMiniInteractionHealth(page, { miniBar = DEFAULT_MINI, modal = DEFAULT_MODAL } = {}) {
  const miniBox = await page.locator(miniBar).boundingBox();
  if (!miniBox) {
    return { ok: false, reason: 'mini-bar boundingBox missing', pointerEvents: '', hitInsideMini: false };
  }
  return page.evaluate(({ miniBar: barSel, modal: modalSel, x, y }) => {
    const mini = document.querySelector(barSel);
    const modalEl = document.querySelector(modalSel);
    const node = document.elementFromPoint(x, y);
    const styles = mini ? window.getComputedStyle(mini) : null;
    const modalRect = modalEl?.getBoundingClientRect?.();
    const modalVisible = Boolean(modalRect && modalRect.height > 8 && modalRect.width > 8);
    const sheetOpen = document.documentElement.getAttribute('data-player-sheet-open') === 'true';
    return {
      ok: true,
      pointerEvents: styles?.pointerEvents || '',
      opacity: styles?.opacity || '',
      hitInsideMini: Boolean(mini && node && mini.contains(node)),
      modalVisible,
      sheetOpen,
      inlinePointerEvents: mini?.style?.pointerEvents || '',
    };
  }, {
    miniBar,
    modal,
    x: Math.round(miniBox.x + miniBox.width / 2),
    y: Math.round(miniBox.y + miniBox.height / 2),
  });
}

async function expectMiniBarInteractive(page, opts = {}) {
  const health = await readMiniInteractionHealth(page, opts);
  expect(health.ok, health.reason || 'mini-bar health').toBe(true);
  expect(health.pointerEvents, 'mini-bar pointer-events must stay auto after gestures').toBe('auto');
  expect(health.hitInsideMini, 'elementFromPoint must hit mini-bar center').toBe(true);
  return health;
}

/**
 * Rapid alternating horizontal track swipes on mini-bar (pointer path, not CDP-only touch).
 */
async function rapidAlternatingTrackSwipes(page, {
  miniBar = DEFAULT_MINI,
  swipe = null,
  count = 14,
  dx = 150,
  durationMs = 120,
  pauseMs = 140,
} = {}) {
  const { pointerSwipeOn } = require('./touch');
  const doSwipe = swipe || ((p, loc, direction) => pointerSwipeOn(p, loc, direction, 0, durationMs));

  const locator = page.locator(miniBar);
  let success = 0;
  let lastObserved = null;

  for (let i = 0; i < count; i += 1) {
    const direction = i % 2 === 0 ? -dx : dx;
    await doSwipe(page, locator, direction);
    if (pauseMs > 0) await page.waitForTimeout(pauseMs);
    success += 1;
    lastObserved = i;
  }

  return { success, lastObserved };
}

module.exports = {
  DEFAULT_MINI,
  DEFAULT_MODAL,
  readMiniInteractionHealth,
  expectMiniBarInteractive,
  rapidAlternatingTrackSwipes,
};
