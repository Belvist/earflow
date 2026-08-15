import { slugifyForRoute } from './routeSlug';
import { getCanonicalOrigin } from './seo';

export function normalizeTrackPublicId(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  return /^[0-9a-f]{16}$/.test(raw) ? raw : null;
}

export function parseTrackRouteParam(raw) {
  const m = /^([0-9a-f]{16})(?:-(.*))?$/i.exec(String(raw ?? '').trim());
  if (m) return { kind: 'publicId', publicId: m[1].toLowerCase(), slug: m[2] || '' };
  const num = /^(\d+)(?:-.*)?$/.exec(String(raw ?? '').trim());
  return num ? { kind: 'numeric', id: Number(num[1]), slug: '' } : null;
}

// Единственный формат публичного маршрута трека (по образцу альбомов):
// /track/{public_id}-{slug}. Numeric serial id никогда не используется —
// см. docs/DECISIONS.md 2026-08-13 "Numeric track ID никогда не канонический".
export function buildTrackRoutePath(track) {
  if (!track || typeof track !== 'object') return null;
  const publicId = normalizeTrackPublicId(track.public_id ?? track.publicId);
  if (!publicId) return null;
  const title = String(track.title || '').trim();
  const artist = String(track.artist || '').trim();
  const slug = slugifyForRoute(artist && title ? `${artist} ${title}` : title || artist);
  return `/track/${publicId}${slug ? `-${encodeURIComponent(slug)}` : ''}`;
}

// Абсолютная canonical ссылка для шаринга (web `getCanonicalOrigin()`).
export function buildTrackShareUrl(track) {
  const path = buildTrackRoutePath(track);
  if (!path) return null;
  return `${getCanonicalOrigin()}${path}`;
}

// Если у объекта трека нет public_id (старая очередь/кэш), добираем его через
// authenticated GET /api/songs/:id (ответ содержит public_id) — как TrackPage
// для legacy numeric. Numeric-ссылка НИКОГДА не становится результатом.
export async function resolveTrackShareUrl(apiClient, track, params = {}) {
  const direct = buildTrackShareUrl(track);
  if (direct) return direct;
  if (!track || typeof track !== 'object') return null;
  const numericId = Number(track.id);
  if (!Number.isFinite(numericId) || numericId <= 0) return null;
  try {
    const data = await apiClient.request(`/api/songs/${numericId}`, { signal: params.signal });
    if (!data || typeof data !== 'object') return null;
    return buildTrackShareUrl({ ...track, public_id: data.public_id });
  } catch {
    return null;
  }
}
