export const PLAYER_SHEET = Object.freeze({
  open: 0,
  closedProgress: 0,
  openProgress: 1,
  snapOpenProgress: 0.42,
  fastOpenVelocity: -720,
  fastCloseVelocity: 760,
  minFlingTravelPx: 42,
  rubberBandConstant: 0.52,
  dragAttachProgress: 0.68,
  dragLateResistance: 0.42,
  dragOverPullResistance: 0.22,
  velocityInputMax: 2400,
  openVelocityOutputMax: 1180,
  closeVelocityOutputMax: 980,
  oppositeVelocityTransfer: 0.18,
  spring: Object.freeze({
    type: 'spring',
    stiffness: 350,
    damping: 36,
    mass: 0.92,
    restDelta: 0.5,
    restSpeed: 8,
  }),
  /** Faster settle when dismissing — sheet should not lag after finger-up. */
  closeSpring: Object.freeze({
    type: 'spring',
    stiffness: 480,
    damping: 42,
    mass: 0.78,
    restDelta: 0.5,
    restSpeed: 10,
  }),
  trackSpring: Object.freeze({
    type: 'spring',
    stiffness: 620,
    damping: 44,
    mass: 0.74,
  }),
  backgroundSpring: Object.freeze({
    stiffness: 190,
    damping: 31,
    mass: 1.12,
  }),
  contentSpring: Object.freeze({
    stiffness: 300,
    damping: 36,
    mass: 0.94,
  }),
  artworkSpring: Object.freeze({
    stiffness: 255,
    damping: 34,
    mass: 1.02,
  }),
  textSpring: Object.freeze({
    stiffness: 360,
    damping: 38,
    mass: 0.78,
  }),
});

export function getPlayerSheetHeight() {
  if (typeof window === 'undefined') return 800;
  return Math.max(
    1,
    window.visualViewport?.height || window.innerHeight || document.documentElement?.clientHeight || 800
  );
}

function getRootPxVariable(name, fallback) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return fallback;
  const raw = window.getComputedStyle(document.documentElement).getPropertyValue(name);
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function getPlayerSheetClosedY(viewportHeight = getPlayerSheetHeight()) {
  const height = Math.max(1, Number(viewportHeight) || 1);
  const bottomNavHeight = getRootPxVariable('--mobile-bottom-nav-height', 58);
  const miniPlayerHeight = getRootPxVariable('--mobile-mini-player-height', 52);
  const floatGap = getRootPxVariable('--mobile-mini-player-float-gap', 6);
  return Math.max(1, height - bottomNavHeight - floatGap - miniPlayerHeight);
}

export function clampSheetY(value, height = getPlayerSheetHeight()) {
  const closedY = getPlayerSheetClosedY(height);
  return Math.max(PLAYER_SHEET.open, Math.min(closedY, Number(value) || 0));
}

export function yToSheetProgress(y, height = getPlayerSheetHeight()) {
  const closedY = getPlayerSheetClosedY(height);
  return Math.max(0, Math.min(1, 1 - clampSheetY(y, height) / closedY));
}

export function progressToSheetY(progress, height = getPlayerSheetHeight()) {
  const closedY = getPlayerSheetClosedY(height);
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  return closedY * (1 - p);
}

export function rubberBandSheetY(y, height = getPlayerSheetHeight(), constant = PLAYER_SHEET.rubberBandConstant) {
  const h = Math.max(1, Number(height) || 1);
  const closedY = getPlayerSheetClosedY(h);
  const next = Number(y) || 0;
  const c = Math.max(0.01, Number(constant) || PLAYER_SHEET.rubberBandConstant);

  if (next < 0) {
    const overflow = Math.abs(next);
    return -((overflow * h * c) / (h + overflow * c));
  }

  if (next > closedY) {
    const overflow = next - closedY;
    return closedY + (overflow * h * c) / (h + overflow * c);
  }

  return next;
}

export function applySheetDragResistance(pullDistance, height = getPlayerSheetHeight()) {
  const h = Math.max(1, Number(height) || 1);
  const distance = Math.max(0, Number(pullDistance) || 0);
  const attachDistance = h * PLAYER_SHEET.dragAttachProgress;

  if (distance <= attachDistance) return distance;

  const lateDistance = Math.min(distance, h) - attachDistance;
  const resistedLateDistance = lateDistance * (1 - PLAYER_SHEET.dragLateResistance);
  const overPullDistance = Math.max(0, distance - h) * PLAYER_SHEET.dragOverPullResistance;
  return attachDistance + resistedLateDistance + overPullDistance;
}

export function sheetYForPullDistance(pullDistance, height = getPlayerSheetHeight()) {
  const closedY = getPlayerSheetClosedY(height);
  const distance = Math.max(0, Number(pullDistance) || 0);
  return rubberBandSheetY(closedY - distance, height);
}

export function shapeSheetVelocity(velocityY = 0, target = 'open') {
  const velocity = Number(velocityY) || 0;
  const isOpening = target === PLAYER_SHEET.open || target === 'open';
  const sameDirectionVelocity = isOpening ? Math.min(0, velocity) : Math.max(0, velocity);
  const oppositeVelocity = isOpening ? Math.max(0, velocity) : Math.min(0, velocity);
  const inputMax = PLAYER_SHEET.velocityInputMax;
  const outputMax = isOpening ? PLAYER_SHEET.openVelocityOutputMax : PLAYER_SHEET.closeVelocityOutputMax;
  const sameDirectionMagnitude = Math.min(Math.abs(sameDirectionVelocity), inputMax);
  const shapedMagnitude = outputMax * Math.tanh((sameDirectionMagnitude / inputMax) * (isOpening ? 1.25 : 1.05));
  const shapedSameDirection = Math.sign(sameDirectionVelocity) * shapedMagnitude;
  const shapedOpposite = oppositeVelocity * PLAYER_SHEET.oppositeVelocityTransfer;
  return shapedSameDirection + shapedOpposite;
}

export function shapeSheetSnapVelocity({ currentY = 0, targetY = PLAYER_SHEET.open, velocityY = 0 } = {}) {
  const current = Number(currentY) || 0;
  const target = Number(targetY) || PLAYER_SHEET.open;
  const velocity = Number(velocityY) || 0;
  const isOpening = target <= PLAYER_SHEET.open;

  if (isOpening && current <= PLAYER_SHEET.open && velocity < 0) return 0;
  if (!isOpening && current >= target && velocity > 0) return 0;

  return shapeSheetVelocity(velocity, isOpening ? 'open' : 'close');
}

export function choosePlayerSheetSnap({ y, velocityY = 0, height = getPlayerSheetHeight(), travelY = 0 } = {}) {
  const closedY = getPlayerSheetClosedY(height);
  const currentY = clampSheetY(y, height);
  const progress = yToSheetProgress(currentY, height);
  const velocity = Number(velocityY) || 0;
  const travel = Number(travelY) || 0;

  if (Math.abs(travel) >= PLAYER_SHEET.minFlingTravelPx) {
    if (velocity <= PLAYER_SHEET.fastOpenVelocity) return PLAYER_SHEET.open;
    if (velocity >= PLAYER_SHEET.fastCloseVelocity) return closedY;
    // Deliberate upward pull from mini-bar (moderate speed, large travel) — still open.
    if (travel < 0 && Math.abs(travel) >= Math.max(PLAYER_SHEET.minFlingTravelPx * 2, closedY * 0.2)) {
      return PLAYER_SHEET.open;
    }
  }

  return progress >= PLAYER_SHEET.snapOpenProgress ? PLAYER_SHEET.open : closedY;
}

/** Mini-bar vertical pull from closed anchor (dy < 0 = upward). */
export function dragYFromMiniPull(closedY, pullDy, viewportHeight) {
  return rubberBandSheetY(closedY + Number(pullDy || 0), viewportHeight);
}

export function shouldSnapOpen({ y, velocityY, height, travelY }) {
  return choosePlayerSheetSnap({ y, velocityY, height, travelY }) === PLAYER_SHEET.open;
}
