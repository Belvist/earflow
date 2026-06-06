const { test, expect } = require('@playwright/test');
const { swipe, swipeOn, realisticTap, pointerDragOn, pointerSwipeOn } = require('./helpers/touch');
const { SELECTORS, openRealHomepage } = require('./helpers/realHomepage');

const {
  MINI_BAR, MODAL, HOME_ROOT, HOME_COVER, HOME_TITLE, GLOBAL_BAR, PLAYLIST_CARD, PLAYLIST_RAIL,
} = SELECTORS;

test.describe('Real homepage mobile gestures', () => {
  test('cover stack swipe changes track on real / homepage', async ({ page }) => {
    await openRealHomepage(page);

    const initialTitle = (await page.locator(HOME_TITLE).textContent())?.trim();
    await swipeOn(page, page.locator(HOME_COVER), -170, 0, 220);

    await expect.poll(async () => (await page.locator(HOME_TITLE).textContent())?.trim() || '', {
      timeout: 2_000,
      intervals: [80, 140, 220],
    }).not.toBe(initialTitle);
  });

  test('mini-player swipe works after horizontal playlist rail scroll on real homepage', async ({ page }) => {
    await openRealHomepage(page);
    await expect(page.locator(MINI_BAR)).toBeVisible({ timeout: 12_000 });
    await expect(page.locator(PLAYLIST_RAIL).first()).toBeVisible({ timeout: 8_000 });

    const rail = page.locator(PLAYLIST_RAIL).first();
    await swipeOn(page, rail, -220, 0, 240);
    await swipeOn(page, rail, -180, 0, 220);

    await page.evaluate(() => window.scrollTo(0, Math.min(700, (document.scrollingElement?.scrollHeight || 0) * 0.35)));
    await expect.poll(async () => page.evaluate(() => window.scrollY), { timeout: 2_000 }).toBeGreaterThan(40);

    const mini = page.locator(MINI_BAR);
    const miniBox = await mini.boundingBox();
    expect(miniBox, 'mini-player должен быть hit-testable после rail scroll + page scroll').toBeTruthy();
    const hitInsideMini = await page.evaluate(({ x, y, selector }) => {
      const node = document.elementFromPoint(x, y);
      const bar = document.querySelector(selector);
      return Boolean(bar && node && bar.contains(node));
    }, {
      x: Math.round(miniBox.x + miniBox.width / 2),
      y: Math.round(miniBox.y + miniBox.height / 2),
      selector: MINI_BAR,
    });
    expect(hitInsideMini).toBe(true);

    await pointerSwipeOn(page, mini, 0, -180, 220);
    await expect(page.locator(MODAL)).toBeVisible({ timeout: 1_500 });
    await expect.poll(async () => page.evaluate((selector) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return rect ? Math.round(rect.y) : null;
    }, MODAL), {
      timeout: 2_000,
      intervals: [80, 120, 180, 240],
    }).toBeLessThanOrEqual(12);
  });

  test('mini-player tap and swipe still work after scrolling real / homepage', async ({ page }) => {
    await openRealHomepage(page);
    await expect(page.locator(MINI_BAR)).toBeVisible({ timeout: 12_000 });

    await expect.poll(async () => page.evaluate(() => document.scrollingElement?.scrollHeight || 0), {
      timeout: 6_000,
      intervals: [250, 500, 750],
    }).toBeGreaterThan(1200);

    await page.evaluate(() => window.scrollTo(0, Math.min(900, Math.max(0, (document.scrollingElement?.scrollHeight || 0) - window.innerHeight - 1))));
    await expect.poll(async () => page.evaluate(() => window.scrollY), { timeout: 2_000 }).toBeGreaterThan(100);

    const miniBox = await page.locator(MINI_BAR).boundingBox();
    expect(miniBox, 'real homepage mini-player boundingBox должен быть доступен после scroll').toBeTruthy();
    const hitInsideMini = await page.evaluate(({ x, y, selector }) => {
      const node = document.elementFromPoint(x, y);
      const mini = document.querySelector(selector);
      return Boolean(mini && node && mini.contains(node));
    }, {
      x: Math.round(miniBox.x + miniBox.width / 2),
      y: Math.round(miniBox.y + miniBox.height / 2),
      selector: MINI_BAR,
    });
    expect(hitInsideMini).toBe(true);

    await realisticTap(page, page.locator(MINI_BAR));
    await expect(page.locator(MODAL)).toBeVisible({ timeout: 1_500 });
    await expect.poll(async () => page.evaluate((selector) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return rect ? Math.round(rect.y) : null;
    }, MODAL), {
      timeout: 2_000,
      intervals: [80, 120, 180, 240],
    }).toBe(0);

    const modalBox = await page.locator(MODAL).boundingBox();
    expect(modalBox, 'real homepage modal boundingBox должен быть доступен').toBeTruthy();
    const startX = Math.round(modalBox.x + modalBox.width / 2);
    const startY = Math.round(modalBox.y + 90);
    await swipe(page, startX, startY, startX, startY + 460, 300);
    await expect(page.locator(MODAL)).not.toBeVisible({ timeout: 1_500 });

    await page.evaluate(() => window.scrollTo(0, Math.min(900, Math.max(0, (document.scrollingElement?.scrollHeight || 0) - window.innerHeight - 1))));
    await expect.poll(async () => page.evaluate(() => window.scrollY), { timeout: 2_000 }).toBeGreaterThan(100);
    const secondMiniBox = await page.locator(MINI_BAR).boundingBox();
    expect(secondMiniBox, 'real homepage mini-player должен оставаться hit-testable после dismiss + scroll').toBeTruthy();
    const secondMiniState = await page.evaluate(({ selector, x, y }) => {
      const node = document.elementFromPoint(x, y);
      const mini = document.querySelector(selector);
      const styles = mini ? window.getComputedStyle(mini) : null;
      return {
        hitInsideMini: Boolean(mini && node && mini.contains(node)),
        pointerEvents: styles?.pointerEvents || '',
        opacity: styles?.opacity || '',
        transform: styles?.transform || '',
      };
    }, {
      selector: MINI_BAR,
      x: Math.round(secondMiniBox.x + secondMiniBox.width / 2),
      y: Math.round(secondMiniBox.y + secondMiniBox.height / 2),
    });
    expect(secondMiniState).toMatchObject({
      hitInsideMini: true,
      pointerEvents: 'auto',
    });
    await pointerSwipeOn(page, page.locator(MINI_BAR), 0, -180, 220);
    await expect(page.locator(MODAL)).toBeVisible({ timeout: 1_500 });
  });
});

test.describe('Real homepage desktop gestures', () => {
  test('PC desktop hero cover drag flips tracks and playlists are selectable on real / homepage', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
    });
    const page = await context.newPage();

    try {
      await openRealHomepage(page);
      await expect(page.locator(GLOBAL_BAR)).toBeVisible({ timeout: 12_000 });
      await expect(page.locator('[data-testid="home-desktop-layout-v3"]')).toBeVisible({ timeout: 12_000 });

      const initialTitle = (await page.locator(HOME_TITLE).textContent())?.trim();
      await pointerDragOn(page, page.locator(HOME_COVER), -220, 0, 240);
      await expect.poll(async () => (await page.locator(HOME_TITLE).textContent())?.trim() || '', {
        timeout: 2_000,
        intervals: [80, 140, 220],
      }).not.toBe(initialTitle);

      await expect(page.locator(PLAYLIST_RAIL).first()).toBeVisible({ timeout: 8_000 });
      await expect(page.locator(PLAYLIST_CARD).first()).toBeVisible({ timeout: 8_000 });
      await page.locator(PLAYLIST_CARD).nth(1).getByRole('button', { name: 'Слушать' }).click({ force: true });
      await expect.poll(async () => (await page.locator(HOME_TITLE).textContent())?.trim() || '', {
        timeout: 2_000,
        intervals: [80, 140, 220],
      }).toBe('Плейлист 1.2 трек 1');
    } finally {
      await context.close();
    }
  });
});
