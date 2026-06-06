/**
 * Same-origin cover URL for canvas / Image color sampling (CORS).
 * @param {string|null|undefined} url
 * @returns {string}
 */
export function toListenerSameOriginCoverUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';

  if (trimmed.startsWith('/')) return trimmed;

  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (parsed.pathname.startsWith('/covers/')) {
      return `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    return trimmed;
  }

  return trimmed;
}
