/**
 * Regression: seek-like pointer on hero/waveform strip, then rapid mini-bar L/R swipes.
 * Reproduces prod freeze (INV-SHEET-009): sheet must stay closed, mini must keep changing tracks.
 */
const { test, expect } = require('@playwright/test');
const { pointerDragOn, pointerSwipeOn, realisticTap } = require('./helpers/touch');
const { expectMiniBarInteractive } = require('./helpers/playerGestureAssert');
const { seedCookieConsent } = require('./helpers/cookies');
const { openRealHomepage, SELECTORS } = require('./helpers/realHomepage');

const PLAYGROUND_URL = '/playground/mobile-player';
const MINI_BAR = '[data-testid="mini-player-bar"]';
const MODAL = '[data-testid="mobile-player-modal"]';
const TRACK_INDEX = '[data-testid="playground-track-index"]';
const FAKE_WAVEFORM = '[data-testid="playground-fake-waveform"]';
const HERO_WAVEFORM = `${SELECTORS.HOME_MOBILE_HERO} [role="slider"]`;
const MINI_TRACK_TITLE = '[data-testid="mini-player-track-title"]';

async function simulateSeekDrags(page, locator, times = 3) {
  for (let i = 0; i < times; i += 1) {
    const dx = i % 2 === 0 ? 48 : -36;
    await pointerDragOn(page, locator, dx, 0, 90, 'touch');
    await page.waitForTimeout(60);
  }
}

async function countTrackChanges(page, indexLocator, swipeCount, swipeFn) {
  const initial = await indexLocator.textContent();
  let last = initial;
  let changes = 0;

  for (let i = 0; i < swipeCount; i += 1) {
    await swipeFn(i);
    try {
      await expect
        .poll(async () => await indexLocator.textContent(), {
          timeout: 2_000,
          intervals: [60, 120, 180, 320],
        })
        .not.toBe(last);
      changes += 1;
      last = await indexLocator.textContent();
    } catch {
      // one miss allowed in burst — counted below via threshold
    }
    await page.waitForTimeout(100);
  }
  return { initial, last, changes };
}

test.describe('Freeze regression — playground', () => {
  test.beforeEach(async ({ page }) => {
    await seedCookieConsent(page);
    await page.goto(PLAYGROUND_URL);
    await expect(page.locator(MINI_BAR)).toBeVisible({ timeout: 10_000 });
  });

  test('fake waveform seek + 14 rapid L/R swipes — tracks change, mini stays interactive', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const indexLocator = page.locator(TRACK_INDEX);
    const waveform = page.locator(FAKE_WAVEFORM);

    await simulateSeekDrags(page, waveform, 3);

    const { changes } = await countTrackChanges(page, indexLocator, 14, async (i) => {
      const dx = i % 2 === 0 ? -150 : 150;
      await pointerSwipeOn(page, page.locator(MINI_BAR), dx, 0, 110);
    });

    expect(
      changes,
      `After seek + burst swipes expected ≥10 track changes, got ${changes}/14`,
    ).toBeGreaterThanOrEqual(10);

    await expectMiniBarInteractive(page);

    await realisticTap(page, page.locator(MINI_BAR));
    await expect(page.locator(MODAL)).toBeVisible({ timeout: 2_000 });
  });
});

test.describe('Freeze regression — real homepage', () => {
  test('hero waveform seek + rapid mini swipes — title changes, tap still opens player', async ({
    page,
  }) => {
    test.setTimeout(75_000);
    await openRealHomepage(page, { trackCount: 12 });
    await expect(page.locator(SELECTORS.MINI_BAR)).toBeVisible({ timeout: 8_000 });

    const trackTitle = page.locator(MINI_TRACK_TITLE);
    const waveform = page.locator(HERO_WAVEFORM);
    await expect(waveform).toBeVisible({ timeout: 5_000 });
    await expect(trackTitle).toBeVisible({ timeout: 5_000 });

    await simulateSeekDrags(page, waveform, 3);

    let lastTitle = (await trackTitle.textContent())?.trim() || '';
    let changes = 0;
    for (let i = 0; i < 12; i += 1) {
      const dx = i % 2 === 0 ? -140 : 140;
      await pointerSwipeOn(page, page.locator(SELECTORS.MINI_BAR), dx, 0, 110);
      await page.waitForTimeout(120);
      try {
        await expect
          .poll(async () => (await trackTitle.textContent())?.trim() || '', {
            timeout: 2_000,
            intervals: [60, 120, 200, 360],
          })
          .not.toBe(lastTitle);
        changes += 1;
        lastTitle = (await trackTitle.textContent())?.trim() || '';
      } catch {
        // threshold below
      }
    }

    expect(
      changes,
      `Real homepage: expected ≥8 mini track title changes after waveform+mini burst, got ${changes}`,
    ).toBeGreaterThanOrEqual(8);

    await expectMiniBarInteractive(page, { miniBar: SELECTORS.MINI_BAR, modal: SELECTORS.MODAL });

    await realisticTap(page, page.locator(SELECTORS.MINI_BAR));
    await expect(page.locator(SELECTORS.MODAL)).toBeVisible({ timeout: 2_000 });
  });
});
