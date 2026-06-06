/**
 * Shared hero chip labels (desktop + mobile home v3).
 * @param {object|null|undefined} track
 * @param {boolean} shouldShowReason
 * @returns {string[]}
 */
export function buildHomeHeroTags(track, shouldShowReason) {
  const tags = [];
  if (track?.reason && shouldShowReason) {
    const parts = String(track.reason).split(/[,;|•]/).map((s) => s.trim()).filter(Boolean);
    parts.slice(0, 3).forEach((p) => tags.push(p));
  }
  if (!tags.length) {
    tags.push('для тебя', 'в очереди');
  }
  return tags.slice(0, 3);
}
