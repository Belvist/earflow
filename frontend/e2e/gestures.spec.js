/**
 * E2E тесты для жестов мобильного плеера.
 *
 * Тесты работают через ИЗОЛИРОВАННУЮ playground страницу
 * (/playground/mobile-player) с fake PlayerContext - НЕ нужен docker compose,
 * НЕ нужна авторизация, НЕ нужен реальный backend. Просто dev server и тесты.
 *
 * Что проверяется:
 *   1. Tap на mini-bar открывает плеер (фикс: tap не блокируется анимацией)
 *   2. Swipe вверх открывает плеер
 *   3. Swipe горизонтально переключает трек (10 раз - проверка надёжности)
 *   4. Close + immediate tap снова открывает (фикс: убран cooldown)
 *   5. Swipe начатый на mini-bar и прошедший над каруселью под ним - не теряется
 *      (фикс: setPointerCapture сразу в pointerdown)
 */
const { test, expect } = require('@playwright/test');
const { swipe, swipeOn, pointerSwipeOn, realisticTap } = require('./helpers/touch');
const { seedCookieConsent } = require('./helpers/cookies');

const PLAYGROUND_URL = '/playground/mobile-player';
const MINI_BAR = '[data-testid="mini-player-bar"]';
const MODAL = '[data-testid="mobile-player-modal"]';
const PLAYER_CHROME_ROOT = '#ef-player-chrome-root';
const TRACK_TITLE = '[data-testid="mini-player-track-title"]';
const TRACK_INDEX = '[data-testid="playground-track-index"]';

test.describe('Mini-player gestures', () => {
  test.beforeEach(async ({ page }) => {
    await seedCookieConsent(page);
    await page.goto(PLAYGROUND_URL);

    const miniBar = page.locator(MINI_BAR);
    await miniBar.waitFor({ state: 'visible', timeout: 10_000 });

    const miniBox = await miniBar.boundingBox();
    expect(miniBox, 'mini-bar boundingBox').toBeTruthy();
    expect(miniBox.height, 'mini-bar не должен быть гигантским').toBeLessThanOrEqual(56);
    expect(miniBox.height, 'mini-bar не должен схлопываться').toBeGreaterThanOrEqual(44);
  });

  test('0) Player chrome mounted in body portal (INV-SHEET-008)', async ({ page }) => {
    const inPortal = await page.evaluate(({ barSel, rootSel }) => {
      const bar = document.querySelector(barSel);
      const root = document.querySelector(rootSel);
      return Boolean(bar && root && root.contains(bar));
    }, { barSel: MINI_BAR, rootSel: PLAYER_CHROME_ROOT });
    expect(inPortal).toBe(true);
  });

  test('1) Tap на mini-bar открывает fullscreen player', async ({ page }) => {
    const modal = page.locator(MODAL);
    await expect(modal).not.toBeVisible();

    await realisticTap(page, page.locator(MINI_BAR));

    await expect(modal).toBeVisible({ timeout: 1_500 });
  });

  test('2) Swipe вверх на mini-bar открывает плеер', async ({ page }) => {
    const modal = page.locator(MODAL);
    await expect(modal).not.toBeVisible();

    await pointerSwipeOn(page, page.locator(MINI_BAR), 0, -180, 200);

    await expect(modal).toBeVisible({ timeout: 1_500 });
  });

  test('3) Swipe вправо 10 раз меняет трек каждый раз', async ({ page }) => {
    test.setTimeout(45_000);
    const indexLocator = page.locator(TRACK_INDEX);
    const initialIndex = await indexLocator.textContent();
    expect(initialIndex, 'playground должен показывать current track index').toBeTruthy();

    let lastIndex = initialIndex;
    let successCount = 0;

    for (let i = 0; i < 10; i++) {
      // Чередуем направления - чтобы не упереться в одну сторону (хоть и циклический)
      const direction = i % 2 === 0 ? -150 : 150;
      await pointerSwipeOn(page, page.locator(MINI_BAR), direction, 0, 180);

      try {
        await expect
          .poll(async () => await indexLocator.textContent(), {
            timeout: 2_000,
            intervals: [80, 160, 240, 400],
          })
          .not.toBe(lastIndex);
        successCount++;
        lastIndex = await indexLocator.textContent();
      } catch {
        // smooth fail - не вылетаем, считаем и продолжаем
      }

      // Пауза между жестами - track switch animation ~500мс + buffer
      await page.waitForTimeout(500);
    }

    expect(
      successCount,
      `Только ${successCount}/10 свайпов сменили трек. Ожидается 10/10.`,
    ).toBe(10);
  });

  test('4) Закрытие плеера + tap сразу - снова открывается (no cooldown)', async ({
    page,
  }) => {
    // 1. Открыть
    await realisticTap(page, page.locator(MINI_BAR));
    await expect(page.locator(MODAL)).toBeVisible({ timeout: 1_500 });
    await page.waitForTimeout(700);

    // 2. Закрыть свайпом вниз из верхней не-интерактивной зоны sheet
    const modalBox = await page.locator(MODAL).boundingBox();
    expect(modalBox, 'modal boundingBox должен быть доступен').toBeTruthy();
    const startX = Math.round(modalBox.x + modalBox.width / 2);
    const startY = Math.round(modalBox.y + 90);
    await swipe(page, startX, startY, startX, startY + 460, 300);
    await expect(page.locator(MODAL)).not.toBeVisible({ timeout: 3_500 });

    // 3. СРАЗУ tap (без задержки) - должен снова открыть
    await realisticTap(page, page.locator(MINI_BAR));
    await expect(page.locator(MODAL)).toBeVisible({ timeout: 1_500 });
  });

  test('5) Swipe вверх над каруселью под mini-bar - не теряется', async ({
    page,
  }) => {
    // Это критический тест нашего pointer capture fix.
    // Палец стартует на mini-bar и движется через playlist carousel под ним.
    // Если pointer capture работает - mini-bar должен получить весь gesture
    // и плеер должен открыться. Если нет - карусель украдёт pointer и плеер
    // не откроется.

    const modal = page.locator(MODAL);
    await expect(modal).not.toBeVisible();

    const miniBox = await page.locator(MINI_BAR).boundingBox();
    test.skip(!miniBox, 'mini-bar boundingBox недоступен');

    // Стартуем на mini-bar, заканчиваем сильно выше (свайп проходит через
    // область над mini-bar, где может быть карусель плейлистов).
    const startX = Math.round(miniBox.x + miniBox.width / 2);
    const startY = Math.round(miniBox.y + miniBox.height / 2);
    const endY = Math.max(50, startY - 400);

    await swipe(page, startX, startY, startX, endY, 250);

    await expect(modal).toBeVisible({ timeout: 1_500 });
  });

  test('5b) Частичный свайп вверх settle — open у top или closed, без mid-hang', async ({
    page,
  }) => {
    const modal = page.locator(MODAL);
    await expect(modal).not.toBeVisible();

    await pointerSwipeOn(page, page.locator(MINI_BAR), 0, -110, 170);
    await page.waitForTimeout(800);

    const visible = await modal.isVisible().catch(() => false);
    if (!visible) {
      await expect(modal).not.toBeVisible();
      return;
    }

    await expect.poll(async () => {
      const box = await modal.boundingBox();
      return box ? Math.round(box.y) : 999;
    }, {
      timeout: 2_500,
      intervals: [80, 160, 240, 320],
      message: 'modal после partial swipe должен доехать к y≈0 (open), не зависнуть посередине',
    }).toBeLessThanOrEqual(12);
  });

  test('6) После scroll страницы mini-bar всё ещё принимает tap и swipe', async ({
    page,
  }) => {
    await page.evaluate(() => {
      const root = document.querySelector('[data-testid="playground-root"]');
      if (root) root.style.minHeight = '240vh';
      document.documentElement.style.minHeight = '240vh';
      document.body.style.minHeight = '240vh';
      window.scrollTo(0, 900);
    });
    await expect.poll(async () => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);

    const miniBox = await page.locator(MINI_BAR).boundingBox();
    expect(miniBox, 'mini-bar boundingBox должен быть доступен после scroll').toBeTruthy();
    const hitsMiniBar = await page.evaluate(({ x, y }) => {
      const node = document.elementFromPoint(x, y);
      return Boolean(node?.closest?.('[data-testid="mini-player-bar"]'));
    }, {
      x: Math.round(miniBox.x + miniBox.width / 2),
      y: Math.round(miniBox.y + miniBox.height / 2),
    });
    expect(hitsMiniBar, 'elementFromPoint после scroll должен попадать в mini-player-bar').toBe(true);

    await realisticTap(page, page.locator(MINI_BAR));
    await expect(page.locator(MODAL)).toBeVisible({ timeout: 1_500 });

    await expect.poll(async () => page.evaluate((selector) => {
      const modal = document.querySelector(selector);
      const rect = modal?.getBoundingClientRect();
      return {
        bodyPosition: document.body.style.position || '',
        bodyTop: document.body.style.top || '',
        y: rect ? Math.round(rect.y) : null,
      };
    }, MODAL), {
      timeout: 2_000,
      intervals: [80, 120, 180, 240],
      message: 'modal должен settle в viewport top после scroll/body lock',
    }).toMatchObject({ y: 0 });

    const modalBox = await page.locator(MODAL).boundingBox();
    expect(modalBox, 'modal boundingBox должен быть доступен для dismiss').toBeTruthy();
    const startX = Math.round(modalBox.x + modalBox.width / 2);
    const startY = Math.round(modalBox.y + 90);
    await swipe(page, startX, startY, startX, startY + 460, 300);
    await expect(page.locator(MODAL)).not.toBeVisible({ timeout: 3_500 });

    await page.evaluate(() => window.scrollTo(0, 900));
    await expect.poll(async () => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    await pointerSwipeOn(page, page.locator(MINI_BAR), 0, -180, 200);
    await expect(page.locator(MODAL)).toBeVisible({ timeout: 1_500 });
  });

  test('7) Быстрый flick влево меняет трек (короткий travel + velocity)', async ({ page }) => {
    const indexLocator = page.locator(TRACK_INDEX);
    const before = await indexLocator.textContent();
    await pointerSwipeOn(page, page.locator(MINI_BAR), -120, 0, 85);
    await expect
      .poll(async () => await indexLocator.textContent(), { timeout: 2_000, intervals: [60, 120, 200, 360] })
      .not.toBe(before);
  });

  test('7b) Неполный горизонтальный свайп — mini не залипает, следующий меняет трек', async ({ page }) => {
    const indexLocator = page.locator(TRACK_INDEX);
    const mini = page.locator(MINI_BAR);
    await pointerSwipeOn(page, mini, -28, 4, 220);
    await page.waitForTimeout(250);
    const health = await page.evaluate(() => {
      const bar = document.querySelector('[data-testid="mini-player-bar"]');
      return {
        pointerEvents: bar ? getComputedStyle(bar).pointerEvents : '',
        sheetOpen: document.documentElement.getAttribute('data-player-sheet-open'),
      };
    });
    expect(health.pointerEvents).toBe('auto');
    expect(health.sheetOpen).toBeNull();
    const before = await indexLocator.textContent();
    await pointerSwipeOn(page, mini, -160, 0, 150);
    await expect
      .poll(async () => await indexLocator.textContent(), { timeout: 2_000, intervals: [80, 160] })
      .not.toBe(before);
  });

  test('7c) Неполный свайп вверх settle + mini снова принимает track swipe', async ({ page }) => {
    const indexLocator = page.locator(TRACK_INDEX);
    const mini = page.locator(MINI_BAR);
    await pointerSwipeOn(page, mini, 0, -55, 280);
    await page.waitForTimeout(700);
    const afterPartial = await page.evaluate(() => ({
      pointerEvents: getComputedStyle(document.querySelector('[data-testid="mini-player-bar"]')).pointerEvents,
      sheetOpen: document.documentElement.getAttribute('data-player-sheet-open'),
      modalY: document.querySelector('[data-testid="mobile-player-modal"]')?.getBoundingClientRect?.().y,
    }));
    expect(afterPartial.pointerEvents).toBe('auto');
    if (afterPartial.modalY != null && afterPartial.modalY < 400) {
      await expect.poll(async () => {
        const y = await page.locator(MODAL).evaluate((el) => el?.getBoundingClientRect?.().y ?? 999);
        return Math.round(y);
      }, { timeout: 2_500 }).toBeLessThanOrEqual(12);
    } else {
      expect(afterPartial.sheetOpen).toBeNull();
    }
    const before = await indexLocator.textContent();
    await pointerSwipeOn(page, mini, 160, 0, 140);
    await expect
      .poll(async () => await indexLocator.textContent(), { timeout: 2_000 })
      .not.toBe(before);
  });
});

test.describe('Smoke: app boots and renders', () => {
  test('homepage reaches terminal state without perpetual loading', async ({ page }) => {
    /**
     * Без моков API: React монтируется, но «вечный» loading — провал.
     * Допустимые финальные состояния: трек на главной, login-empty или error с текстом.
     */
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 });

    const homeRoot = page.locator('[data-testid="home-player-root"]');
    await expect(homeRoot).toBeVisible({ timeout: 12_000 });

    const queueLoading = page.locator('[data-testid="home-queue-loading"]');
    await expect
      .poll(async () => queueLoading.isVisible().catch(() => false), {
        timeout: 12_000,
        intervals: [200, 400, 800, 1200],
        message: 'Главная не должна зависать на home-queue-loading (проверьте auth/API)',
      })
      .toBe(false);

    const homeTitle = page.locator('[data-testid="home-track-title"]');
    const queueEmpty = page.locator('[data-testid="home-queue-empty"]');
    const queueError = page.locator('[data-testid="home-queue-error"]');
    const sectionsSkeleton = page.locator('[data-testid="home-sections-skeleton"]');

    await expect(sectionsSkeleton).toHaveCount(0, { timeout: 12_000 });

    const titleText = ((await homeTitle.textContent().catch(() => '')) || '').trim();
    const hasTrackTitle = titleText.length > 0;
    const hasGuestEmpty = await queueEmpty.isVisible().catch(() => false);
    const hasError = await queueError.isVisible().catch(() => false);

    expect(
      hasTrackTitle || hasGuestEmpty || hasError,
      'После загрузки главная должна показать трек, «Войдите» или ошибку API — не пустую серую пустоту',
    ).toBe(true);

    if (hasGuestEmpty) {
      await expect(page.locator('[data-testid="home-queue-empty"] h2')).toContainText('Войдите');
    }
    if (hasError) {
      await expect(page.locator('[data-testid="home-queue-error"] h2')).not.toBeEmpty();
    }
  });
});
