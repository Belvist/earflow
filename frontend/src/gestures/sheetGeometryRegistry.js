import {
  getPlayerSheetClosedY,
  getPlayerSheetHeight,
  progressToSheetY,
  yToSheetProgress,
} from '../utils/playerSheetPhysics';
import { MOBILE_CHROME_OFFSET_PX } from '../styles/mediaCover';

export const SHEET_GEOMETRY = Object.freeze({
  PLAYER: 'player-sheet',
  BOTTOM_PANEL: 'bottom-panel',
  PLAYER_DISMISS: 'player-dismiss',
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function getViewportHeight() {
  return getPlayerSheetHeight();
}

export function getMobileChromeOffsetPx() {
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const raw = window.getComputedStyle(document.documentElement).getPropertyValue('--mobile-chrome-height');
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return MOBILE_CHROME_OFFSET_PX;
}

export function getPlayerSheetGeometry(viewportHeight = getViewportHeight()) {
  const height = Math.max(1, Number(viewportHeight) || 1);
  const closedY = getPlayerSheetClosedY(height);
  return {
    id: SHEET_GEOMETRY.PLAYER,
    viewportHeight: height,
    openY: 0,
    closedY,
    progress: (y) => yToSheetProgress(y, height),
    yForProgress: (progress) => progressToSheetY(progress, height),
  };
}

export function getBottomSheetGeometry({
  viewportHeight = getViewportHeight(),
  bottomOffsetPx = 0,
  topInsetPx = 8,
  snapPoints = [0.6, 0.95],
} = {}) {
  const height = Math.max(1, Number(viewportHeight) || 1);
  const bottomOffset = Math.max(0, Number(bottomOffsetPx) || 0);
  const topInset = Math.max(0, Number(topInsetPx) || 0);
  const sheetHeight = Math.max(240, height - bottomOffset - topInset);
  const points = (Array.isArray(snapPoints) ? snapPoints : [])
    .map((point) => clamp(Number(point), 0.12, 0.98))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const normalizedSnapPoints = points.length > 0 ? points : [0.6, 0.95];
  const snapYs = normalizedSnapPoints.map((point) => Math.round(sheetHeight * (1 - point)));
  return {
    id: SHEET_GEOMETRY.BOTTOM_PANEL,
    viewportHeight: height,
    bottomOffsetPx: bottomOffset,
    topInsetPx: topInset,
    sheetHeight,
    hiddenY: sheetHeight,
    snapPoints: normalizedSnapPoints,
    snapYs,
  };
}

export function pickBottomSheetSnapTarget({
  currentY,
  velocityY,
  snapYs,
  hiddenY,
  closeThresholdPx = 80,
} = {}) {
  const hidden = Math.max(1, Number(hiddenY) || 1);
  const projected = (Number(currentY) || 0) + (Number(velocityY) || 0) * 0.15;
  const candidates = [...(Array.isArray(snapYs) ? snapYs : []), hidden];

  let best = candidates[0] ?? hidden;
  let bestDist = Infinity;
  for (const candidate of candidates) {
    const dist = Math.abs(candidate - projected);
    if (dist < bestDist) {
      best = candidate;
      bestDist = dist;
    }
  }

  const close = best >= hidden - Math.max(30, Number(closeThresholdPx) || 0);
  return {
    targetY: clamp(best, 0, hidden),
    close,
  };
}

export function subscribeSheetGeometryInvalidation(callback) {
  if (typeof window === 'undefined' || typeof callback !== 'function') return () => undefined;
  const viewport = window.visualViewport;
  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      callback();
    });
  };
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  viewport?.addEventListener?.('resize', schedule);
  viewport?.addEventListener?.('scroll', schedule);
  return () => {
    if (frame) {
      window.cancelAnimationFrame(frame);
      frame = 0;
    }
    window.removeEventListener('resize', schedule);
    window.removeEventListener('orientationchange', schedule);
    viewport?.removeEventListener?.('resize', schedule);
    viewport?.removeEventListener?.('scroll', schedule);
  };
}
