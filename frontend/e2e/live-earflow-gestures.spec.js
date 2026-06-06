/**
 * STRICT live e2e on https://earflow.ru — реальные сценарии, жёсткие пороги.
 *
 * Login once:  npm run test:e2e:live:login
 * Run:         npm run test:e2e:live
 *
 * Ослабить пороги (если сеть медленная): E2E_LIVE_TRACK_MIN_RATIO=0.8 npm run test:e2e:live
 */
const { test, expect } = require('@playwright/test');
const {
  SELECTORS,
  SKIP_BUILD_GATE,
  waitForLiveMiniPlayer,
  assertStrictBoot,
  assertDeployGate,
  assertLiveSheetClosed,
  scrollPageToRatio,
  scrollHomeDiscover,
  scrubPlaylistRail,
  runTrackSwipeBattery,
  runModalOpenCloseCycles,
  runFreezeRegressionLive,
  navigatePlaylistAndReturnHome,
  openModalViaMiniSwipeUp,
  dismissModalViaSwipe,
  attachLiveState,
  getTrackTitle,
  pointerSwipeOn,
  pointerDragOn,
} = require('./helpers/liveSite');

test.describe.configure({ mode: 'serial' });

test.describe('Live earflow.ru — strict mobile gestures', () => {
  test.beforeAll(() => {
    if (!require('fs').existsSync(require('./helpers/liveSite').AUTH_FILE)) {
      throw new Error('Нет e2e/.auth/earflow-live.json — сначала: npm run test:e2e:live:login');
    }
  });

  test.beforeEach(async ({ page }) => {
    await waitForLiveMiniPlayer(page);
  });

  test('1) strict boot: portal, hit-test, sheet closed', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await assertStrictBoot(page, testInfo);
  });

  test('1b) deploy gate: prod build hint === repo (after frontend deploy)', async ({ page }, testInfo) => {
    test.skip(SKIP_BUILD_GATE, 'E2E_LIVE_SKIP_BUILD=1 — gate skipped, testing current prod');
    test.setTimeout(60_000);
    await assertDeployGate(page, testInfo);
  });

  test('2) scroll matrix: 0% / 45% / 90% / top — после каждого ≥1 track swipe', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const ratios = [0, 0.45, 0.9, 0];

    for (let r = 0; r < ratios.length; r += 1) {
      await scrollPageToRatio(page, ratios[r]);
      await assertLiveSheetClosed(page, testInfo, `scroll-matrix-${r}`);

      const before = await getTrackTitle(page);
      await pointerSwipeOn(page, page.locator(SELECTORS.MINI_BAR), r % 2 === 0 ? -170 : 170, 0, 160);
      await expect
        .poll(async () => getTrackTitle(page), { timeout: 3_000, intervals: [80, 160, 280] })
        .not.toEqual(before);

      await runTrackSwipeBattery(page, testInfo, {
        count: 4,
        minRatio: 1,
        pauseMs: 320,
        label: `scroll-matrix-${r}-battery`,
      });
    }
  });

  test('3) playlist rail scrub + discover scroll → 12 track swipes (≥92%)', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await scrollHomeDiscover(page);
    await scrubPlaylistRail(page, { railIndex: 0, swipes: 4 });
    await scrubPlaylistRail(page, { railIndex: 1, swipes: 3 });
    await scrollPageToRatio(page, 0.62);

    await assertLiveSheetClosed(page, testInfo, 'pre-rail-battery');
    await runTrackSwipeBattery(page, testInfo, {
      count: 12,
      minRatio: 0.92,
      pauseMs: 300,
      label: 'rail-scrub-battery',
    });

    await openModalViaMiniSwipeUp(page);
    await dismissModalViaSwipe(page);
  });

  test('4) modal open → dismiss → immediate tap (5 cycles, scroll between)', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await runModalOpenCloseCycles(page, testInfo);
    await attachLiveState(page, testInfo, 'modal-cycles-done');
  });

  test('5) playlist page → home → mini still swipes', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await navigatePlaylistAndReturnHome(page, testInfo);
    await runTrackSwipeBattery(page, testInfo, {
      count: 8,
      minRatio: 0.875,
      pauseMs: 280,
      label: 'post-playlist-battery',
    });
  });

  test('6) freeze regression: cover + waveform + rail + 20 fast L/R + diagnostics', async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const result = await runFreezeRegressionLive(page, testInfo);
    expect(result.burstSuccess).toBeGreaterThanOrEqual(Math.ceil(20 * 0.85));
    await attachLiveState(page, testInfo, 'freeze-final');
  });

  test('7) hero cover horizontal + diagonal mini open under scroll', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await scrollPageToRatio(page, 0);
    const cover = page.locator(SELECTORS.HOME_COVER);
    await expect(cover).toBeVisible({ timeout: 8_000 });

    const t0 = await getTrackTitle(page);
    await pointerDragOn(page, cover, -200, 0, 240, 'touch');
    await expect.poll(async () => getTrackTitle(page), { timeout: 3_000 }).not.toEqual(t0);

    await scrollHomeDiscover(page);
    await assertLiveSheetClosed(page, testInfo, 'before-diagonal-open');

    const mini = page.locator(SELECTORS.MINI_BAR);
    const box = await mini.boundingBox();
    expect(box).toBeTruthy();
    const { swipe } = require('./helpers/touch');
    await swipe(
      page,
      Math.round(box.x + box.width / 2),
      Math.round(box.y + box.height / 2),
      Math.round(box.x + box.width / 2),
      Math.max(40, box.y - 380),
      260,
    );
    await expect(page.locator(SELECTORS.MODAL)).toBeVisible({ timeout: 4_000 });
    await dismissModalViaSwipe(page);
    await assertLiveSheetClosed(page, testInfo, 'after-diagonal-open');
  });

  test('8) partial swipes never freeze mini (short up + short horizontal)', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const mini = page.locator(SELECTORS.MINI_BAR);
    await pointerSwipeOn(page, mini, 0, -48, 300);
    await page.waitForTimeout(500);
    await assertLiveSheetClosed(page, testInfo, 'partial-up');

    await pointerSwipeOn(page, mini, -24, 6, 240);
    await page.waitForTimeout(300);
    await assertLiveSheetClosed(page, testInfo, 'partial-h');

    const before = await getTrackTitle(page);
    await pointerSwipeOn(page, mini, -165, 0, 150);
    await expect.poll(async () => getTrackTitle(page), { timeout: 3_000 }).not.toEqual(before);
  });
});
