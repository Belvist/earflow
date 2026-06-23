/**
 * Gesture contract e2e (real homepage + real touch).
 * Album gestures use pointer dispatch (same path as production), not CDP-only swipe.
 */
const { test, expect } = require('@playwright/test');
const { swipe, pointerDragOn, pointerSwipeOn, realisticTap } = require('./helpers/touch');
const { SELECTORS, openRealHomepage } = require('./helpers/realHomepage');
const {
  rapidAlternatingTrackSwipes,
  expectMiniBarInteractive,
} = require('./helpers/playerGestureAssert');

const { MINI_BAR, MODAL } = SELECTORS;
const ALBUM = '[data-testid="player-album-section"]';
const CONTROLS = '[data-testid="player-controls-dock"]';
const MODAL_PROGRESS = '#mobile-progress-bar';

async function openModal(page) {
  await expect(page.locator(MINI_BAR)).toBeVisible({ timeout: 12_000 });
  await realisticTap(page, page.locator(MINI_BAR));
  await expect(page.locator(MODAL)).toBeVisible({ timeout: 3_000 });
  await expect
    .poll(
      async () =>
        page.evaluate((selector) => {
          const rect = document.querySelector(selector)?.getBoundingClientRect();
          return rect ? Math.round(rect.y) : null;
        }, MODAL),
      { timeout: 3_000, intervals: [80, 120, 180] },
    )
    .toBe(0);
}

async function readAlbumTitle(page) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return '';
    const titleNode = root.querySelector('h1, h2, [class*="TrackTitle"]');
    const text = (titleNode?.textContent || root.textContent || '').trim();
    return text.split(/\s{2,}/)[0].slice(0, 80);
  }, ALBUM);
}

test.describe('Player gesture contract (real touch)', () => {
  test.beforeEach(async ({ page }) => {
    await openRealHomepage(page, { trackCount: 6 });
    await expect(page.locator(MINI_BAR)).toBeVisible({ timeout: 12_000 });
  });

  test('mini-bar horizontal swipe changes track', async ({ page }) => {
    const indexBefore = await page.locator(MINI_BAR).innerText();
    await pointerSwipeOn(page, page.locator(MINI_BAR), -160, 0, 200);
    await expect
      .poll(async () => page.locator(MINI_BAR).innerText(), {
        timeout: 3_000,
        intervals: [80, 160, 240, 360],
      })
      .not.toBe(indexBefore);
    await expectMiniBarInteractive(page);
  });

  test('full player: album horizontal swipe changes title', async ({ page }) => {
    await openModal(page);
    const titleBefore = await readAlbumTitle(page);
    expect(titleBefore.length).toBeGreaterThan(2);

    const album = page.locator(ALBUM);
    await pointerDragOn(page, album, -200, 0, 280, 'touch');
    await expect
      .poll(async () => readAlbumTitle(page), { timeout: 4_000, intervals: [120, 200, 320] })
      .not.toBe(titleBefore);
  });

  test('full player: swipe down on album center dismisses sheet', async ({ page }) => {
    await openModal(page);
    await expect(page.locator(CONTROLS)).toBeVisible({ timeout: 3_000 });
    const box = await page.locator(ALBUM).boundingBox();
    expect(box).toBeTruthy();
    const cx = Math.round(box.x + box.width / 2);
    const cy = Math.round(box.y + box.height * 0.42);
    await swipe(page, cx, cy, cx, cy + 450, 320);
    await expect(page.locator(MODAL)).not.toBeVisible({ timeout: 5_000 });
    await expectMiniBarInteractive(page);
  });

  test('expand full player: controls dock mounts without flash at top', async ({ page }) => {
    await pointerSwipeOn(page, page.locator(MINI_BAR), 0, -220, 240);
    await expect(page.locator(MODAL)).toBeVisible({ timeout: 2_000 });
    await expect(page.locator(CONTROLS)).toBeVisible({ timeout: 2_000 });
    const layout = await page.evaluate(({ modalSel, dockSel }) => {
      const modal = document.querySelector(modalSel)?.getBoundingClientRect();
      const dock = document.querySelector(dockSel)?.getBoundingClientRect();
      if (!modal || !dock) return null;
      return {
        dockTop: Math.round(dock.top),
        modalBottom: Math.round(modal.bottom),
        gap: Math.round(modal.bottom - dock.bottom),
      };
    }, { modalSel: MODAL, dockSel: CONTROLS });
    expect(layout).toBeTruthy();
    expect(layout.dockTop).toBeGreaterThan(layout.modalBottom * 0.45);
    expect(layout.gap).toBeLessThan(120);
  });

  test('dismiss during close snap does not freeze mini-bar', async ({ page }) => {
    await openModal(page);
    const album = page.locator(ALBUM);
    const albumBox = await album.boundingBox();
    expect(albumBox).toBeTruthy();
    const cx = Math.round(albumBox.x + albumBox.width / 2);
    const yStart = Math.round(albumBox.y + albumBox.height * 0.35);
    await pointerDragOn(page, album, 0, 90, 80, 'touch');
    await page.waitForTimeout(80);
    await pointerDragOn(page, album, 0, 480, 300, 'touch');
    await expect(page.locator(MODAL)).not.toBeVisible({ timeout: 5_000 });
    await expectMiniBarInteractive(page);
  });

  test('modal seek scrub then rapid mini swipes stay interactive', async ({ page }) => {
    test.setTimeout(60_000);
    await openModal(page);
    const bar = page.locator(MODAL_PROGRESS);
    await expect(bar).toBeVisible({ timeout: 2_000 });
    const box = await bar.boundingBox();
    expect(box).toBeTruthy();
    const x0 = Math.round(box.x + box.width * 0.2);
    const x1 = Math.round(box.x + box.width * 0.75);
    const y = Math.round(box.y + box.height / 2);
    await pointerDragOn(page, bar, x1 - x0, 0, 220, 'touch');

    const albumBox = await page.locator(ALBUM).boundingBox();
    expect(albumBox).toBeTruthy();
    const cx = Math.round(albumBox.x + albumBox.width / 2);
    const cy = Math.round(albumBox.y + albumBox.height * 0.42);
    await swipe(page, cx, cy, cx, cy + 450, 320);
    await expect(page.locator(MODAL)).not.toBeVisible({ timeout: 5_000 });

    await rapidAlternatingTrackSwipes(page, { count: 8, pauseMs: 200 });
    await expectMiniBarInteractive(page);
  });
});
