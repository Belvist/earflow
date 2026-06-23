import {
  GESTURE_SURFACE,
  MINI_PLAYER_GESTURE_SURFACES,
  getGesturePriority,
} from './gestureContracts';

function isMiniPlayerSurface(surfaceId) {
  return MINI_PLAYER_GESTURE_SURFACES.includes(surfaceId);
}

/**
 * UIKit-style negotiation: whether `next` may replace `active` on the same pointerId.
 * Arbiter stores Map<pointerId, owner>; this module owns the policy graph.
 */
export function evaluateGestureClaim({ active, next }) {
  if (!active) {
    return { allowed: true, exclusive: resolveExclusive(next) };
  }
  if (active.pointerId !== next.pointerId) {
    return { allowed: true, exclusive: resolveExclusive(next) };
  }
  if (active.surfaceId === next.surfaceId) {
    return { allowed: true, exclusive: active.exclusive || resolveExclusive(next) };
  }
  if (next.allowSamePointerTransfer === true) {
    return { allowed: true, exclusive: active.exclusive || resolveExclusive(next) };
  }

  if (active.exclusive && isMiniPlayerSurface(active.surfaceId)) {
    if (isMiniPlayerSurface(next.surfaceId)) {
      return { allowed: true, exclusive: true };
    }
    return { allowed: false, reason: 'mini-exclusive-blocked' };
  }

  if ((next.priority ?? 0) > (active.priority ?? 0)) {
    return { allowed: true, exclusive: resolveExclusive(next) };
  }

  return { allowed: false, reason: 'lower-priority' };
}

export function resolveExclusive({ surfaceId, reason, exclusive }) {
  if (exclusive === true) return true;
  if (reason === 'pointer-down' && isMiniPlayerSurface(surfaceId)) return true;
  return false;
}

export function buildClaimPayload({
  surfaceId,
  pointerId,
  reason = 'intent-lock',
  allowSamePointerTransfer = false,
  exclusive = false,
}) {
  return {
    surfaceId,
    pointerId,
    priority: getGesturePriority(surfaceId),
    reason,
    allowSamePointerTransfer,
    exclusive,
  };
}

/** Surfaces that must not start when another pointer slot is unrelated (always allowed cross-pointer). */
export function surfacesAreIndependent(active, next) {
  return !active || active.pointerId !== next.pointerId;
}

export const GESTURE_TRANSFER_GROUPS = Object.freeze({
  MINI_PLAYER: MINI_PLAYER_GESTURE_SURFACES,
  SHEET_DRAG: Object.freeze([
    GESTURE_SURFACE.SHEET_HANDLE_DRAG,
    GESTURE_SURFACE.BOTTOM_SHEET,
  ]),
});
