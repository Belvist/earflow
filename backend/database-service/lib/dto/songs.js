function safeString(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    return String(v);
}

function safeNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function safeInt(v) {
    const n = safeNumber(v);
    if (n === null) return null;
    if (!Number.isInteger(n)) return null;
    return n;
}

function safeIsoDateString(v) {
    const s = safeString(v).trim();
    if (!s) return null;
    const t = Date.parse(s);
    if (!Number.isFinite(t)) return null;
    return new Date(t).toISOString();
}

function normalizeHasEbap(v) {
    return v === true || v === 1 || v === '1' || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

function toSongListCompactDto(song) {
    if (!song || typeof song !== 'object') return null;

    const id = safeInt(song.id);
    if (!id || id <= 0) return null;

    const duration = safeNumber(song.duration);

    return {
        id,
        title: safeString(song.title).trim(),
        artist: safeString(song.artist).trim(),
        album: safeString(song.album).trim(),
        duration: duration !== null ? duration : null,
        genre: safeString(song.genre).trim() || null,
        year: safeInt(song.year),
        cover_path: safeString(song.cover_path || song.coverPath || song.cover).trim() || null,
        has_ebap: normalizeHasEbap(song.has_ebap ?? song.hasEbap),
        updated_at: safeIsoDateString(song.updated_at ?? song.updatedAt),
        user_id: safeInt(song.user_id ?? song.userId ?? song.uploader_id ?? song.uploaderId),
    };
}

function mapSongListCompactDto(rows) {
    const items = Array.isArray(rows) ? rows : [];
    const out = [];
    for (const r of items) {
        const dto = toSongListCompactDto(r);
        if (dto) out.push(dto);
    }
    return out;
}

module.exports = {
    toSongListCompactDto,
    mapSongListCompactDto,
};
