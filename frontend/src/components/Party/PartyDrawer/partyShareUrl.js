/**
 * API отдаёт link вида /api/party/join/{token} — в буфер для друзей копируем ссылку на
 * веб‑приложение с ?partyInvite=… (см. PartyInviteDeepLinkHandler в App).
 * @param {string | null | undefined} apiPath — путь от createPartyInvite
 * @returns {string} токен для joinPartyByLink или ''
 */
export function extractJoinTokenFromApiPath(apiPath) {
  if (apiPath == null) return '';
  const s = String(apiPath).trim();
  if (!s) return '';
  const m = s.match(/\/api\/party\/join\/(.+)$/);
  if (m && m[1]) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  }
  return '';
}

/**
 * @param {string} joinToken
 * @returns {string} полный URL с текущим origin
 */
export function buildAppPartyInviteUrl(joinToken) {
  if (typeof window === 'undefined' || !joinToken) return '';
  const t = String(joinToken).trim();
  if (!t) return '';
  const u = new URL(window.location.href);
  u.searchParams.set('partyInvite', t);
  u.hash = '';
  return u.toString();
}
