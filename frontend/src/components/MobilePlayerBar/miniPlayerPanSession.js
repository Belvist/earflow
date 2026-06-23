/** Active mini-bar pan pointer (window stream). Used by sheet watchdog + rail guards. */
let activeMiniPanPointerId = null;

export function getActiveMiniPanPointerId() {
  return activeMiniPanPointerId;
}

export function setActiveMiniPanPointerId(pointerId) {
  activeMiniPanPointerId = pointerId ?? null;
}

export function clearActiveMiniPanPointerId(pointerId) {
  if (pointerId == null || activeMiniPanPointerId === pointerId) {
    activeMiniPanPointerId = null;
  }
}
