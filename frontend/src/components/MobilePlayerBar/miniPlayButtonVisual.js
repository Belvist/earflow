/** Floating mini-bar layout tokens — sync with App.js and MobilePlayerBar.styles.js */
export const FLOATING_PLAY_SIZE_PX = 36;

export const FLOATING_SHELL_RADIUS_PX = 14;

export const FLOATING_PROGRESS_HEIGHT_PX = 2;
/** Full-width progress along the mini-bar bottom edge */
export const FLOATING_PROGRESS_INSET_X_PX = 0;
export const FLOATING_PROGRESS_BOTTOM_PX = 0;

export function getFloatingProgressStyle(progressPercent) {
  return {
    '--progress': `${progressPercent}%`,
  };
}
