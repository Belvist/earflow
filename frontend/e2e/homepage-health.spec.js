const { test, expect } = require('@playwright/test');
const { openRealHomepage, SELECTORS } = require('./helpers/realHomepage');
const { MINI_BAR, HOME_TITLE, HOME_COVER } = SELECTORS;

test.describe('Homepage health (prod-like with mocked API)', () => {
  test('authenticated homepage shows track, cover and mini-bar', async ({ page }) => {
    await openRealHomepage(page);

    await expect(page.locator(HOME_COVER)).toBeVisible({ timeout: 12_000 });
    await expect(page.locator(HOME_TITLE)).toHaveText('E2E Главная 1');
    await expect(page.locator(MINI_BAR)).toBeVisible({ timeout: 12_000 });
    await expect(page.locator('[data-testid="home-sections-skeleton"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="mini-player-track-title"]')).toHaveText('E2E Главная 1');
  });

  test('desktop homepage uses layout v3 hero and for-you row', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openRealHomepage(page);

    await expect(page.locator(SELECTORS.HOME_DESKTOP_LAYOUT)).toBeVisible({ timeout: 12_000 });
    await expect(page.locator(SELECTORS.HOME_DESKTOP_HERO)).toBeVisible();
    await expect(page.locator(SELECTORS.HOME_FOR_YOU_ROW)).toBeVisible();
    await expect(page.locator('[data-testid="home-cover-stack"]')).toHaveCount(0);
    await expect(page.locator(HOME_TITLE)).toHaveText('E2E Главная 1');
    await expect(page.locator(HOME_COVER)).toBeVisible();
  });

  test('mobile homepage uses layout v3 hero and for-you list', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openRealHomepage(page);

    await expect(page.locator(SELECTORS.HOME_MOBILE_LAYOUT)).toBeVisible({ timeout: 12_000 });
    await expect(page.locator(SELECTORS.HOME_MOBILE_HERO)).toBeVisible();
    await expect(page.locator(SELECTORS.HOME_FOR_YOU_LIST)).toBeVisible();
    await expect(page.locator('[data-testid="home-cover-stack"]')).toHaveCount(0);
    await expect(page.locator(HOME_TITLE)).toHaveText('E2E Главная 1');
    await expect(page.locator(HOME_COVER)).toBeVisible();
  });
});
