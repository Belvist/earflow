/**
 * Layout + progress engine checks for MobilePlayerBar.
 * Playground: /playground/mobile-player (no network, fake player refs).
 */
const { test, expect } = require('@playwright/test');

const PLAYGROUND = '/playground/mobile-player';
const MINI_BAR = '[data-testid="mini-player-bar"]';
const PROGRESS = '[data-testid="mini-player-progress"]';
const PLAY_BTN = '[data-testid="mini-player-play"]';
const MAIN_ROW = '.ef-mini-player-main';

async function setFloatingVariant(page) {
  await page.evaluate(() => {
    const prefs = {
      v: 1,
      miniBarVariant: 'floating',
      miniPlayStyle: localStorage.getItem('earflow_mini_play_style') || 'adaptive',
      updatedAt: Date.now(),
    };
    localStorage.setItem('earflow_listener_ui_v1', JSON.stringify(prefs));
    localStorage.setItem('earflow_mini_bar_variant', 'floating');
    document.documentElement.dataset.miniBarVariant = 'floating';
    window.dispatchEvent(new CustomEvent('earflow:listener-ui-change', { detail: prefs }));
  });
}

async function setClassicVariant(page) {
  await page.evaluate(() => {
    const prefs = {
      v: 1,
      miniBarVariant: 'classic',
      miniPlayStyle: localStorage.getItem('earflow_mini_play_style') || 'adaptive',
      updatedAt: Date.now(),
    };
    localStorage.setItem('earflow_listener_ui_v1', JSON.stringify(prefs));
    localStorage.setItem('earflow_mini_bar_variant', 'classic');
    document.documentElement.dataset.miniBarVariant = 'classic';
    window.dispatchEvent(new CustomEvent('earflow:listener-ui-change', { detail: prefs }));
  });
  await page.waitForTimeout(150);
}

async function setPlayStyle(page, style) {
  await page.evaluate((next) => {
    const bar = document.documentElement.dataset.miniBarVariant
      || localStorage.getItem('earflow_mini_bar_variant')
      || 'floating';
    const prefs = {
      v: 1,
      miniBarVariant: bar,
      miniPlayStyle: next,
      updatedAt: Date.now(),
    };
    localStorage.setItem('earflow_listener_ui_v1', JSON.stringify(prefs));
    localStorage.setItem('earflow_mini_play_style', next);
    document.documentElement.dataset.miniPlayStyle = next;
    window.dispatchEvent(new CustomEvent('earflow:listener-ui-change', { detail: prefs }));
  }, style);
  await page.waitForTimeout(150);
}

test.describe('Mini-bar layout (playground)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PLAYGROUND);
    await page.locator(MINI_BAR).waitFor({ state: 'visible', timeout: 12_000 });
    await setFloatingVariant(page);
    await expect(page.locator(MINI_BAR)).toHaveAttribute('data-mini-bar-variant', 'floating');
  });

  test('progress --progress updates when currentTimeRef advances (useSeekableProgress)', async ({ page }) => {
    const readProgress = () => page.evaluate(() => {
      const bar = document.getElementById('mini-progress-bar');
      return bar ? getComputedStyle(bar).getPropertyValue('--progress').trim() : '';
    });

    const atStart = await readProgress();
    await page.evaluate(() => {
      const hook = window.__earflowPlayground;
      if (!hook?.currentTimeRef) throw new Error('playground hook missing');
      hook.currentTimeRef.current = 100;
    });

    await expect.poll(readProgress, { timeout: 3_000 }).not.toBe(atStart);
    await expect.poll(async () => {
      const raw = await readProgress();
      const pct = parseFloat(raw);
      return Number.isFinite(pct) ? pct : -1;
    }, { timeout: 3_000 }).toBeGreaterThan(45);
  });

  test('progress track sits below play control (not same row)', async ({ page }) => {
    const playBox = await page.locator(PLAY_BTN).boundingBox();
    const progressBox = await page.locator(PROGRESS).boundingBox();
    expect(playBox).toBeTruthy();
    expect(progressBox).toBeTruthy();
    expect(progressBox.y).toBeGreaterThanOrEqual(playBox.y);
    expect(progressBox.y + progressBox.height).toBeGreaterThanOrEqual(playBox.y + playBox.height - 2);
  });

  test('progress row sits below main content row (no vertical stack collision)', async ({ page }) => {
    const mainBox = await page.locator(MAIN_ROW).boundingBox();
    const progressBox = await page.locator(PROGRESS).boundingBox();
    const shellBox = await page.locator(MINI_BAR).boundingBox();
    expect(mainBox).toBeTruthy();
    expect(progressBox).toBeTruthy();
    expect(shellBox).toBeTruthy();
    expect(progressBox.y).toBeGreaterThanOrEqual(mainBox.y);
    expect(progressBox.y + progressBox.height).toBeLessThanOrEqual(shellBox.y + shellBox.height + 2);
  });

  test('adaptive play: icon only, no white circle fill', async ({ page }) => {
    await setPlayStyle(page, 'adaptive');
    await expect(page.locator('[data-testid="mini-player-play"]')).toHaveAttribute('data-play-style', 'adaptive');
    await expect(page.locator('.ef-mini-play-adaptive-svg')).toBeVisible();

    const styles = await page.evaluate(() => {
      const control = document.querySelector('[data-testid="mini-player-play"]');
      const svg = document.querySelector('.ef-mini-play-adaptive-svg');
      if (!control || !svg) return null;
      const controlCs = getComputedStyle(control);
      return {
        controlBg: controlCs.backgroundColor,
        borderWidth: controlCs.borderWidth,
        tagName: control.tagName,
      };
    });

    expect(styles?.tagName).toBe('DIV');
    expect(styles?.controlBg).toMatch(/rgba\(0,\s*0,\s*0,\s*0\)|transparent/i);
    expect(styles?.borderWidth).toBe('0px');
  });

  test('metallic play: SVG chrome visible on floating bar', async ({ page }) => {
    await setPlayStyle(page, 'metallic');
    await expect(page.locator('[data-testid="mini-player-play"]')).toHaveAttribute('data-play-style', 'metallic');
    await expect(page.locator('.ef-mini-play-ios-svg')).toBeVisible();
    await expect(page.locator('.ef-mini-play-adaptive-svg')).toHaveCount(0);
    await expect(page.locator('.ef-mini-play-ios-svg circle')).toHaveCount(2);
    await expect(
      page.locator('.ef-mini-play-ios-svg path, .ef-mini-play-ios-svg rect'),
    ).not.toHaveCount(0);
  });

  test('play style switch updates mini bar without reload', async ({ page }) => {
    await setPlayStyle(page, 'adaptive');
    await expect(page.locator('html')).toHaveAttribute('data-mini-play-style', 'adaptive');
    await expect(page.locator('[data-testid="mini-player-bar"]')).toHaveAttribute('data-mini-play-style', 'adaptive');

    await setPlayStyle(page, 'metallic');
    await expect(page.locator('html')).toHaveAttribute('data-mini-play-style', 'metallic');
    await expect(page.locator('[data-testid="mini-player-play"]')).toHaveAttribute('data-play-style', 'metallic');
    await expect(page.locator('.ef-mini-play-ios-svg')).toBeVisible();
    await expect(page.locator('.ef-mini-play-adaptive-svg')).toHaveCount(0);

    await setPlayStyle(page, 'adaptive');
    await expect(page.locator('.ef-mini-play-adaptive-svg')).toBeVisible();
    await expect(page.locator('.ef-mini-play-ios-svg')).toHaveCount(0);
  });

  test('floating progress track is thin (≤5px height)', async ({ page }) => {
    const progressBox = await page.locator(PROGRESS).boundingBox();
    expect(progressBox?.height ?? 99).toBeGreaterThanOrEqual(2);
    expect(progressBox?.height ?? 99).toBeLessThanOrEqual(5);
  });

  test('floating progress track is edge-to-edge inside shell', async ({ page }) => {
    const metrics = await page.evaluate(() => {
      const shell = document.querySelector('[data-testid="mini-player-bar"]');
      const progress = document.querySelector('[data-testid="mini-player-progress"]');
      if (!shell || !progress) return null;
      const s = shell.getBoundingClientRect();
      const p = progress.getBoundingClientRect();
      return {
        leftInset: p.left - s.left,
        rightInset: s.right - p.right,
        bottomGap: s.bottom - p.bottom,
      };
    });
    expect(metrics).toBeTruthy();
    expect(Math.abs(metrics.leftInset - metrics.rightInset)).toBeLessThan(2);
    expect(metrics.leftInset).toBeLessThan(2);
    expect(metrics.rightInset).toBeLessThan(2);
    expect(Math.abs(metrics.bottomGap)).toBeLessThan(2);
  });

  test('classic variant: full-width shell + progress edge-to-edge', async ({ page }) => {
    await setClassicVariant(page);
    await expect(page.locator(MINI_BAR)).toHaveAttribute('data-mini-bar-variant', 'classic');

    const shellBox = await page.locator(MINI_BAR).boundingBox();
    const viewport = page.viewportSize();
    expect(shellBox?.x ?? 99).toBeLessThan(4);
    expect((viewport?.width ?? 0) - (shellBox.x + shellBox.width)).toBeLessThan(4);

    const progressBox = await page.locator(PROGRESS).boundingBox();
    expect(progressBox?.height ?? 0).toBeGreaterThanOrEqual(2);
    await expect(page.locator(PROGRESS)).toBeVisible();
  });
});
