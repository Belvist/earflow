/** @returns {boolean} */
export function isCoarsePointerDevice() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 768px), (pointer: coarse)').matches;
}

/** @param {string} url */
export function isSameSiteUrl(url) {
  if (typeof window === 'undefined' || !url) return false;
  try {
    const target = new URL(url, window.location.href);
    return target.origin === window.location.origin;
  } catch {
    return false;
  }
}
