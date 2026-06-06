export const GESTURE_SURFACE = Object.freeze({
  SEEK: 'seek',
  PLAYLIST_REORDER: 'playlist-reorder',
  SHEET_HANDLE_DRAG: 'sheet-handle-drag',
  BOTTOM_SHEET: 'bottom-sheet',
  PLAYER_SHEET: 'player-sheet',
  MODAL_DISMISS: 'modal-dismiss',
  QUEUE_OVERLAY: 'queue-overlay',
  MINI_TRACK_SWIPE: 'mini-track-swipe',
  COVER_STACK: 'cover-stack',
  PLAYLIST_SCROLL: 'playlist-scroll',
  PAGE_SCROLL: 'page-scroll',
});

export const GESTURE_PRIORITY = Object.freeze({
  [GESTURE_SURFACE.SEEK]: 700,
  [GESTURE_SURFACE.PLAYLIST_REORDER]: 660,
  [GESTURE_SURFACE.SHEET_HANDLE_DRAG]: 650,
  [GESTURE_SURFACE.BOTTOM_SHEET]: 625,
  [GESTURE_SURFACE.PLAYER_SHEET]: 600,
  [GESTURE_SURFACE.MODAL_DISMISS]: 550,
  [GESTURE_SURFACE.QUEUE_OVERLAY]: 500,
  [GESTURE_SURFACE.MINI_TRACK_SWIPE]: 450,
  [GESTURE_SURFACE.COVER_STACK]: 440,
  [GESTURE_SURFACE.PLAYLIST_SCROLL]: 200,
  [GESTURE_SURFACE.PAGE_SCROLL]: 100,
});

export const GESTURE_STATE = Object.freeze({
  IDLE: 'IDLE',
  TRACKING: 'TRACKING',
  INTENT_LOCKED: 'INTENT_LOCKED',
  ACTIVE: 'ACTIVE',
  SETTLING: 'SETTLING',
  CANCELLED: 'CANCELLED',
});

export const GESTURE_DATA_ATTRIBUTE = Object.freeze({
  SURFACE: 'data-gesture-surface',
  NO_DRAG: 'data-gesture-no-drag',
  SHEET_NO_DRAG: 'data-sheet-no-drag',
  PLAYER_NO_DRAG: 'data-player-no-drag',
  MINI_NO_DRAG: 'data-mini-no-drag',
  QUEUE_SCROLL_AREA: 'data-queue-scrollarea',
});

export const GESTURE_CAPTURE_POLICY = Object.freeze({
  AFTER_INTENT_LOCK: 'after-intent-lock',
  IMMEDIATE: 'immediate',
  NEVER: 'never',
});

export function getGesturePriority(surfaceId) {
  return GESTURE_PRIORITY[surfaceId] ?? 0;
}

/** Surfaces owned by the mobile mini-bar gesture machine (sheet + track swipe). */
export const MINI_PLAYER_GESTURE_SURFACES = Object.freeze([
  GESTURE_SURFACE.PLAYER_SHEET,
  GESTURE_SURFACE.MINI_TRACK_SWIPE,
]);
