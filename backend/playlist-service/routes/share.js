const express = require('express');
const router = express.Router();

const { normalizePlaylistForClient } = require('./playlistNormalize');
const { normalizeSongIds, computeFingerprint } = require('../lib/share/fingerprint');
const { validateTitle, validateDescription, validateSongIds } = require('../lib/share/validation');
const {
    findSharedPlaylistByFingerprint,
    fetchShareableSongs,
    createSharedPlaylist,
} = require('../lib/share/repository');

router.post('/', async (req, res, next) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(401).json({ error: 'Токен отсутствует' });
        }

        const rawUserId = String(req.user.id).trim();
        const userId = /^\d+$/.test(rawUserId) ? Number(rawUserId) : null;
        if (!userId || !Number.isSafeInteger(userId) || userId <= 0) {
            return res.status(401).json({ error: 'Некорректный токен' });
        }

        const { title, description, song_ids } = req.body || {};

        const titleErr = validateTitle(title);
        if (titleErr) return res.status(400).json({ error: titleErr });

        const descErr = validateDescription(description);
        if (descErr) return res.status(400).json({ error: descErr });

        const songIdsErr = validateSongIds(song_ids);
        if (songIdsErr) return res.status(400).json({ error: songIdsErr });

        const normalizedIds = normalizeSongIds(song_ids);
        if (normalizedIds.length < 1) return res.status(400).json({ error: 'Нет треков для шаринга' });
        if (normalizedIds.length > 200) return res.status(400).json({ error: 'Максимум 200 треков для шаринга' });

        const fingerprint = computeFingerprint({ userId, songIds: normalizedIds });

        const db = req.app.locals && req.app.locals.db;
        const pool = db && db.pool ? db.pool : null;
        if (!pool) {
            return res.status(503).json({ error: 'Сервис временно недоступен' });
        }

        const existing = await findSharedPlaylistByFingerprint(pool, { userId, fingerprint });
        if (existing && existing.share_slug) {
            return res.json(normalizePlaylistForClient(existing));
        }

        const { ordered } = await fetchShareableSongs(pool, { userId, songIds: normalizedIds });
        if (!ordered || ordered.length !== normalizedIds.length) {
            return res.status(403).json({ error: 'Нельзя шарить недоступные треки' });
        }

        const coverPath = ordered[0] && ordered[0].cover_path ? ordered[0].cover_path : null;

        const created = await createSharedPlaylist(pool, {
            userId,
            title: title.trim(),
            description: typeof description === 'string' ? description.trim() : null,
            songIds: normalizedIds,
            fingerprint,
            coverPath,
        });

        return res.status(201).json(normalizePlaylistForClient(created));
    } catch (e) {
        next(e);
    }
});

module.exports = router;
