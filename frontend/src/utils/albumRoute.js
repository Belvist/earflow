import { slugifyForRoute } from './routeSlug';

function albumPublicIdFromTrack(track) {
  if (!track || typeof track !== 'object') return '';
  const raw = track.albumPublicId ?? track.album_public_id ?? '';
  return String(raw).trim().toLowerCase();
}

function albumNameFromTrack(track) {
  if (!track || typeof track !== 'object') return '';
  const raw = track.album ?? track.albumName ?? track.album_name ?? '';
  return String(raw).normalize('NFC').trim();
}

function artistFromTrack(track) {
  if (!track || typeof track !== 'object') return '';
  return String(track.artist || '').normalize('NFC').trim();
}

/**
 * Navigate to album page for a playing track (public id resolve or artist/name fallback).
 * @param {import('react-router-dom').NavigateFunction} navigate
 * @param {import('../api/client').default} apiClient
 * @param {object|null} track
 * @param {{ signal?: AbortSignal }} [params]
 */
export async function navigateToAlbumFromTrack(navigate, apiClient, track, params = {}) {
  if (!track || typeof navigate !== 'function') return;

  const artist = artistFromTrack(track);
  const albumName = albumNameFromTrack(track);
  const pid = albumPublicIdFromTrack(track);

  if (pid) {
    const slug = albumName ? slugifyForRoute(albumName) : '';
    navigate(`/album/${encodeURIComponent(pid)}${slug ? `-${encodeURIComponent(slug)}` : ''}`);
    return;
  }

  if (!artist || !albumName) return;

  try {
    const resolved = await apiClient.resolveAlbumPublicId(artist, albumName, { signal: params.signal });
    const resolvedPid = resolved && (resolved.albumPublicId || resolved.album_public_id)
      ? String(resolved.albumPublicId || resolved.album_public_id).trim().toLowerCase()
      : '';
    if (resolvedPid) {
      const slug = slugifyForRoute(albumName);
      navigate(`/album/${encodeURIComponent(resolvedPid)}${slug ? `-${encodeURIComponent(slug)}` : ''}`);
      return;
    }
  } catch {
    // fallback below
  }

  navigate(`/album/${encodeURIComponent(artist)}/${encodeURIComponent(albumName)}`);
}
