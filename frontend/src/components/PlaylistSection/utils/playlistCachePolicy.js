/**
 * Ключ владельца для изоляции клиентского кэша сгенерированных плейлистов (без утечек между аккаунтами).
 *
 * @param {object | null | undefined} user
 * @returns {string} пустая строка, если владелец не определён
 */
export function getPlaylistCacheOwnerKey(user) {
  if (!user || typeof user !== 'object') return '';
  const id = user.id ?? user.userId;
  return id != null && id !== '' ? String(id) : '';
}
