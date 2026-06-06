import { useEffect, useState } from 'react';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

let iosPermissionAsked = false;

/** @type {Set<(offset: { x: number, y: number }) => void>} */
const tiltSubscribers = new Set();
let sharedOffset = { x: 0, y: 0 };
let listenersAttached = false;

function applyOrientation(event) {
  if (event.gamma == null && event.beta == null) return;
  const gamma = Number(event.gamma) || 0;
  const beta = Number(event.beta) || 0;
  sharedOffset = {
    x: clamp(gamma / 32, -1, 1),
    y: clamp((beta - 42) / 32, -1, 1),
  };
  tiltSubscribers.forEach((notify) => notify(sharedOffset));
}

function attachTiltListeners() {
  if (listenersAttached || typeof window === 'undefined') return;
  listenersAttached = true;
  window.addEventListener('deviceorientation', applyOrientation, { passive: true });
  window.addEventListener('deviceorientationabsolute', applyOrientation, { passive: true });
}

function detachTiltListeners() {
  if (!listenersAttached || typeof window === 'undefined') return;
  listenersAttached = false;
  window.removeEventListener('deviceorientation', applyOrientation);
  window.removeEventListener('deviceorientationabsolute', applyOrientation);
}

function subscribeTilt(notify) {
  tiltSubscribers.add(notify);
  attachTiltListeners();
  notify(sharedOffset);
  return () => {
    tiltSubscribers.delete(notify);
    if (tiltSubscribers.size === 0) {
      detachTiltListeners();
      sharedOffset = { x: 0, y: 0 };
    }
  };
}

/**
 * iOS 13+: DeviceOrientation needs a user-gesture permission prompt.
 * Returns true when events may fire (granted or non-iOS).
 */
export async function requestDeviceTiltPermission() {
  if (typeof window === 'undefined') return false;
  const Orientation = window.DeviceOrientationEvent;
  if (!Orientation || typeof Orientation.requestPermission !== 'function') {
    return true;
  }
  if (iosPermissionAsked) return true;
  iosPermissionAsked = true;
  try {
    const state = await Orientation.requestPermission();
    return state === 'granted';
  } catch {
    return false;
  }
}

/**
 * Maps device tilt to [-1, 1] for metallic ring highlight.
 * Single window listener shared across all mounted metallic buttons.
 */
export default function useDeviceTiltGlare(enabled = true) {
  const [offset, setOffset] = useState(sharedOffset);

  useEffect(() => {
    if (!enabled) return undefined;
    return subscribeTilt(setOffset);
  }, [enabled]);

  return offset;
}
