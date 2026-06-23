/**
 * Playlist Routes
 * CRUD operations for playlists and their tracks
 */

const express = require('express');
const router = express.Router();
const db = require('../lib/database');
const publicPlaylistsRoutes = require('./publicPlaylists');
const { normalizePlaylistForClient, normalizeSongForClient } = require('./playlistNormalize');

const LIBRARY_USER_ID = (() => {
    const n = Number.parseInt(String(process.env.LIBRARY_USER_ID || '1'), 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
})();

function parseStrictPositiveInt(value) {
    const s = value === undefined || value === null ? '' : String(value).trim();
    if (!s || !/^\d+$/.test(s)) return null;
    const n = Number(s);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function parsePositiveInt(value) {
    return parseStrictPositiveInt(value);
}

function canAccessSong(requestUserId, requestIsAdmin, song) {
    const reqId = parsePositiveInt(requestUserId);
    if (!reqId || !song || typeof song !== 'object') return false;
    if (requestIsAdmin === true) return true;

    const ownerId = parsePositiveInt(song.user_id ?? song.userId ?? song.uploader_id ?? song.uploaderId);
    if (ownerId && ownerId === reqId) return true;
    if (ownerId === LIBRARY_USER_ID) return true;
    return false;
}

function filterTracksForUser(tracks, requestUserId, requestIsAdmin) {
    const items = Array.isArray(tracks) ? tracks : [];
    return items.filter((t) => canAccessSong(requestUserId, requestIsAdmin, t));
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

function validatePlaylistName(name) {
    if (!name || typeof name !== 'string') {
        return 'Название плейлиста обязательно';
    }
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 100) {
        return 'Название должно быть от 1 до 100 символов';
    }
    return null;
}

function validateId(id, fieldName = 'ID') {
    const parsed = parseStrictPositiveInt(id);
    if (!parsed) {
        return `Некорректный ${fieldName}`;
    }
    return null;
}

// ============================================================================
// PUBLIC ENDPOINTS (без авторизации)
// ============================================================================

/**
 * GET /api/playlists/public/:slug
 * Получение публичного плейлиста по уникальной ссылке
 * Не требует авторизации!
 */
router.use('/public', publicPlaylistsRoutes);

// ============================================================================
// PLAYLIST CRUD
// ============================================================================

/**
 * GET /api/playlists
 * Get all playlists for current user
 */
router.get('/', async (req, res, next) => {
    try {
        const userId = req.user.id;
        const limitRaw = Number.parseInt(String(req.query.limit ?? ''), 10);
        const offsetRaw = Number.parseInt(String(req.query.offset ?? ''), 10);
        const limit = Math.min(Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 50, 100);
        const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;
        const includePublic = req.query.includePublic === 'true';

        const playlists = await db.getUserPlaylists(userId, { limit, offset, includePublic });
        const normalizedPlaylists = (Array.isArray(playlists) ? playlists : []).map(normalizePlaylistForClient);

        res.json({
            playlists: normalizedPlaylists,
            pagination: {
                limit,
                offset,
                count: normalizedPlaylists.length
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/playlists/user/:userId
 * Get playlists for user profile
 */
router.get('/user/:userId', async (req, res, next) => {
    try {
        const viewerId = req.user.id;
        const ownerId = parseStrictPositiveInt(req.params.userId);

        const idError = validateId(ownerId, 'ID пользователя');
        if (idError) {
            return res.status(400).json({ error: idError });
        }

        const limitRaw = Number.parseInt(String(req.query.limit ?? ''), 10);
        const offsetRaw = Number.parseInt(String(req.query.offset ?? ''), 10);
        const limit = Math.min(Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 50, 100);
        const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

        const playlists = await db.getPlaylistsByOwner(ownerId, viewerId, { limit, offset });
        const normalizedPlaylists = (Array.isArray(playlists) ? playlists : []).map(normalizePlaylistForClient);

        res.json({
            playlists: normalizedPlaylists,
            pagination: {
                limit,
                offset,
                count: normalizedPlaylists.length
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/playlists
 * Create a new playlist
 */
router.post('/', async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { name, description, cover_path, is_public } = req.body;

        // Validation
        const nameError = validatePlaylistName(name);
        if (nameError) {
            return res.status(400).json({ error: nameError });
        }

        if (description && description.length > 500) {
            return res.status(400).json({ error: 'Описание не может превышать 500 символов' });
        }

        const playlist = await db.createPlaylist(userId, {
            name: name.trim(),
            description: description?.trim() || null,
            is_public: is_public === true,
            cover_path: cover_path || null
        });

        res.status(201).json(normalizePlaylistForClient(playlist));
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/playlists/:id
 * Get single playlist with tracks
 */
router.get('/:id', async (req, res, next) => {
    try {
        const userId = req.user.id;
        const playlistId = parseStrictPositiveInt(req.params.id);

        const idError = validateId(playlistId, 'ID плейлиста');
        if (idError) return res.status(400).json({ error: idError });

        const playlist = await db.getPlaylistById(playlistId, userId);
        if (!playlist || playlist.user_id !== userId) {
            return res.status(404).json({ error: 'Плейлист не найден' });
        }

        const tracks = await db.getPlaylistTracks(playlistId, { limit: 1000, offset: 0 });
        const filteredTracks = filterTracksForUser(tracks, userId, req.user.isAdmin === true);
        const normalizedTracks = filteredTracks.map(normalizeSongForClient);

        res.json({
            ...normalizePlaylistForClient(playlist),
            tracks: normalizedTracks,
            songs: normalizedTracks, // Для совместимости с разными версиями фронта
            isOwner: true
        });
    } catch (error) {
        next(error);
    }
});

/**
 * PUT /api/playlists/:id
 * Update playlist metadata
 */
router.put('/:id', async (req, res, next) => {
    try {
        const userId = req.user.id;
        const playlistId = parseStrictPositiveInt(req.params.id);

        const idError = validateId(playlistId, 'ID плейлиста');
        if (idError) {
            return res.status(400).json({ error: idError });
        }

        const { name, description, cover_path } = req.body;

        // Validation
        if (name !== undefined) {
            const nameError = validatePlaylistName(name);
            if (nameError) {
                return res.status(400).json({ error: nameError });
            }
        }

        if (description && description.length > 500) {
            return res.status(400).json({ error: 'Описание не может превышать 500 символов' });
        }

        const updated = await db.updatePlaylist(playlistId, userId, {
            name: name?.trim(),
            description: description?.trim(),
            cover_path
        });

        if (!updated) {
            return res.status(404).json({ error: 'Плейлист не найден или недоступен' });
        }

        res.json(normalizePlaylistForClient(updated));
    } catch (error) {
        next(error);
    }
});

/**
 * DELETE /api/playlists/:id
 * Delete a playlist
 */
router.delete('/:id', async (req, res, next) => {
    try {
        const userId = req.user.id;
        const playlistId = parseStrictPositiveInt(req.params.id);

        const idError = validateId(playlistId, 'ID плейлиста');
        if (idError) {
            return res.status(400).json({ error: idError });
        }

        const deleted = await db.deletePlaylist(playlistId, userId);

        if (!deleted) {
            return res.status(404).json({ error: 'Плейлист не найден или недоступен' });
        }

        res.json({ success: true, message: 'Плейлист удалён' });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/playlists/:id/regenerate-link
 * Regenerate share link for public playlist
 */
router.post('/:id/regenerate-link', async (req, res, next) => {
    try {
        const userId = req.user.id;
        const playlistId = parseStrictPositiveInt(req.params.id);

        const idError = validateId(playlistId, 'ID плейлиста');
        if (idError) {
            return res.status(400).json({ error: idError });
        }

        const updated = await db.regenerateShareSlug(playlistId, userId);

        if (!updated) {
            return res.status(404).json({
                error: 'Плейлист не найден'
            });
        }

        const publicOrigin = (process.env.PUBLIC_WEB_ORIGIN || '').toString().trim() || 'https://earflow.ru';

        res.json({
            success: true,
            share_slug: updated.share_slug,
            shareUrl: `${publicOrigin}/playlist/${updated.share_slug}`
        });
    } catch (error) {
        next(error);
    }
});

// ============================================================================
// PLAYLIST TRACKS
// ============================================================================

/**
 * GET /api/playlists/:id/tracks
 * Get tracks in a playlist
 */
router.get('/:id/tracks', async (req, res, next) => {
    try {
        const userId = req.user.id;
        const playlistId = parseStrictPositiveInt(req.params.id);

        const idError = validateId(playlistId, 'ID плейлиста');
        if (idError) {
            return res.status(400).json({ error: idError });
        }

        // Check access
        const playlist = await db.getPlaylistById(playlistId, userId);
        if (!playlist) {
            return res.status(404).json({ error: 'Плейлист не найден' });
        }

        // Security: numeric id should be accessible only to owner to prevent enumeration
        if (playlist.user_id !== userId) {
            return res.status(404).json({ error: 'Плейлист не найден' });
        }

        const limitRaw = Number.parseInt(String(req.query.limit ?? ''), 10);
        const offsetRaw = Number.parseInt(String(req.query.offset ?? ''), 10);
        const limit = Math.min(Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 100, 500);
        const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;
        const tracks = await db.getPlaylistTracks(playlistId, { limit, offset });

        const filteredTracks = filterTracksForUser(tracks, userId, req.user.isAdmin === true);

        res.json({
            tracks: filteredTracks,
            pagination: { limit, offset, count: filteredTracks.length }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/playlists/:id/tracks
 * Add track(s) to playlist
 */
router.post('/:id/tracks', async (req, res, next) => {
    try {
        const userId = req.user.id;
        const playlistId = parseStrictPositiveInt(req.params.id);

        const idError = validateId(playlistId, 'ID плейлиста');
        if (idError) {
            return res.status(400).json({ error: idError });
        }

        // Check ownership
        const playlist = await db.getPlaylistById(playlistId, userId);
        if (!playlist) {
            return res.status(404).json({ error: 'Плейлист не найден' });
        }
        if (playlist.user_id !== userId) {
            return res.status(403).json({ error: 'Только владелец может редактировать плейлист' });
        }

        const { song_id, song_ids } = req.body;

        // Single track
        if (song_id) {
            const songIdError = validateId(song_id, 'ID трека');
            if (songIdError) {
                return res.status(400).json({ error: songIdError });
            }

            const result = await db.addTrackToPlaylist(playlistId, song_id, userId);

            if (!result) {
                return res.status(409).json({ error: 'Трек уже в плейлисте' });
            }

            return res.status(201).json({ success: true, track: result });
        }

        // Multiple tracks
        if (song_ids && Array.isArray(song_ids)) {
            if (song_ids.length === 0) {
                return res.status(400).json({ error: 'Список треков пуст' });
            }
            if (song_ids.length > 100) {
                return res.status(400).json({ error: 'Максимум 100 треков за раз' });
            }

            // Validate all IDs
            const validIds = [];
            for (const id of song_ids) {
                const parsed = parseStrictPositiveInt(id);
                if (parsed) {
                    validIds.push(parsed);
                }
            }

            if (validIds.length === 0) {
                return res.status(400).json({ error: 'Нет валидных ID треков' });
            }

            const added = await db.addTracksToPlaylist(playlistId, validIds, userId);

            return res.status(201).json({
                success: true,
                added: added.length,
                skipped: validIds.length - added.length
            });
        }

        return res.status(400).json({ error: 'Укажите song_id или song_ids' });
    } catch (error) {
        next(error);
    }
});

/**
 * DELETE /api/playlists/:id/tracks/:songId
 * Remove track from playlist
 */
router.delete('/:id/tracks/:songId', async (req, res, next) => {
    try {
        const userId = req.user.id;
        const playlistId = parseStrictPositiveInt(req.params.id);
        const songId = parseStrictPositiveInt(req.params.songId);

        const playlistIdError = validateId(playlistId, 'ID плейлиста');
        if (playlistIdError) {
            return res.status(400).json({ error: playlistIdError });
        }

        const songIdError = validateId(songId, 'ID трека');
        if (songIdError) {
            return res.status(400).json({ error: songIdError });
        }

        // Check ownership
        const playlist = await db.getPlaylistById(playlistId, userId);
        if (!playlist) {
            return res.status(404).json({ error: 'Плейлист не найден' });
        }
        if (playlist.user_id !== userId) {
            return res.status(403).json({ error: 'Только владелец может редактировать плейлист' });
        }

        const removed = await db.removeTrackFromPlaylist(playlistId, songId);

        if (!removed) {
            return res.status(404).json({ error: 'Трек не найден в плейлисте' });
        }

        res.json({ success: true, message: 'Трек удалён из плейлиста' });
    } catch (error) {
        next(error);
    }
});

/**
 * PUT /api/playlists/:id/tracks/:songId/position
 * Reorder track in playlist
 */
router.put('/:id/tracks/:songId/position', async (req, res, next) => {
    try {
        const userId = req.user.id;
        const playlistId = parseStrictPositiveInt(req.params.id);
        const songId = parseStrictPositiveInt(req.params.songId);
        const { position } = req.body;

        const playlistIdError = validateId(playlistId, 'ID плейлиста');
        if (playlistIdError) {
            return res.status(400).json({ error: playlistIdError });
        }

        const songIdError = validateId(songId, 'ID трека');
        if (songIdError) {
            return res.status(400).json({ error: songIdError });
        }

        if (typeof position !== 'number' || position < 1) {
            return res.status(400).json({ error: 'Некорректная позиция' });
        }

        // Check ownership
        const playlist = await db.getPlaylistById(playlistId, userId);
        if (!playlist) {
            return res.status(404).json({ error: 'Плейлист не найден' });
        }
        if (playlist.user_id !== userId) {
            return res.status(403).json({ error: 'Только владелец может редактировать плейлист' });
        }

        const reordered = await db.reorderPlaylistTrack(playlistId, songId, position);

        if (!reordered) {
            return res.status(404).json({ error: 'Трек не найден в плейлисте' });
        }

        res.json({ success: true, message: 'Позиция обновлена' });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
