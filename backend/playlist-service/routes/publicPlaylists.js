const express = require('express');
const router = express.Router();
const db = require('../lib/database');
const { normalizePlaylistForClient } = require('./playlistNormalize');
const { optionalAuth } = require('../middleware/auth');

const LIBRARY_USER_ID = (() => {
    const n = Number.parseInt(String(process.env.LIBRARY_USER_ID || '1'), 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
})();

function parsePositiveInt(value) {
    const s = value === undefined || value === null ? '' : String(value).trim();
    if (!s || !/^\d+$/.test(s)) return null;
    const n = Number(s);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function parseNonNegativeInt(value) {
    const s = value === undefined || value === null ? '' : String(value).trim();
    if (!s || !/^\d+$/.test(s)) return null;
    const n = Number(s);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function canAccessSong(requestUserId, requestIsAdmin, song) {
    const reqId = parsePositiveInt(requestUserId);
    if (!song || typeof song !== 'object') return false;

    const ownerId = parsePositiveInt(song.user_id ?? song.userId ?? song.uploader_id ?? song.uploaderId);
    if (ownerId === LIBRARY_USER_ID) return true;

    if (!reqId) return false;
    if (requestIsAdmin === true) return true;
    if (ownerId && ownerId === reqId) return true;
    return false;
}

function filterTracksForViewer(tracks, viewerId, viewerIsAdmin) {
    const items = Array.isArray(tracks) ? tracks : [];
    return items.filter((t) => canAccessSong(viewerId, viewerIsAdmin, t));
}

router.get('/:slug', optionalAuth, async (req, res, next) => {
    try {
        const { slug } = req.params;

        const raw = (slug || '').toString().trim();
        if (!raw) {
            return res.status(400).json({ error: 'Некорректная ссылка' });
        }

        let playlist = null;
        if (/^[A-Za-z0-9]{32}$/.test(raw)) {
            playlist = await db.getPlaylistBySlug(raw);
        } else {
            return res.status(400).json({ error: 'Некорректная ссылка' });
        }

        if (!playlist) {
            return res.status(404).json({ error: 'Плейлист не найден' });
        }

        db.pool.query(
            'UPDATE playlists SET play_count = COALESCE(play_count, 0) + 1 WHERE id = $1',
            [playlist.id]
        ).catch(() => { });

        const limitRaw = parseNonNegativeInt(req.query.limit);
        const offsetRaw = parseNonNegativeInt(req.query.offset);
        const limit = Math.min((limitRaw && limitRaw > 0 ? limitRaw : 100), 500);
        const offset = offsetRaw ?? 0;
        const tracks = await db.getPlaylistTracks(playlist.id, { limit, offset });

        const viewerId = req.user && req.user.id ? parsePositiveInt(req.user.id) : null;
        const viewerIsAdmin = req.user && req.user.isAdmin === true;
        const filteredTracks = filterTracksForViewer(tracks, viewerId, viewerIsAdmin);

        const normalized = normalizePlaylistForClient(playlist);

        const isOwner = viewerId && Number.isFinite(viewerId) && viewerId > 0
            ? Number(viewerId) === Number(playlist.user_id)
            : false;

        res.json({
            ...normalized,
            tracks: filteredTracks,
            isOwner,
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
