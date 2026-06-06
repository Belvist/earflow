import React, { createContext, useContext, useMemo } from 'react';
import { getGesturePriority, GESTURE_STATE, MINI_PLAYER_GESTURE_SURFACES } from './gestureContracts';
import { evaluateGestureClaim, resolveExclusive } from './gestureDelegates';
import { useExclusiveMiniTouchMoveGuard } from './useMiniPlayerNativeTouchGuard';
import { assertInteractionInvariant, recordInteractionEvent, updateInteractionState } from '../utils/interactionDiagnostics';

function ExclusiveMiniTouchGuard() {
  useExclusiveMiniTouchMoveGuard();
  return null;
}

function isMiniPlayerSurface(surfaceId) {
  return MINI_PLAYER_GESTURE_SURFACES.includes(surfaceId);
}

function createGestureArbiter() {
  /** @type {Map<number, object>} */
  const ownersByPointer = new Map();

  const getOwner = (pointerId) => {
    if (pointerId == null) return null;
    return ownersByPointer.get(pointerId) || null;
  };

  /**
   * @deprecated Prefer getOwner(pointerId). Returns the sole owner when exactly one pointer is active.
   */
  const getActiveOwner = ({ pointerId } = {}) => {
    if (pointerId != null) return getOwner(pointerId);
    if (ownersByPointer.size === 1) {
      return ownersByPointer.values().next().value;
    }
    return null;
  };

  const getActiveOwners = () => Array.from(ownersByPointer.values());

  const syncDiagnosticsOwner = () => {
    const owners = getActiveOwners();
    if (owners.length === 0) {
      updateInteractionState({
        owner: null,
        surfaceId: null,
        pointerId: null,
        state: GESTURE_STATE.IDLE,
      });
      return;
    }
    const primary = owners[owners.length - 1];
    updateInteractionState({
      owner: primary.surfaceId,
      surfaceId: primary.surfaceId,
      pointerId: primary.pointerId,
      state: GESTURE_STATE.ACTIVE,
      activePointerCount: owners.length,
    });
  };

  const tryClaim = ({
    surfaceId,
    pointerId,
    priority = getGesturePriority(surfaceId),
    reason = 'intent-lock',
    allowSamePointerTransfer = false,
    exclusive = false,
  } = {}) => {
    if (!surfaceId || pointerId == null) return false;

    const active = getOwner(pointerId);
    const next = {
      surfaceId,
      pointerId,
      priority,
      reason,
      allowSamePointerTransfer,
      exclusive,
      claimedAt: Date.now(),
    };

    const verdict = evaluateGestureClaim({ active, next });
    if (!verdict.allowed) {
      recordInteractionEvent('gesture:claim-rejected', {
        surfaceId,
        pointerId,
        reason,
        activeOwner: active?.surfaceId || null,
        delegateReason: verdict.reason || null,
      });
      return false;
    }

    next.exclusive = Boolean(
      verdict.exclusive ?? resolveExclusive({ surfaceId, reason, exclusive }),
    );

    ownersByPointer.set(pointerId, next);
    assertInteractionInvariant('pointer-slot-owner', verdict.allowed, {
      surfaceId,
      pointerId,
      previousOwner: active?.surfaceId || null,
    });
    recordInteractionEvent('gesture:claim', {
      surfaceId,
      pointerId,
      reason,
      exclusive: next.exclusive,
      previousOwner: active?.surfaceId || null,
    });
    syncDiagnosticsOwner();
    return true;
  };

  const release = ({ surfaceId, pointerId, reason = 'release' } = {}) => {
    if (pointerId == null) return false;
    const active = getOwner(pointerId);
    if (!active) return false;
    if (surfaceId && active.surfaceId !== surfaceId) return false;

    ownersByPointer.delete(pointerId);
    recordInteractionEvent('gesture:release', {
      surfaceId: active.surfaceId,
      pointerId: active.pointerId,
      reason,
    });
    syncDiagnosticsOwner();
    return true;
  };

  const releasePointer = (pointerId, reason = 'release-pointer') => {
    if (pointerId == null) return false;
    const active = getOwner(pointerId);
    if (!active) return false;
    ownersByPointer.delete(pointerId);
    recordInteractionEvent('gesture:release', {
      surfaceId: active.surfaceId,
      pointerId: active.pointerId,
      reason,
    });
    syncDiagnosticsOwner();
    return true;
  };

  const cancelOwner = (reasonOrPointerId = 'cancel-owner') => {
    if (typeof reasonOrPointerId === 'number') {
      return releasePointer(reasonOrPointerId, 'cancel-pointer');
    }

    const owners = getActiveOwners();
    ownersByPointer.clear();
    owners.forEach((active) => {
      recordInteractionEvent('gesture:owner-cancelled', {
        surfaceId: active.surfaceId,
        pointerId: active.pointerId,
        reason: reasonOrPointerId,
      });
    });
    updateInteractionState({
      owner: null,
      surfaceId: owners[0]?.surfaceId || null,
      pointerId: owners[0]?.pointerId || null,
      state: GESTURE_STATE.CANCELLED,
      cancelReason: reasonOrPointerId,
    });
    return owners.length > 0;
  };

  const releaseNonMiniOwner = (pointerId, reason = 'release-non-mini') => {
    const active = getOwner(pointerId);
    if (!active || isMiniPlayerSurface(active.surfaceId)) return false;
    return releasePointer(pointerId, reason);
  };

  /** Drop leaked mini claims from prior gestures (fixes intermittent “every other swipe”). */
  const releaseStaleMiniOwners = (exceptPointerId = null, reason = 'stale-mini') => {
    let released = 0;
    ownersByPointer.forEach((owner, pointerId) => {
      if (exceptPointerId != null && pointerId === exceptPointerId) return;
      if (!isMiniPlayerSurface(owner.surfaceId)) return;
      ownersByPointer.delete(pointerId);
      released += 1;
      recordInteractionEvent('gesture:release', {
        surfaceId: owner.surfaceId,
        pointerId: owner.pointerId,
        reason,
      });
    });
    if (released > 0) {
      syncDiagnosticsOwner();
    }
    return released > 0;
  };

  const isOwnedBy = ({ surfaceId, pointerId } = {}) => {
    const active = getOwner(pointerId);
    if (!active) return false;
    if (surfaceId && active.surfaceId !== surfaceId) return false;
    return true;
  };

  const hasExclusiveMiniPointer = (pointerId) => {
    if (pointerId != null) {
      const active = getOwner(pointerId);
      return Boolean(active?.exclusive && isMiniPlayerSurface(active.surfaceId));
    }
    return getActiveOwners().some(
      (owner) => owner.exclusive && isMiniPlayerSurface(owner.surfaceId),
    );
  };

  return {
    getOwner,
    getActiveOwner,
    getActiveOwners,
    tryClaim,
    release,
    releasePointer,
    releaseNonMiniOwner,
    releaseStaleMiniOwners,
    cancelOwner,
    isOwnedBy,
    hasExclusiveMiniPointer,
  };
}

const singletonArbiter = createGestureArbiter();
const GestureArbiterContext = createContext(singletonArbiter);

export function GestureArbiterProvider({ children }) {
  const value = useMemo(() => singletonArbiter, []);
  return (
    <GestureArbiterContext.Provider value={value}>
      <ExclusiveMiniTouchGuard />
      {children}
    </GestureArbiterContext.Provider>
  );
}

export function useGestureArbiter() {
  return useContext(GestureArbiterContext) || singletonArbiter;
}

export function getGlobalGestureArbiter() {
  return singletonArbiter;
}
