/**
 * Validates URLs acceptable for <img src> (defence-in-depth against exotic schemes).
 * Same-origin and API URLs are expected; blocks javascript:, vbscript:, etc.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isSafeImgSrcUrl(value) {
    if (typeof value !== 'string') return false;
    const s = value.trim();
    if (s.length === 0 || s.length > 8192) return false;
    if (s.startsWith('/')) return true;
    if (s.startsWith('data:image/')) return true;
    try {
        const base =
            typeof window !== 'undefined' && window.location
                ? window.location.href
                : 'https://invalid.local/';
        const u = new URL(s, base);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
}
