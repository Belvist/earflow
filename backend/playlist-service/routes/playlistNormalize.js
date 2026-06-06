const path = require('path');

function isSafeCoverFilename(filename) {
    const name = String(filename || '').trim();
    if (!name) return false;
    if (name.length > 200) return false;
    if (name === '.' || name === '..') return false;
    if (name.includes('/') || name.includes('\\')) return false;
    if (name.includes('..')) return false;
    return /^[A-Za-z0-9._-]+$/.test(name);
}

function normalizeCoverPathForClient(rawCoverPath) {
    const coverPath = (rawCoverPath || '').toString().trim();
    if (!coverPath) return null;
    if (coverPath.startsWith('http://') || coverPath.startsWith('https://')) {
        return coverPath;
    }
    const normalized = coverPath.replace(/\\/g, '/').replace(/^\/+/, '');
    const filename = path.basename(normalized);
    if (!isSafeCoverFilename(filename)) return null;
    return `/covers/${filename}`;
}

function normalizeSongForClient(song) {
    if (!song || typeof song !== 'object') return song;

    // СТРОГАЯ НОРМАЛИЗАЦИЯ: убираем все внутренние пути и системные метаданные.
    // Оставляем только то, что нужно для UI.
    return {
        id: song.id,
        title: song.title,
        artist: song.artist,
        album: song.album,
        duration: song.duration || song.durationSeconds || song.duration_seconds,
        genre: song.genre,
        year: song.year,
        cover_path: normalizeCoverPathForClient(song.cover_path || song.coverPath),
        has_ebap: !!(song.has_ebap || song.hasEbap)
    };
}

function normalizePlaylistForClient(playlist) {
    if (!playlist || typeof playlist !== 'object') return playlist;
    const normalized = { ...playlist };

    if (normalized.cover_path) {
        const cover = normalizeCoverPathForClient(normalized.cover_path);
        if (cover) normalized.cover_path = cover;
    }

    if (Array.isArray(normalized.tracks)) {
        normalized.tracks = normalized.tracks.map(normalizeSongForClient);
    }

    if (Array.isArray(normalized.preview_covers)) {
        normalized.preview_covers = normalized.preview_covers
            .map((c) => {
                if (!c || typeof c !== 'object') return c;
                const cover = normalizeCoverPathForClient(c.cover_path);
                return cover ? { ...c, cover_path: cover } : c;
            })
            .filter(Boolean);
    }

    if (!normalized.cover_path && Array.isArray(normalized.preview_covers) && normalized.preview_covers.length > 0) {
        const first = normalized.preview_covers[0];
        const fromPreview = first && typeof first === 'object' ? first.cover_path : null;
        if (fromPreview) {
            normalized.cover_path = fromPreview;
        }
    }

    return normalized;
}

module.exports = {
    normalizeCoverPathForClient,
    normalizeSongForClient,
    normalizePlaylistForClient,
};
