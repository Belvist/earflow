'use strict';

const express = require('express');
const { getSchemaCapabilities } = require('../lib/db/schemaCapabilities');

const UPLOAD_CONTEXT_HEADER = 'x-earflow-upload-context';
const UPLOAD_CONTEXT_ARTIST_PORTAL = 'artist-portal';

function parsePositiveInt(value) {
    const n = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function createPublishingRouter({ authenticateUser, db, accessControl }) {
    const router = express.Router();

    async function ensureSongOwnerOrAdmin(req, song) {
        const requestUserId = accessControl.getRequestUserId(req);
        const requestIsAdmin = accessControl.getRequestIsAdmin(req);
        if (!requestUserId) {
            const e = new Error('AUTH_REQUIRED');
            e.status = 401;
            throw e;
        }
        if (requestIsAdmin) return { requestUserId, requestIsAdmin };
        if (!song || typeof song !== 'object') {
            const e = new Error('NOT_FOUND');
            e.status = 404;
            throw e;
        }
        const ownerId = parsePositiveInt(song.user_id ?? song.userId ?? song.owner_id ?? song.ownerId);
        if (!ownerId || ownerId !== requestUserId) {
            const e = new Error('FORBIDDEN');
            e.status = 403;
            throw e;
        }

        if (db && db.artistOwnerships && typeof db.artistOwnerships.getOwnedArtistByUserId === 'function') {
            const owned = await db.artistOwnerships.getOwnedArtistByUserId(requestUserId);
            if (owned && typeof owned.artistName === 'string' && owned.artistName.trim()) {
                return { requestUserId, requestIsAdmin };
            }
        }

        const e = new Error('FORBIDDEN');
        e.status = 403;
        throw e;
    }

    function hasArtistPortalUploadContext(req) {
        const raw = req && req.headers ? req.headers[UPLOAD_CONTEXT_HEADER] : null;
        const value = Array.isArray(raw) ? raw[0] : raw;
        return String(value || '').trim().toLowerCase() === UPLOAD_CONTEXT_ARTIST_PORTAL;
    }

    async function setAvailability(req, res, isAvailable) {
        try {
            if (!hasArtistPortalUploadContext(req)) {
                return res.status(403).json({ error: 'Artist portal required', code: 'ARTIST_PORTAL_ONLY' });
            }

            const songId = parsePositiveInt(req.params.id);
            if (!songId) {
                return res.status(400).json({ error: 'Недопустимый идентификатор трека' });
            }

            const caps = await getSchemaCapabilities();
            if (!caps.hasIsAvailable) {
                return res.status(501).json({ error: 'Publish unavailable', code: 'PUBLISH_UNSUPPORTED' });
            }

            const song = await db.songs.getSongById(songId);
            if (!song) {
                return res.status(404).json({ error: 'Песня не найдена' });
            }

            await ensureSongOwnerOrAdmin(req, song);

            const updated = await db.songs.updateSong(songId, { is_available: Boolean(isAvailable) });
            if (!updated) {
                return res.status(404).json({ error: 'Песня не найдена' });
            }

            return res.json({ id: updated.id, is_available: updated.is_available === true });
        } catch (error) {
            const status = Number.isFinite(error?.status) ? error.status : 500;
            if (status === 401) return res.status(401).json({ error: 'Authentication required' });
            if (status === 403) return res.status(403).json({ error: 'Доступ запрещен' });
            if (status === 404) return res.status(404).json({ error: 'Песня не найдена' });
            return res.status(500).json({ error: 'Ошибка' });
        }
    }

    router.post('/api/songs/:id/publish', authenticateUser, async (req, res) => {
        return await setAvailability(req, res, true);
    });

    router.post('/api/songs/:id/unpublish', authenticateUser, async (req, res) => {
        return await setAvailability(req, res, false);
    });

    return router;
}

module.exports = createPublishingRouter;
