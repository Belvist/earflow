import apiClient from '../../../api/client';

/**
 * Обложка карточки: сначала поле плейлиста, иначе — из первого трека (cover_path / coverPath / cover).
 *
 * @param {Record<string, unknown> | null | undefined} playlist
 * @returns {string | null}
 */
export function resolvePlaylistCoverUrl(playlist) {
    if (!playlist || typeof playlist !== 'object') return null;
    const direct = playlist.coverUrl ?? playlist.cover_url;
    if (typeof direct === 'string' && direct.trim().length > 0) {
        return direct.trim();
    }
    const tracks = Array.isArray(playlist.tracks) ? playlist.tracks : [];
    const first = tracks[0];
    if (!first || typeof first !== 'object') return null;
    return apiClient.getCoverUrl(first) || null;
}
