/**
 * Strict helpers for live https://earflow.ru e2e (no mocks).
 */
const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { acceptCookiesIfVisible } = require('./cookies');
const { pointerSwipeOn, realisticTap, pointerDragOn, swipe, swipeOn } = require('./touch');
const { expectMiniBarInteractive, readMiniInteractionHealth } = require('./playerGestureAssert');

const AUTH_FILE = path.join(__dirname, '..', '.auth', 'earflow-live.json');
const PLAYER_CHROME_ROOT = '#ef-player-chrome-root';

const SELECTORS = {
  MINI_BAR: '[data-testid="mini-player-bar"]',
  MINI_TITLE: '[data-testid="mini-player-track-title"]',
  MODAL: '[data-testid="mobile-player-modal"]',
  HOME_ROOT: '[data-testid="home-player-root"]',
  HOME_TITLE: '[data-testid="home-track-title"]',
  HOME_MOBILE_HERO: '[data-testid="home-mobile-hero-v3"]',
  HOME_MOBILE_LAYOUT: '[data-testid="home-mobile-layout-v3"]',
  HOME_COVER: '[data-testid="home-cover-top"]',
  PLAYLIST_RAIL: '[data-testid="home-playlist-rail"]',
  PLAYLIST_CARD: '[data-testid="home-playlist-card"]',
  QUEUE_LOADING: '[data-testid="home-queue-loading"]',
  BOTTOM_NAV_HOME: 'button:has-text("Главная")',
};

const LIVE_HOME_PATH = '/?gestureDebug=1';
const REPO_MINI_BAR_PATH = path.join(__dirname, '..', '..', 'src', 'components', 'MobilePlayerBar', 'index.js');
const SKIP_BUILD_GATE = process.env.E2E_LIVE_SKIP_BUILD === '1'
  || process.env.E2E_LIVE_SKIP_BUILD === 'true';
const TRACK_SWIPE_COUNT = Number.parseInt(process.env.E2E_LIVE_TRACK_SWIPES || '12', 10);
const TRACK_SWIPE_MIN_RATIO = Number.parseFloat(process.env.E2E_LIVE_TRACK_MIN_RATIO || '0.92');
const BURST_SWIPE_COUNT = Number.parseInt(process.env.E2E_LIVE_BURST_SWIPES || '20', 10);
const BURST_MIN_RATIO = Number.parseFloat(process.env.E2E_LIVE_BURST_MIN_RATIO || '0.85');
const MODAL_CYCLE_COUNT = Number.parseInt(process.env.E2E_LIVE_MODAL_CYCLES || '5', 10);

function readRepoBuildHint() {
  if (process.env.E2E_LIVE_MIN_BUILD) {
    return process.env.E2E_LIVE_MIN_BUILD;
  }
  try {
    const src = fs.readFileSync(REPO_MINI_BAR_PATH, 'utf8');
    const match = src.match(/data-mini-bar-ui="([^"]+)"/);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

function readExpectedBuildHint() {
  return readRepoBuildHint();
}

async function openLiveHome(page) {
  await page.goto(LIVE_HOME_PATH, { waitUntil: 'domcontentloaded' });
  await acceptCookiesIfVisible(page);
  await expect(page.locator(SELECTORS.HOME_ROOT)).toBeVisible({ timeout: 60_000 });
}

async function waitForLiveMiniPlayer(page, timeoutMs = 180_000) {
  await openLiveHome(page);
  await expect
    .poll(async () => page.locator(SELECTORS.QUEUE_LOADING).isVisible().catch(() => false), {
      timeout: 60_000,
      intervals: [500, 1000, 2000],
      message: 'Главная не должна вечно показывать home-queue-loading',
    })
    .toBe(false);
  await expect(page.locator(SELECTORS.MINI_BAR)).toBeVisible({ timeout: timeoutMs });
}

async function getTrackTitle(page) {
  const home = (await page.locator(SELECTORS.HOME_TITLE).textContent().catch(() => ''))?.trim() || '';
  if (home) return home;
  return (await page.locator(SELECTORS.MINI_TITLE).textContent().catch(() => ''))?.trim() || '';
}

async function readLiveDomState(page) {
  return page.evaluate(({ miniSel, modalSel, titleSel, miniTitleSel, chromeRootSel }) => {
    const mini = document.querySelector(miniSel);
    const modal = document.querySelector(modalSel);
    const homeTitle = document.querySelector(titleSel)?.textContent?.trim() || '';
    const miniTitle = document.querySelector(miniTitleSel)?.textContent?.trim() || '';
    const miniStyles = mini ? window.getComputedStyle(mini) : null;
    const modalRect = modal?.getBoundingClientRect?.();
    const miniRect = mini?.getBoundingClientRect?.();
    const chromeRoot = document.querySelector(chromeRootSel);
    const diag = window.__earflowGestureDiagnostics?.getSnapshot?.() || null;
    const claimRejected = (diag?.events || []).filter((e) => e.type === 'gesture:claim-rejected').length;
    const centerX = miniRect ? miniRect.x + miniRect.width / 2 : 0;
    const centerY = miniRect ? miniRect.y + miniRect.height / 2 : 0;
    const hitNode = miniRect ? document.elementFromPoint(centerX, centerY) : null;
    return {
      url: window.location.href,
      pathname: window.location.pathname,
      homeTitle,
      miniTitle,
      scrollY: window.scrollY,
      maxScrollY: Math.max(0, (document.scrollingElement?.scrollHeight || 0) - window.innerHeight),
      sheetOpenAttr: document.documentElement.getAttribute('data-player-sheet-open'),
      miniBarUi: mini?.dataset?.miniBarUi || '',
      miniPointerEvents: miniStyles?.pointerEvents || '',
      miniOpacity: miniStyles?.opacity || '',
      miniInlinePe: mini?.style?.pointerEvents || '',
      modalVisible: Boolean(modalRect && modalRect.height > 8),
      modalY: modalRect ? Math.round(modalRect.y) : null,
      buildHint: mini?.dataset?.miniBarUi || 'missing',
      inPortal: Boolean(mini && chromeRoot && chromeRoot.contains(mini)),
      hitInsideMini: Boolean(mini && hitNode && mini.contains(hitNode)),
      claimRejectedCount: claimRejected,
      gestureDiagnostics: diag,
    };
  }, {
    miniSel: SELECTORS.MINI_BAR,
    modalSel: SELECTORS.MODAL,
    titleSel: SELECTORS.HOME_TITLE,
    miniTitleSel: SELECTORS.MINI_TITLE,
    chromeRootSel: PLAYER_CHROME_ROOT,
  });
}

async function attachLiveState(page, testInfo, label = 'live-state') {
  const state = await readLiveDomState(page);
  if (testInfo) {
    await testInfo.attach(`${label}.json`, {
      body: JSON.stringify(state, null, 2),
      contentType: 'application/json',
    });
  }
  return state;
}

async function assertLiveSheetClosed(page, testInfo, label) {
  const state = await attachLiveState(page, testInfo, label);
  expect(state.sheetOpenAttr, `${label}: html must not keep data-player-sheet-open`).toBeNull();
  expect(state.modalVisible, `${label}: modal must not be visible`).toBe(false);
  expect(state.miniPointerEvents, `${label}: mini pointer-events`).toBe('auto');
  expect(state.hitInsideMini, `${label}: elementFromPoint must hit mini`).toBe(true);
  return state;
}

async function assertStrictBoot(page, testInfo) {
  const state = await attachLiveState(page, testInfo, 'strict-boot');
  expect(state.inPortal, 'mini-bar must live in #ef-player-chrome-root portal').toBe(true);
  expect(state.buildHint, 'mini-bar must expose data-mini-bar-ui build hint').not.toBe('missing');
  expect(state.miniPointerEvents).toBe('auto');
  expect(state.hitInsideMini).toBe(true);
  expect(state.sheetOpenAttr).toBeNull();
  return state;
}

/** Fails when prod CDN is behind local repo — deploy frontend, or use test:e2e:live:current */
async function assertDeployGate(page, testInfo) {
  const expected = readExpectedBuildHint();
  const state = await attachLiveState(page, testInfo, 'deploy-gate');
  if (!expected) {
    return state;
  }
  expect(
    state.buildHint,
    [
      'Prod build hint не совпадает с репозиторием.',
      `  prod: ${state.buildHint}`,
      `  repo: ${expected}`,
      '  → задеploy frontend image на earflow.ru',
      '  → или npm run test:e2e:live:current (жесты на текущем prod без gate)',
    ].join('\n'),
  ).toBe(expected);
  return state;
}

async function scrollPageToRatio(page, ratio) {
  await page.evaluate((r) => {
    const max = Math.max(0, (document.scrollingElement?.scrollHeight || 0) - window.innerHeight);
    window.scrollTo({ top: Math.round(max * r), behavior: 'instant' });
  }, ratio);
  if (ratio <= 0.05) {
    await expect.poll(async () => page.evaluate(() => window.scrollY), { timeout: 5_000 }).toBeLessThan(40);
    return;
  }
  await expect.poll(async () => page.evaluate(() => window.scrollY), { timeout: 5_000 }).toBeGreaterThan(40);
}

async function scrollHomeDiscover(page) {
  await scrollPageToRatio(page, 0.42);
  await expect(page.locator(SELECTORS.PLAYLIST_RAIL).first()).toBeVisible({ timeout: 8_000 });
}

async function scrubPlaylistRail(page, { railIndex = 0, swipes = 3 } = {}) {
  const rail = page.locator(SELECTORS.PLAYLIST_RAIL).nth(railIndex);
  await expect(rail).toBeVisible({ timeout: 8_000 });
  for (let i = 0; i < swipes; i += 1) {
    const dx = i % 2 === 0 ? -220 : 180;
    await swipeOn(page, rail, dx, 0, 200);
    await page.waitForTimeout(120);
  }
}

/**
 * Strict track swipe battery — fails test on first miss unless min ratio met at end.
 */
async function runTrackSwipeBattery(page, testInfo, {
  count = TRACK_SWIPE_COUNT,
  minRatio = TRACK_SWIPE_MIN_RATIO,
  pauseMs = 280,
  fast = false,
  label = 'track-battery',
} = {}) {
  const mini = page.locator(SELECTORS.MINI_BAR);
  const minSuccess = Math.ceil(count * minRatio);
  let last = await getTrackTitle(page);
  let success = 0;
  const misses = [];

  for (let i = 0; i < count; i += 1) {
    const dx = i % 2 === 0 ? -160 : 160;
    const duration = fast ? 95 : 150;
    await pointerSwipeOn(page, mini, dx, 0, duration);
    if (pauseMs > 0) await page.waitForTimeout(fast ? 90 : pauseMs);

    let changed = false;
    try {
      await expect
        .poll(async () => getTrackTitle(page), {
          timeout: fast ? 1_400 : 2_500,
          intervals: [60, 120, 200, 320],
        })
        .not.toEqual(last);
      changed = true;
      success += 1;
      last = await getTrackTitle(page);
    } catch {
      misses.push({ i, last, state: await readLiveDomState(page) });
      await attachLiveState(page, testInfo, `${label}-miss-${i}`);
    }

    if (i > 0 && i % 4 === 0) {
      await assertLiveSheetClosed(page, testInfo, `${label}-checkpoint-${i}`);
    }
  }

  expect(
    success,
    `${label}: ${success}/${count} track changes (need ≥${minSuccess}). Misses: ${JSON.stringify(misses.slice(0, 3))}`,
  ).toBeGreaterThanOrEqual(minSuccess);

  await expectMiniBarInteractive(page);
  return { success, count, misses };
}

async function dismissModalViaSwipe(page) {
  const modal = page.locator(SELECTORS.MODAL);
  await expect(modal).toBeVisible({ timeout: 4_000 });
  const box = await modal.boundingBox();
  expect(box, 'modal bbox for dismiss').toBeTruthy();
  await swipe(
    page,
    Math.round(box.x + box.width / 2),
    Math.round(box.y + 90),
    Math.round(box.x + box.width / 2),
    Math.round(box.y + 480),
    280,
  );
  await expect(modal).not.toBeVisible({ timeout: 6_000 });
  const state = await readLiveDomState(page);
  expect(state.sheetOpenAttr).toBeNull();
  expect(state.modalVisible).toBe(false);
  expect(state.miniPointerEvents).toBe('auto');
}

async function openModalViaMiniSwipeUp(page) {
  await pointerSwipeOn(page, page.locator(SELECTORS.MINI_BAR), 0, -190, 210);
  await expect(page.locator(SELECTORS.MODAL)).toBeVisible({ timeout: 4_000 });
  await expect.poll(async () => {
    const box = await page.locator(SELECTORS.MODAL).boundingBox();
    return box ? Math.round(box.y) : 999;
  }, { timeout: 4_000, intervals: [80, 160, 240] }).toBeLessThanOrEqual(16);
}

async function runModalOpenCloseCycles(page, testInfo, cycles = MODAL_CYCLE_COUNT) {
  for (let i = 0; i < cycles; i += 1) {
    await scrollPageToRatio(page, i % 2 === 0 ? 0.15 : 0.55);
    await assertLiveSheetClosed(page, testInfo, `modal-cycle-${i}-before`);

    await openModalViaMiniSwipeUp(page);
    await page.waitForTimeout(350);
    await dismissModalViaSwipe(page);

    await realisticTap(page, page.locator(SELECTORS.MINI_BAR));
    await expect(page.locator(SELECTORS.MODAL)).toBeVisible({ timeout: 3_000 });
    await dismissModalViaSwipe(page);

    await assertLiveSheetClosed(page, testInfo, `modal-cycle-${i}-after`);
  }
}

async function assertDiagnosticsClean(page, testInfo, { maxClaimRejected = 0 } = {}) {
  const state = await readLiveDomState(page);
  if (!state.gestureDiagnostics) {
    await testInfo.attach('gesture-diagnostics-missing.txt', {
      body: 'No __earflowGestureDiagnostics — deploy frontend with ?gestureDebug=1 support',
      contentType: 'text/plain',
    });
    return state;
  }
  expect(
    state.claimRejectedCount,
    `gesture:claim-rejected events: ${state.claimRejectedCount}`,
  ).toBeLessThanOrEqual(maxClaimRejected);
  return state;
}

async function runFreezeRegressionLive(page, testInfo) {
  await openLiveHome(page);
  await expect(page.locator(SELECTORS.MINI_BAR)).toBeVisible({ timeout: 30_000 });

  const cover = page.locator(SELECTORS.HOME_COVER);
  if (await cover.isVisible({ timeout: 2_000 }).catch(() => false)) {
    const before = await getTrackTitle(page);
    await pointerDragOn(page, cover, -180, 0, 220, 'touch');
    await expect
      .poll(async () => getTrackTitle(page), { timeout: 3_000 })
      .not.toEqual(before);
  }

  const waveform = page.locator(`${SELECTORS.HOME_MOBILE_HERO} [role="slider"]`);
  await expect(waveform).toBeVisible({ timeout: 5_000 });
  for (let i = 0; i < 6; i += 1) {
    await pointerDragOn(page, waveform, i % 2 === 0 ? 52 : -44, 0, 75, 'touch');
    await page.waitForTimeout(50);
  }

  await scrollHomeDiscover(page);
  await scrubPlaylistRail(page, { railIndex: 0, swipes: 2 });

  const { success } = await runTrackSwipeBattery(page, testInfo, {
    count: BURST_SWIPE_COUNT,
    minRatio: BURST_MIN_RATIO,
    fast: true,
    pauseMs: 70,
    label: 'freeze-burst',
  });

  await assertLiveSheetClosed(page, testInfo, 'freeze-after-burst');
  await assertDiagnosticsClean(page, testInfo, { maxClaimRejected: 0 });

  await realisticTap(page, page.locator(SELECTORS.MINI_BAR));
  await expect(page.locator(SELECTORS.MODAL)).toBeVisible({ timeout: 3_000 });
  await dismissModalViaSwipe(page);

  const before = await getTrackTitle(page);
  await pointerSwipeOn(page, page.locator(SELECTORS.MINI_BAR), 160, 0, 120);
  await expect.poll(async () => getTrackTitle(page), { timeout: 2_500 }).not.toEqual(before);

  return { burstSuccess: success };
}

async function navigatePlaylistAndReturnHome(page, testInfo) {
  await scrollHomeDiscover(page);
  const card = page.locator(SELECTORS.PLAYLIST_CARD).nth(1);
  await expect(card).toBeVisible({ timeout: 8_000 });
  const listen = card.getByRole('button', { name: 'Слушать' });
  await listen.click({ force: true, timeout: 8_000 });
  await page.waitForURL(/\/(playlist|playlists|album|track)/, { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(800);

  await page.locator(SELECTORS.BOTTOM_NAV_HOME).click({ timeout: 5_000 });
  await expect(page.locator(SELECTORS.HOME_ROOT)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(SELECTORS.MINI_BAR)).toBeVisible({ timeout: 15_000 });
  await attachLiveState(page, testInfo, 'after-playlist-nav');
}

module.exports = {
  AUTH_FILE,
  LIVE_HOME_PATH,
  SKIP_BUILD_GATE,
  readExpectedBuildHint,
  SELECTORS,
  PLAYER_CHROME_ROOT,
  openLiveHome,
  waitForLiveMiniPlayer,
  getTrackTitle,
  readLiveDomState,
  attachLiveState,
  assertLiveSheetClosed,
  assertStrictBoot,
  assertDeployGate,
  scrollPageToRatio,
  scrollHomeDiscover,
  scrubPlaylistRail,
  runTrackSwipeBattery,
  dismissModalViaSwipe,
  openModalViaMiniSwipeUp,
  runModalOpenCloseCycles,
  assertDiagnosticsClean,
  runFreezeRegressionLive,
  navigatePlaylistAndReturnHome,
  acceptCookiesIfVisible,
  pointerSwipeOn,
  realisticTap,
  pointerDragOn,
  swipe,
  swipeOn,
  expectMiniBarInteractive,
  readMiniInteractionHealth,
};
