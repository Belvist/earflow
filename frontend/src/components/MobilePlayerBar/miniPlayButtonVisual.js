/** Floating mini-bar layout tokens — sync with App.js and MobilePlayerBar.styles.js */
export const FLOATING_PLAY_SIZE_PX = 36;

export const FLOATING_SHELL_RADIUS_PX = 14;

export const FLOATING_PROGRESS_HEIGHT_PX = 2;
/** Match MiniPlayerContent horizontal padding — equal inset left/right */
export const FLOATING_PROGRESS_INSET_X_PX = 14;
export const FLOATING_PROGRESS_BOTTOM_PX = 0;

export function getFloatingProgressStyle(progressPercent) {
  return {
    '--progress': `${progressPercent}%`,
  };
}
