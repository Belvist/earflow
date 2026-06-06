/** Max wait for Framer mini-bar track swipe — prevents permanent isAnimatingRef lock. */
export const MINI_TRACK_SWIPE_ANIMATION_MS = 1400;

export function withAnimationTimeout(promise, ms = MINI_TRACK_SWIPE_ANIMATION_MS) {
  if (!promise || typeof promise.then !== 'function') {
    return Promise.resolve();
  }
  return Promise.race([
    promise,
    new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    }),
  ]);
}
