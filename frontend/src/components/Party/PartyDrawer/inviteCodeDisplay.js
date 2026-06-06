/**
 * Показ и копирование: стабильный формат `XXXX-XXXX`, без «разъезда» от пробелов/регистра.
 * (Ожидаемый backend: 8 буквенно-цифровых + дефис в UI.)
 * @param {unknown} raw
 * @returns {string}
 */
export function formatInviteCodeForDisplay(raw) {
  if (raw == null) return '';
  const s = String(raw).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (s.length === 0) return '';
  if (s.length <= 4) return s;
  if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4, 8)}`;
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
