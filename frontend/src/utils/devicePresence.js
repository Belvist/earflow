/**
 * «Присутствие» в духе Spotify Connect: в списке остаются только устройства,
 * которые недавно отзывались (lastSeen) или ведут воспроизведение (isActive),
 * плюс это устройство (currentDeviceId).
 */
export const DEVICE_PRESENCE_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * @param {Array<{ id?: string, lastSeenAt?: number, isActive?: boolean }|null|undefined>} devices
 * @param {string|null|undefined} currentDeviceId
 * @param {number} [now=Date.now()]
 * @returns {Array}
 */
export function filterPresentDevices(devices, currentDeviceId, now = Date.now()) {
  const list = Array.isArray(devices) ? devices : [];
  const cur = typeof currentDeviceId === 'string' ? currentDeviceId.trim() : '';
  return list.filter((d) => isDevicePresent(d, cur || null, now));
}

/**
 * @param {object|null|undefined} d
 * @param {string|null} currentDeviceId
 * @param {number} [now=Date.now()]
 */
export function isDevicePresent(d, currentDeviceId, now = Date.now()) {
  if (!d || typeof d.id !== 'string' || d.id.length === 0) {
    return false;
  }
  if (currentDeviceId && d.id === currentDeviceId) {
    return true;
  }
  if (d.isActive) {
    return true;
  }
  const last = typeof d.lastSeenAt === 'number' ? d.lastSeenAt : 0;
  if (last <= 0) {
    return false;
  }
  return (now - last) <= DEVICE_PRESENCE_MAX_AGE_MS;
}
