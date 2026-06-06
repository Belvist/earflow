const { normalizeCoverPathForClient } = require('../../routes/playlistNormalize');

function titleCase(input) {
    const s = (input || '').toString().trim();
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildPlaylist({ id, type, title, description, tracks, isFeatured }) {
    const safeTracks = Array.isArray(tracks) ? tracks.filter(Boolean) : [];
    const first = safeTracks[0];
    const rawCover = first && (first.cover_path || first.coverPath || first.cover);
    const coverUrl = rawCover ? normalizeCoverPathForClient(String(rawCover)) : null;

    return {
        id,
        type,
        title,
        description: description || '',
        coverUrl,
        tracks: safeTracks,
        trackCount: safeTracks.length,
        shareToken: null,
        isFeatured: Boolean(isFeatured),
    };
}

function buildRail({ id, title, description, playlists }) {
    return {
        id,
        title,
        description: description || '',
        playlists: Array.isArray(playlists) ? playlists : [],
    };
}

function buildGenreTitle(genre) {
    const g = (genre || '').toString().trim();
    return g ? `${titleCase(g)} Микс` : 'Жанровый микс';
}

module.exports = {
    buildPlaylist,
    buildRail,
    buildGenreTitle,
    titleCase,
};
