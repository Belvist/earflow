const { test, expect } = require('@playwright/test');
const { swipe, swipeOn, pointerSwipeOn, pointerDragOn, realisticTap, tapAt } = require('./helpers/touch');

const PLAYGROUND_URL = '/playground/mobile-player';
const MINI_BAR = '[data-testid="mini-player-bar"]';
const MODAL = '[data-testid="mobile-player-modal"]';
const ALBUM = '[data-testid="player-album-section"]';
const TRACK_INDEX = '[data-testid="playground-track-index"]';
const IS_PLAYING = '[data-testid="playground-is-playing"]';
const FAKE_CAROUSEL = '[data-testid="playground-fake-carousel"]';

const DEFAULT_SEED = Number.parseInt(process.env.E2E_STRESS_SEED || '20260525', 10);
const DEFAULT_ACTIONS = Number.parseInt(process.env.E2E_STRESS_ACTIONS || '100', 10);

function createRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function pick(rng, items) {
  return items[Math.floor(rng() * items.length)];
}

function intBetween(rng, min, max) {
  return Math.floor(min + rng() * (max - min + 1));
}

async function physicalTap(page, x, y, delayMs = 45) {
  await tapAt(page, x, y, delayMs);
}

const { seedCookieConsent } = require('./helpers/cookies');
const { expectMiniBarInteractive } = require('./helpers/playerGestureAssert');

const MINI_PLAY = '[data-testid="mini-player-play"]';

async function getState(page) {
  return await page.evaluate(({ modalSelector, miniSelector, trackSelector, playingSelector }) => {
    const modal = document.querySelector(modalSelector);
    const mini = document.querySelector(miniSelector);
    const trackIndex = document.querySelector(trackSelector)?.textContent?.trim() || '';
    const isPlaying = document.querySelector(playingSelector)?.textContent?.trim() || '';
    const activeElement = document.activeElement;
    const modalRect = modal?.getBoundingClientRect?.();
    const miniRect = mini?.getBoundingClientRect?.();

    return {
      modalVisible: Boolean(modal && modalRect && modalRect.width > 0 && modalRect.height > 0),
      miniVisible: Boolean(mini && miniRect && miniRect.width > 0 && miniRect.height > 0),
      trackIndex,
      isPlaying,
      bodyOverflow: document.body.style.overflow || '',
      activeTag: activeElement?.tagName || '',
      activeText: activeElement?.textContent?.trim()?.slice(0, 80) || '',
      url: window.location.pathname,
    };
  }, {
    modalSelector: MODAL,
    miniSelector: MINI_BAR,
    trackSelector: TRACK_INDEX,
    playingSelector: IS_PLAYING,
  });
}

async function assertStable(page, actionLog, actionNumber) {
  const root = page.locator('#root');
  await expect(root, `#root missing after action ${actionNumber}`).toBeAttached();

  const playgroundRoot = page.locator('[data-testid="playground-root"]');
  await expect(playgroundRoot, `playground missing after action ${actionNumber}`).toBeAttached();

  const miniBar = page.locator(MINI_BAR);
  await expect(miniBar, `mini-bar missing after action ${actionNumber}`).toBeAttached();

  const state = await getState(page);
  actionLog[actionLog.length - 1].after = state;

  expect(state.url, `URL changed after action ${actionNumber}`).toBe('/playground/mobile-player');
  expect(state.miniVisible || state.modalVisible, `player UI disappeared after action ${actionNumber}`).toBe(true);
}

/**
 * Playground dismiss: header band (gestures.spec #4) — CDP touch reliably hits MODAL_DISMISS.
 * Real homepage album dismiss lives in player-gestures-contract.spec.js.
 */
async function modalDismissSwipe(page, rng) {
  const box = await page.evaluate((selector) => {
    const modal = document.querySelector(selector);
    if (!modal) return null;
    const rect = modal.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
  }, MODAL);
  if (!box) return false;
  const x = Math.round(box.x + box.width * (0.38 + rng() * 0.24));
  const y = Math.round(box.y + intBetween(rng, 82, 110));
  const endY = y + intBetween(rng, 420, 500);
  await swipe(page, x, y, x + intBetween(rng, -14, 14), endY, intBetween(rng, 260, 360));
  return true;
}

async function waitModalSettledAtTop(page) {
  const modal = page.locator(MODAL);
  if (!(await modal.isVisible().catch(() => false))) return;
  await expect.poll(async () => {
    const box = await modal.boundingBox();
    return box ? Math.round(box.y) : 999;
  }, { timeout: 3_000, intervals: [80, 120, 180, 240] }).toBeLessThanOrEqual(12);
}

/** Multi-path dismiss after chaotic gestures (CDP header + album drag + close btn). */
async function forceDismissModal(page, rng) {
  const modal = page.locator(MODAL);
  if (!(await modal.isVisible().catch(() => false))) return;

  await waitModalSettledAtTop(page).catch(() => undefined);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await modalDismissSwipe(page, rng);
    await page.waitForTimeout(220);
    if (!(await modal.isVisible().catch(() => false))) return;
  }

  const album = page.locator(ALBUM);
  if (await album.isVisible().catch(() => false)) {
    await pointerDragOn(page, album, 0, 420, 300, 'touch').catch(() => undefined);
    await page.waitForTimeout(280);
    if (!(await modal.isVisible().catch(() => false))) return;
  }

  const closeButton = page.locator(`${MODAL} button`).first();
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click({ timeout: 2_000 }).catch(() => undefined);
    await page.waitForTimeout(200);
  }
}

async function modalJitterSwipe(page, rng) {
  const box = await page.evaluate((selector) => {
    const modal = document.querySelector(selector);
    if (!modal) return null;
    const rect = modal.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
  }, MODAL);
  if (!box) return false;
  const x = Math.round(box.x + box.width * (0.25 + rng() * 0.5));
  const y = Math.round(box.y + intBetween(rng, 120, 420));
  await swipe(
    page,
    x,
    y,
    x + intBetween(rng, -80, 80),
    y + intBetween(rng, -80, 120),
    intBetween(rng, 80, 220),
  );
  return true;
}

async function miniSwipeFromCarouselOverlap(page, rng) {
  const mini = page.locator(MINI_BAR);
  const box = await mini.boundingBox();
  if (!box) return false;
  const startX = Math.round(box.x + box.width * (0.18 + rng() * 0.64));
  const startY = Math.round(box.y + box.height * (0.35 + rng() * 0.3));
  const endX = startX + intBetween(rng, -40, 40);
  const endY = Math.max(40, startY - intBetween(rng, 170, 520));
  await swipe(page, startX, startY, endX, endY, intBetween(rng, 120, 360));
  return true;
}

async function carouselSwipeNearMini(page, rng) {
  const carousel = page.locator(FAKE_CAROUSEL);
  const box = await carousel.boundingBox();
  if (!box) return false;
  const y = Math.round(box.y + box.height * (0.25 + rng() * 0.5));
  const x = Math.round(box.x + box.width * (0.25 + rng() * 0.5));
  await swipe(page, x, y, x + intBetween(rng, -260, 260), y + intBetween(rng, -35, 35), intBetween(rng, 120, 320));
  return true;
}

async function closeModalIfVisible(page) {
  const modal = page.locator(MODAL);
  if (!(await modal.isVisible().catch(() => false))) return;

  await page.waitForTimeout(350);
  await forceDismissModal(page, () => 0.5);
  await expect(modal).not.toBeVisible({ timeout: 8_000 });
  await expectMiniBarInteractive(page);
}

async function ensureModalOpen(page) {
  const modal = page.locator(MODAL);
  if (await modal.isVisible().catch(() => false)) return;
  await realisticTap(page, page.locator(MINI_BAR));
  await expect(modal).toBeVisible({ timeout: 2_000 });
}

async function runAction(page, rng, action) {
  switch (action.kind) {
    case 'mini-tap':
      await closeModalIfVisible(page);
      await realisticTap(page, page.locator(MINI_BAR));
      return;
    case 'mini-double-tap':
      await closeModalIfVisible(page);
      {
        const box = await page.locator(MINI_BAR).boundingBox();
        if (!box) return;
        const x = Math.round(box.x + box.width / 2);
        const y = Math.round(box.y + box.height / 2);
        await physicalTap(page, x, y);
        await page.waitForTimeout(intBetween(rng, 20, 90));
        await physicalTap(page, x, y);
      }
      return;
    case 'mini-open-swipe':
      await closeModalIfVisible(page);
      await pointerSwipeOn(page, page.locator(MINI_BAR), intBetween(rng, -35, 35), -intBetween(rng, 120, 360), intBetween(rng, 120, 300));
      return;
    case 'mini-short-jitter':
      await closeModalIfVisible(page);
      await pointerSwipeOn(page, page.locator(MINI_BAR), intBetween(rng, -35, 35), intBetween(rng, -35, 35), intBetween(rng, 50, 150));
      return;
    case 'mini-horizontal-left':
      await closeModalIfVisible(page);
      await pointerSwipeOn(page, page.locator(MINI_BAR), -intBetween(rng, 90, 230), intBetween(rng, -20, 20), intBetween(rng, 120, 260));
      return;
    case 'mini-horizontal-right':
      await closeModalIfVisible(page);
      await pointerSwipeOn(page, page.locator(MINI_BAR), intBetween(rng, 90, 230), intBetween(rng, -20, 20), intBetween(rng, 120, 260));
      return;
    case 'mini-diagonal-open-left':
      await closeModalIfVisible(page);
      await pointerSwipeOn(page, page.locator(MINI_BAR), -intBetween(rng, 45, 135), -intBetween(rng, 130, 360), intBetween(rng, 120, 330));
      return;
    case 'mini-diagonal-open-right':
      await closeModalIfVisible(page);
      await pointerSwipeOn(page, page.locator(MINI_BAR), intBetween(rng, 45, 135), -intBetween(rng, 130, 360), intBetween(rng, 120, 330));
      return;
    case 'mini-down-cancel':
      await closeModalIfVisible(page);
      await pointerSwipeOn(page, page.locator(MINI_BAR), intBetween(rng, -25, 25), intBetween(rng, 40, 160), intBetween(rng, 100, 260));
      return;
    case 'mini-over-carousel':
      await closeModalIfVisible(page);
      await miniSwipeFromCarouselOverlap(page, rng);
      return;
    case 'carousel-horizontal':
      await closeModalIfVisible(page);
      await carouselSwipeNearMini(page, rng);
      return;
    case 'play-button-tap':
      await closeModalIfVisible(page);
      await realisticTap(page, page.locator(MINI_PLAY));
      return;
    case 'open-close-immediate':
      await closeModalIfVisible(page);
      await realisticTap(page, page.locator(MINI_BAR));
      await expect(page.locator(MODAL)).toBeVisible({ timeout: 2_000 });
      await page.waitForTimeout(intBetween(rng, 550, 900));
      await forceDismissModal(page, rng);
      await expect(page.locator(MODAL)).not.toBeVisible({ timeout: 8_000 });
      await expectMiniBarInteractive(page);
      await realisticTap(page, page.locator(MINI_BAR));
      return;
    case 'modal-dismiss':
      await ensureModalOpen(page);
      await page.waitForTimeout(intBetween(rng, 300, 850));
      await modalDismissSwipe(page, rng);
      return;
    case 'modal-jitter':
      await ensureModalOpen(page);
      await modalJitterSwipe(page, rng);
      return;
    default:
      throw new Error(`Unknown stress action: ${action.kind}`);
  }
}

function createActions(rng, count) {
  const kinds = [
    'mini-tap',
    'mini-double-tap',
    'mini-open-swipe',
    'mini-short-jitter',
    'mini-horizontal-left',
    'mini-horizontal-right',
    'mini-diagonal-open-left',
    'mini-diagonal-open-right',
    'mini-down-cancel',
    'mini-over-carousel',
    'carousel-horizontal',
    'play-button-tap',
    'open-close-immediate',
    'modal-dismiss',
    'modal-jitter',
  ];

  return Array.from({ length: count }, (_, index) => ({
    number: index + 1,
    kind: pick(rng, kinds),
  }));
}

test.describe('Mobile-player gesture stress', () => {
  test('100 кривых быстрых пользовательских сценариев не ломают плеер', async ({ page }, testInfo) => {
    const seed = Number.isFinite(DEFAULT_SEED) ? DEFAULT_SEED : 20260525;
    const count = Number.isFinite(DEFAULT_ACTIONS) ? Math.max(1, DEFAULT_ACTIONS) : 100;
    const rng = createRng(seed);
    const actions = createActions(rng, count);
    const actionLog = [];

    // Реальный touch (CDP dispatch + per-step delay) дороже mouse по wall-clock,
    // поэтому бюджет на действие выше. Ассерты стабильности при этом не меняются.
    test.setTimeout(Math.max(180_000, count * 4_500));

    const consoleErrors = [];
    page.on('pageerror', (err) => {
      consoleErrors.push({ type: 'pageerror', message: err.message });
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push({ type: 'console', message: msg.text() });
      }
    });

    await seedCookieConsent(page);
    await page.goto(PLAYGROUND_URL);
    await expect(page.locator(MINI_BAR)).toBeVisible({ timeout: 10_000 });

    for (const action of actions) {
      const before = await getState(page);
      actionLog.push({ ...action, before });

      try {
        await runAction(page, rng, action);
        await page.waitForTimeout(intBetween(rng, 60, 180));
        await assertStable(page, actionLog, action.number);
      } catch (err) {
        actionLog[actionLog.length - 1].error = err?.message || String(err);
        await testInfo.attach('stress-actions.json', {
          body: JSON.stringify({
            seed,
            count,
            failedAt: action.number,
            failedKind: action.kind,
            actionLog,
            consoleErrors,
          }, null, 2),
          contentType: 'application/json',
        });
        throw err;
      }
    }

    await testInfo.attach('stress-actions.json', {
      body: JSON.stringify({ seed, count, actionLog, consoleErrors }, null, 2),
      contentType: 'application/json',
    });

    const criticalErrors = consoleErrors.filter((entry) => {
      const text = String(entry.message || '');
      if (text.includes('/api/profile')) return false;
      if (text.includes("Unexpected token '<'")) return false;
      if (text.includes('Failed to load resource')) return false;
      return true;
    });

    expect(criticalErrors, `Critical browser errors:\n${JSON.stringify(criticalErrors, null, 2)}`).toEqual([]);
  });
});
