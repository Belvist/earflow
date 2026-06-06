/**
 * Один длинный visual walkthrough: браузер виден, скриншот на каждом шаге.
 * Удобно смотреть глазами и отдавать visual-manifest.json агенту.
 */
const { test, expect } = require('@playwright/test');
const { swipe, swipeOn, realisticTap } = require('./helpers/touch');
const { captureStep } = require('./helpers/visualCapture');
const { openRealHomepage, SELECTORS, acceptCookiesIfVisible } = require('./helpers/realHomepage');

const PLAYGROUND = '/playground/mobile-player';
const MINI_BAR = '[data-testid="mini-player-bar"]';
const MODAL = '[data-testid="mobile-player-modal"]';

test.describe('Visual walkthrough', () => {
  test('playground + homepage flows with step screenshots', async ({ page }, testInfo) => {
    test.setTimeout(120_000);

    // --- Playground (жесты без backend) ---
    await page.goto(PLAYGROUND);
    await acceptCookiesIfVisible(page);
    await page.locator(MINI_BAR).waitFor({ state: 'visible', timeout: 12_000 });
    await captureStep(page, testInfo, '01-playground-mini-bar');

    await realisticTap(page, page.locator(MINI_BAR));
    await expect(page.locator(MODAL)).toBeVisible({ timeout: 2_000 });
    await captureStep(page, testInfo, '02-playground-modal-open');

    const modalBox = await page.locator(MODAL).boundingBox();
    expect(modalBox).toBeTruthy();
    const closeX = Math.round(modalBox.x + modalBox.width / 2);
    const closeY = Math.round(modalBox.y + 90);
    await swipe(page, closeX, closeY, closeX, closeY + 460, 300);
    await expect(page.locator(MODAL)).not.toBeVisible({ timeout: 3_000 });
    await captureStep(page, testInfo, '03-playground-modal-closed');

    await swipeOn(page, page.locator(MINI_BAR), -140, 0, 180);
    await captureStep(page, testInfo, '04-playground-track-changed');

    // --- Главная без backend (guest) ---
    await page.goto('/');
    await acceptCookiesIfVisible(page);
    await expect(page.locator('[data-testid="home-player-root"]')).toBeVisible({ timeout: 12_000 });
    await captureStep(page, testInfo, '05-home-guest-or-loading');

    const guestEmpty = page.locator('[data-testid="home-queue-empty"]');
    const guestVisible = await guestEmpty.isVisible().catch(() => false);
    if (guestVisible) {
      await captureStep(page, testInfo, '06-home-guest-login-prompt');
    }

    // --- Главная с mock API (prod-like) ---
    await openRealHomepage(page, { trackCount: 6 });
    await captureStep(page, testInfo, '07-home-with-tracks');

    await expect(page.locator(SELECTORS.HOME_TITLE)).toHaveText('E2E Главная 1');
    await expect(page.locator(SELECTORS.MINI_BAR)).toBeVisible({ timeout: 12_000 });
    await captureStep(page, testInfo, '08-home-mini-bar-visible');

    const titleBefore = (await page.locator(SELECTORS.HOME_TITLE).textContent())?.trim();
    await swipeOn(page, page.locator(SELECTORS.HOME_COVER), -160, 0, 200);
    await expect.poll(async () => (await page.locator(SELECTORS.HOME_TITLE).textContent())?.trim() || '', {
      timeout: 2_500,
    }).not.toBe(titleBefore);
    await captureStep(page, testInfo, '09-home-cover-swipe-next-track');

    await realisticTap(page, page.locator(SELECTORS.MINI_BAR));
    await expect(page.locator(MODAL)).toBeVisible({ timeout: 2_000 });
    await captureStep(page, testInfo, '10-home-full-player-open');

    await page.evaluate(() => window.scrollTo(0, Math.min(700, (document.scrollingElement?.scrollHeight || 0) * 0.35)));
    await captureStep(page, testInfo, '11-home-scrolled-with-player');
  });

  test('mini-bar variant classic vs floating applies to DOM', async ({ page }) => {
    await page.goto(PLAYGROUND);
    await page.locator(MINI_BAR).waitFor({ state: 'visible', timeout: 12_000 });

    await page.evaluate(() => {
      localStorage.setItem('earflow_mini_bar_variant', 'classic');
      document.documentElement.dataset.miniBarVariant = 'classic';
      window.dispatchEvent(new CustomEvent('earflow:mini-bar-variant', { detail: { variant: 'classic' } }));
    });
    await expect(page.locator(MINI_BAR)).toHaveAttribute('data-mini-bar-variant', 'classic', { timeout: 3_000 });
    await expect.poll(async () => {
      const box = await page.locator(MINI_BAR).boundingBox();
      const viewport = page.viewportSize();
      if (!box || !viewport) return 0;
      return box.x;
    }).toBeLessThan(2);

    await page.evaluate(() => {
      localStorage.setItem('earflow_mini_bar_variant', 'floating');
      document.documentElement.dataset.miniBarVariant = 'floating';
      window.dispatchEvent(new CustomEvent('earflow:mini-bar-variant', { detail: { variant: 'floating' } }));
    });
    await expect(page.locator(MINI_BAR)).toHaveAttribute('data-mini-bar-variant', 'floating', { timeout: 3_000 });
    await expect.poll(async () => {
      const box = await page.locator(MINI_BAR).boundingBox();
      if (!box) return 0;
      return box.x;
    }).toBeGreaterThan(8);

    const playBox = await page.locator('[data-testid="mini-player-play"]').boundingBox();
    expect(playBox?.width || 0).toBeLessThan(39);

    const progress = page.locator('[data-testid="mini-player-progress"]');
    await expect(progress).toBeVisible();
    const progressBox = await progress.boundingBox();
    expect(progressBox?.height || 0).toBeGreaterThanOrEqual(1);
    if (playBox && progressBox) {
      expect(progressBox.y).toBeGreaterThanOrEqual(playBox.y);
    }
  });

  test('mini-bar play style adaptive vs metallic applies to DOM', async ({ page }) => {
    await page.goto(PLAYGROUND);
    await page.locator(MINI_BAR).waitFor({ state: 'visible', timeout: 12_000 });

    await page.evaluate(() => {
      localStorage.setItem('earflow_mini_play_style', 'adaptive');
      document.documentElement.dataset.miniPlayStyle = 'adaptive';
      window.dispatchEvent(new CustomEvent('earflow:mini-play-style', { detail: { style: 'adaptive' } }));
    });
    await expect(page.locator('[data-testid="mini-player-play"]')).toHaveAttribute('data-play-style', 'adaptive');
    await expect(page.locator('.ef-mini-play-adaptive-svg')).toBeVisible();

    await page.evaluate(() => {
      localStorage.setItem('earflow_mini_play_style', 'metallic');
      document.documentElement.dataset.miniPlayStyle = 'metallic';
      window.dispatchEvent(new CustomEvent('earflow:mini-play-style', { detail: { style: 'metallic' } }));
    });
    await expect(page.locator('[data-testid="mini-player-play"]')).toHaveAttribute('data-play-style', 'metallic');
    await expect(page.locator('.ef-mini-play-ios-svg')).toBeVisible();
    await expect(page.locator('.ef-mini-play-adaptive-svg')).toHaveCount(0);
  });
});
