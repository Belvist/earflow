/**
 * Real-touch e2e для раскрывающихся поверхностей внутри full-screen плеера:
 *   - Queue panel (очередь): open -> expand -> collapse -> close (жесты по DragHandle)
 *   - Lyrics (текст): lyrics-mode переключает touch-action AlbumSection на auto
 *     и гейтит dismiss (свайп вниз не закрывает плеер пока открыт текст).
 *     Vertical dismiss с обложки — `useModalAlbumGestures` (см. player-gestures-contract.spec.js).
 *   - Device bottom-sheet: open (device sync включён) -> dismiss real-touch тапом
 *     по бэкдропу (handle-drag — Framer, см. PEND-GESTURE-001)
 *
 * Всё гоняется НАСТОЯЩИМ touch (CDP), тот же путь что палец на iOS/Android.
 */
const { test, expect } = require('@playwright/test');
const { swipe, swipeOn, pointerDragOn, realisticTap, tapAt } = require('./helpers/touch');
const { SELECTORS, openRealHomepage } = require('./helpers/realHomepage');

const { MINI_BAR, MODAL } = SELECTORS;
const QUEUE_BTN = '[title="Список треков"]';
const QUEUE_SCROLL = '[data-queue-scrollarea]';
const QUEUE_HANDLE = '[data-testid="queue-drag-handle"]';
const LYRICS_OPEN_BTN = '[title="Текст песни"]';
const LYRICS_CLOSE_BTN = '[title="Скрыть текст"]';
const MORE_BTN = '[title="Ещё"]';
const ALBUM = '[data-testid="player-album-section"]';
const SHEET = '[data-gesture-surface="bottom-sheet"]';

async function openModal(page) {
  await expect(page.locator(MINI_BAR)).toBeVisible({ timeout: 12_000 });
  await realisticTap(page, page.locator(MINI_BAR));
  await expect(page.locator(MODAL)).toBeVisible({ timeout: 2_000 });
  await expect
    .poll(
      async () =>
        page.evaluate((selector) => {
          const rect = document.querySelector(selector)?.getBoundingClientRect();
          return rect ? Math.round(rect.y) : null;
        }, MODAL),
      { timeout: 2_000, intervals: [80, 120, 180, 240] },
    )
    .toBe(0);
}

function readNumber(page, selector, prop) {
  return page.evaluate(
    ({ selector, prop }) => {
      const node = document.querySelector(selector);
      return node ? Number(node[prop] || 0) : -1;
    },
    { selector, prop },
  );
}

function readTouchAction(page, selector) {
  return page.evaluate((selector) => {
    const node = document.querySelector(selector);
    return node ? window.getComputedStyle(node).touchAction : '';
  }, selector);
}

test.describe('Real player modal surfaces (real touch)', () => {
  test('queue panel: open, expand, collapse, close via real-touch gestures', async ({ page }) => {
    await openRealHomepage(page, { trackCount: 30 });
    await openModal(page);

    await realisticTap(page, page.locator(QUEUE_BTN));
    await expect(page.locator(QUEUE_SCROLL)).toBeVisible({ timeout: 2_000 });
    await expect(page.getByRole('tab', { name: 'В очереди' })).toBeVisible({ timeout: 2_000 });

    // Даём шторке полностью раскрыться и зафиксироваться (слайд-ап анимация)
    await page.waitForTimeout(450);

    const handle = page.locator(QUEUE_HANDLE);
    const collapsedHeight = await readNumber(page, QUEUE_SCROLL, 'clientHeight');
    expect(collapsedHeight).toBeGreaterThan(0);

    // Жест expand/collapse/close идёт через DragHandle (touch-action: none),
    // а не через список (там touch-action: pan-y отдаёт вертикаль нативному скроллу).
    // 1) Свайп вверх по хэндлу раскрывает панель (60vh -> 90vh).
    await swipeOn(page, handle, 0, -300, 240);
    await expect
      .poll(async () => readNumber(page, QUEUE_SCROLL, 'clientHeight'), {
        timeout: 3_000,
        intervals: [150, 300, 500],
      })
      .toBeGreaterThan(collapsedHeight + 80);

    // 2) Свайп вниз по хэндлу сворачивает обратно к collapsed.
    await swipeOn(page, handle, 0, 300, 240);
    await expect
      .poll(async () => readNumber(page, QUEUE_SCROLL, 'clientHeight'), {
        timeout: 3_000,
        intervals: [150, 300, 500],
      })
      .toBeLessThan(collapsedHeight + 40);

    // 3) Ещё свайп вниз по хэндлу в collapsed закрывает панель.
    await swipeOn(page, handle, 0, 320, 240);
    await expect(page.locator(QUEUE_SCROLL)).toBeHidden({ timeout: 2_000 });
    await expect(page.locator(MODAL)).toBeVisible();
  });

  test('queue scroll handoff: dismiss blocked while scrolled, works at scrollTop 0', async ({ page }) => {
    await openRealHomepage(page, { trackCount: 30 });
    await openModal(page);

    await realisticTap(page, page.locator(QUEUE_BTN));
    await expect(page.locator(QUEUE_SCROLL)).toBeVisible({ timeout: 2_000 });
    await page.waitForTimeout(450);

    await page.evaluate((selector) => {
      const el = document.querySelector(selector);
      if (el) el.scrollTop = 96;
    }, QUEUE_SCROLL);
    await expect
      .poll(async () => readNumber(page, QUEUE_SCROLL, 'scrollTop'), { timeout: 2_000, intervals: [80, 160, 280] })
      .toBeGreaterThan(24);

    const modalBox = await page.locator(MODAL).boundingBox();
    const headerX = Math.round(modalBox.x + modalBox.width / 2);
    const headerY = Math.round(modalBox.y + 72);
    await swipe(page, headerX, headerY, headerX, headerY + 420, 300);
    await expect(page.locator(MODAL)).toBeVisible({ timeout: 1_000 });

    await page.evaluate((selector) => {
      const node = document.querySelector(selector);
      if (node) node.scrollTop = 0;
    }, QUEUE_SCROLL);
    await expect
      .poll(async () => readNumber(page, QUEUE_SCROLL, 'scrollTop'), { timeout: 2_000 })
      .toBe(0);

    const album = page.locator(ALBUM);
    const albumBox = await album.boundingBox();
    expect(albumBox).toBeTruthy();
    const ax = Math.round(albumBox.x + albumBox.width / 2);
    const ay = Math.round(albumBox.y + albumBox.height * 0.4);
    await pointerDragOn(page, album, 0, 420, 320, 'touch');
    await expect(page.locator(MODAL)).not.toBeVisible({ timeout: 4_500 });
  });

  test('lyrics: lyrics-mode flips album touch-action and gates dismiss', async ({ page }) => {
    await openRealHomepage(page);
    await openModal(page);

    // База (не lyrics): album gestures use touch-action none (H swipe + V dismiss down).
    await expect.poll(async () => readTouchAction(page, ALBUM), { timeout: 2_000 }).toBe('none');

    await realisticTap(page, page.locator(LYRICS_OPEN_BTN));
    // Lyrics mode: область отдаёт вертикаль нативному скроллу текста -> auto.
    await expect
      .poll(async () => readTouchAction(page, ALBUM), { timeout: 2_000, intervals: [80, 160, 280] })
      .toBe('auto');

    // Dismiss заблокирован пока открыт текст: свайп вниз НЕ закрывает плеер.
    const box = await page.locator(MODAL).boundingBox();
    const x = Math.round(box.x + box.width / 2);
    const y = Math.round(box.y + box.height * 0.45);
    await swipe(page, x, y, x, y + 360, 280);
    await expect(page.locator(MODAL)).toBeVisible();

    // Выход из lyrics возвращает touch-action none и dismiss работает.
    await realisticTap(page, page.locator(LYRICS_CLOSE_BTN));
    await expect
      .poll(async () => readTouchAction(page, ALBUM), { timeout: 2_000, intervals: [80, 160, 280] })
      .toBe('none');

    const box2 = await page.locator(MODAL).boundingBox();
    const x2 = Math.round(box2.x + box2.width / 2);
    const y2 = Math.round(box2.y + 90);
    await swipe(page, x2, y2, x2, y2 + 460, 300);
    await expect(page.locator(MODAL)).not.toBeVisible({ timeout: 3_500 });
  });

  test('device bottom-sheet: open and dismiss on real touch', async ({ page }) => {
    await openRealHomepage(page, { deviceSyncEnabled: true });
    await openModal(page);

    await realisticTap(page, page.locator(MORE_BTN));
    const deviceItem = page.getByText('Устройства', { exact: true });
    await expect(deviceItem).toBeVisible({ timeout: 2_000 });
    await realisticTap(page, deviceItem);

    await expect(page.locator(SHEET)).toBeVisible({ timeout: 2_000 });
    await expect(page.getByRole('heading', { name: 'Устройства' })).toBeVisible({ timeout: 2_000 });

    // Dismiss настоящим touch по бэкдропу (Overlay onTouchStart -> onClose).
    // Handle-drag BottomSheet — Framer drag (grandfathered arbiter-aware exception,
    // INV-FE-003); Framer recognizer не управляется CDP-touch, поэтому e2e проверяет
    // real-touch backdrop dismiss (см. docs/PENDING.md PEND-GESTURE-001).
    const viewport = page.viewportSize();
    await tapAt(page, Math.round((viewport?.width || 412) / 2), 40);

    await expect(page.locator(SHEET)).toBeHidden({ timeout: 2_000 });
    await expect(page.locator(MODAL)).toBeVisible();
  });
});
