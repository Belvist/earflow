/**
 * Proof run: dumps computed play-button styles + screenshots for adaptive vs metallic.
 * Run: npx playwright test e2e/mini-play-style-proof.spec.js --project=mobile-chromium
 */
const { test, expect } = require('@playwright/test');

const PLAYGROUND = '/playground/mobile-player';
const MINI_BAR = '[data-testid="mini-player-bar"]';
const PLAY_BTN = '[data-testid="mini-player-play"]';

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

async function readPlayProof(page) {
  return page.evaluate(() => {
    const bar = document.querySelector('[data-testid="mini-player-bar"]');
    const btn = document.querySelector('[data-testid="mini-player-play"]');
    const adaptiveSvg = document.querySelector('.ef-mini-play-adaptive-svg');
    const iosSvg = document.querySelector('.ef-mini-play-ios-svg');
    if (!btn) return { error: 'no play button' };
    const cs = getComputedStyle(btn);
    return {
      barUi: bar?.getAttribute('data-mini-bar-ui') || null,
      barPlayStyle: bar?.getAttribute('data-mini-play-style') || null,
      htmlPlayStyle: document.documentElement.dataset.miniPlayStyle || null,
      btnPlayStyle: btn.getAttribute('data-play-style'),
      btnBg: cs.backgroundColor,
      btnBorder: cs.borderWidth,
      btnRadius: cs.borderRadius,
      hasAdaptiveSvg: !!adaptiveSvg,
      hasIosSvg: !!iosSvg,
      iosCircleCount: iosSvg ? iosSvg.querySelectorAll('circle').length : 0,
    };
  });
}

test.describe('Mini play style proof', () => {
  test('adaptive + metallic proof with screenshots', async ({ page }, testInfo) => {
    await page.goto(PLAYGROUND);
    await page.locator(MINI_BAR).waitFor({ state: 'visible', timeout: 12_000 });
    await page.evaluate(() => {
      localStorage.setItem('earflow_mini_bar_variant', 'floating');
      document.documentElement.dataset.miniBarVariant = 'floating';
      window.dispatchEvent(new CustomEvent('earflow:mini-bar-variant', { detail: { variant: 'floating' } }));
    });

    await setPlayStyle(page, 'adaptive');
    const adaptiveProof = await readPlayProof(page);
    console.log('ADAPTIVE PROOF:', JSON.stringify(adaptiveProof, null, 2));
    expect(adaptiveProof.barUi).toBe('2026-06-v17-ref-sketch');
    expect(adaptiveProof.btnPlayStyle).toBe('adaptive');
    expect(adaptiveProof.hasAdaptiveSvg).toBe(true);
    expect(adaptiveProof.hasIosSvg).toBe(false);
    expect(adaptiveProof.btnBg).toMatch(/rgba\(0,\s*0,\s*0,\s*0\)|transparent/i);
    expect(adaptiveProof.btnRadius).toBe('0px');
    await page.screenshot({
      path: testInfo.outputPath('proof-adaptive.png'),
      fullPage: false,
    });

    await setPlayStyle(page, 'metallic');
    const metallicProof = await readPlayProof(page);
    console.log('METALLIC PROOF:', JSON.stringify(metallicProof, null, 2));
    expect(metallicProof.btnPlayStyle).toBe('metallic');
    expect(metallicProof.hasAdaptiveSvg).toBe(false);
    expect(metallicProof.hasIosSvg).toBe(true);
    expect(metallicProof.iosCircleCount).toBeGreaterThanOrEqual(1);

    const progressLayout = await page.evaluate(() => {
      const bar = document.querySelector('[data-testid="mini-player-bar"]');
      const progress = document.querySelector('[data-testid="mini-player-progress"]');
      if (!bar || !progress) return { error: 'missing nodes' };
      const barBox = bar.getBoundingClientRect();
      const progBox = progress.getBoundingClientRect();
      const leftGap = Math.round(progBox.left - barBox.left);
      const rightGap = Math.round(barBox.right - progBox.right);
      return { leftGap, rightGap, gapsEqual: leftGap === rightGap, barWidth: Math.round(barBox.width) };
    });
    console.log('PROGRESS LAYOUT:', JSON.stringify(progressLayout, null, 2));
    expect(progressLayout.gapsEqual).toBe(true);
    expect(progressLayout.leftGap).toBe(0);
    expect(progressLayout.rightGap).toBe(0);

    await page.evaluate(() => {
      window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', {
        gamma: 28,
        beta: 55,
        alpha: 10,
      }));
    });
    await page.waitForTimeout(300);

    await page.screenshot({
      path: testInfo.outputPath('proof-metallic.png'),
      fullPage: false,
    });

    await testInfo.attach('adaptive-proof.json', {
      body: JSON.stringify(adaptiveProof, null, 2),
      contentType: 'application/json',
    });
    await testInfo.attach('metallic-proof.json', {
      body: JSON.stringify(metallicProof, null, 2),
      contentType: 'application/json',
    });
  });
});
