/**
 * Touch / pointer input helpers для Playwright.
 *
 * Мобильные жесты диспатчатся как РЕАЛЬНЫЙ touch через CDP
 * (Input.dispatchTouchEvent): touchStart -> N x touchMove -> touchEnd.
 * Это даёт настоящие touchstart/touchmove/touchend и PointerEvents с
 * pointerType:"touch" — тот же путь, что у пальца на iOS/Android, включая
 * touch-action и конкуренцию с нативным скроллом.
 *
 * На контекстах без touch (desktop, hasTouch:false) автоматически
 * используется mouse-эмуляция.
 */

const cdpSessions = new WeakMap();
const touchCapability = new WeakMap();

async function getCdpSession(page) {
  let session = cdpSessions.get(page);
  if (!session) {
    session = await page.context().newCDPSession(page);
    cdpSessions.set(page, session);
  }
  return session;
}

async function pageHasTouch(page) {
  if (touchCapability.has(page)) return touchCapability.get(page);
  const hasTouch = await page.evaluate(() => (
    (typeof navigator !== 'undefined' && Number(navigator.maxTouchPoints) > 0)
    || (typeof window !== 'undefined' && 'ontouchstart' in window)
  ));
  touchCapability.set(page, hasTouch);
  return hasTouch;
}

async function touchSwipe(page, fromX, fromY, toX, toY, durationMs) {
  const steps = Math.max(8, Math.floor(durationMs / 16));
  const stepDelay = durationMs / steps;
  const session = await getCdpSession(page);

  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: fromX, y: fromY }],
  });

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: fromX + (toX - fromX) * t, y: fromY + (toY - fromY) * t }],
    });
    await page.waitForTimeout(stepDelay);
  }

  await session.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
}

async function mouseSwipe(page, fromX, fromY, toX, toY, durationMs) {
  const steps = Math.max(8, Math.floor(durationMs / 16));
  const stepDelay = durationMs / steps;

  await page.mouse.move(fromX, fromY);
  await page.mouse.down();

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(fromX + (toX - fromX) * t, fromY + (toY - fromY) * t);
    await page.waitForTimeout(stepDelay);
  }

  await page.mouse.up();
}

/**
 * Свайп от (fromX, fromY) к (toX, toY) за durationMs.
 * Реальный touch на touch-контексте, иначе mouse.
 */
async function swipe(page, fromX, fromY, toX, toY, durationMs = 250) {
  if (await pageHasTouch(page)) {
    await touchSwipe(page, fromX, fromY, toX, toY, durationMs);
    return;
  }
  await mouseSwipe(page, fromX, fromY, toX, toY, durationMs);
}

/**
 * Свайп по элементу: от центра элемента в направлении (dx, dy).
 */
/**
 * Pointer drag on element (desktop cover swipe) — dispatches pointer events to hit React handlers.
 */
async function pointerDragOn(page, locator, dx, dy, durationMs = 220, pointerType = 'mouse') {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('Element not visible - cannot get boundingBox');
  }
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const steps = Math.max(6, Math.floor(durationMs / 18));
  const stepDelay = durationMs / steps;
  const base = {
    pointerId: 1,
    pointerType,
    isPrimary: true,
    button: 0,
    bubbles: true,
  };
  await locator.dispatchEvent('pointerdown', {
    ...base,
    buttons: 1,
    clientX: startX,
    clientY: startY,
  });
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    await locator.dispatchEvent('pointermove', {
      ...base,
      buttons: 1,
      clientX: startX + dx * t,
      clientY: startY + dy * t,
    });
    await page.waitForTimeout(stepDelay);
  }
  await locator.dispatchEvent('pointerup', {
    ...base,
    buttons: 0,
    clientX: startX + dx,
    clientY: startY + dy,
  });
}

/**
 * Mini-bar sheet open in e2e — dispatches pointer events on the element so
 * setPointerCapture + gesture commit run reliably after page/rail scroll.
 * CDP touch alone can miss pointerup on the captured target (Playwright/Chromium).
 */
async function pointerSwipeOn(page, locator, dx, dy, durationMs = 220) {
  await pointerDragOn(page, locator, dx, dy, durationMs, 'touch');
}

async function swipeOn(page, locator, dx, dy, durationMs = 250) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('Element not visible - cannot get boundingBox');
  }
  const fromX = Math.round(box.x + box.width / 2);
  const fromY = Math.round(box.y + box.height / 2);
  await swipe(page, fromX, fromY, fromX + dx, fromY + dy, durationMs);
}

/**
 * Tap по координатам: touchStart -> задержка -> touchEnd (реальный touch),
 * иначе mouse down/up. Без движения = tap.
 */
async function tapAt(page, x, y, delayMs = 40) {
  if (await pageHasTouch(page)) {
    const session = await getCdpSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    if (delayMs > 0) await page.waitForTimeout(delayMs);
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return;
  }
  await page.mouse.move(x, y);
  await page.mouse.down();
  if (delayMs > 0) await page.waitForTimeout(delayMs);
  await page.mouse.up();
}

/**
 * Tap по центру элемента как реальный палец (touch) или мышь.
 */
async function realisticTap(page, locator) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('Element not visible - cannot get boundingBox');
  }
  await tapAt(page, Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2), 40);
}

/**
 * Быстрый flick: короткое расстояние, высокая скорость (короткий durationMs).
 * На mini-bar — pointer path (React capture), не CDP touch по координатам.
 */
async function flickOn(page, locator, dx, dy, durationMs = 90) {
  await pointerSwipeOn(page, locator, dx, dy, durationMs);
}

/** Horizontal track change on mini-bar — always pointer events on the bar element. */
async function miniBarTrackSwipe(page, locator, dx, durationMs = 180) {
  await pointerSwipeOn(page, locator, dx, 0, durationMs);
}

module.exports = {
  swipe,
  swipeOn,
  flickOn,
  realisticTap,
  tapAt,
  pointerDragOn,
  pointerSwipeOn,
  miniBarTrackSwipe,
};
