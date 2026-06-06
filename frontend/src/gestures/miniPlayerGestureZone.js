import { MINI_PLAYER_GESTURE_SURFACES } from './gestureContracts';
import { getGlobalGestureArbiter } from './GestureArbiterProvider';

export { MINI_PLAYER_GESTURE_SURFACES };

const MINI_ZONE_SELECTOR = '[data-mini-gesture-zone]';
const MINI_BAR_SELECTOR = '[data-testid="mini-player-bar"]';
const MINI_ZONE_INSET_PX = 6;

export function isMiniPlayerGestureSurface(surfaceId) {
  return MINI_PLAYER_GESTURE_SURFACES.includes(surfaceId);
}

function getMiniBarElement() {
  if (typeof document === 'undefined') return null;
  return document.querySelector(MINI_ZONE_SELECTOR)
    || document.querySelector(MINI_BAR_SELECTOR);
}

export { getMiniBarElement };

export function isTargetInMiniPlayerGestureZone(target) {
  if (!target || typeof target.closest !== 'function') return false;
  return Boolean(target.closest(`${MINI_ZONE_SELECTOR}, ${MINI_BAR_SELECTOR}`));
}

export function isPointerInMiniPlayerGestureZone({ clientX, clientY, target } = {}) {
  if (isTargetInMiniPlayerGestureZone(target)) return true;
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
  const bar = getMiniBarElement();
  if (!bar || typeof bar.getBoundingClientRect !== 'function') return false;
  const rect = bar.getBoundingClientRect();
  const inset = MINI_ZONE_INSET_PX;
  return (
    clientX >= rect.left - inset
    && clientX <= rect.right + inset
    && clientY >= rect.top - inset
    && clientY <= rect.bottom + inset
  );
}

export function hasExclusiveMiniPlayerPointer(pointerId) {
  return getGlobalGestureArbiter().hasExclusiveMiniPointer?.(pointerId) === true;
}

/**
 * Non-mini surfaces must not start or steal when the touch belongs to the mini-bar zone
 * or the arbiter already holds an exclusive mini pointer.
 */
export function shouldDeferToMiniPlayerGesture({
  surfaceId,
  clientX,
  clientY,
  target,
  pointerId,
} = {}) {
  if (isMiniPlayerGestureSurface(surfaceId)) return false;
  if (hasExclusiveMiniPlayerPointer(pointerId)) return true;
  return isPointerInMiniPlayerGestureZone({ clientX, clientY, target });
}
