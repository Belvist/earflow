'use strict';

const express = require('express');
const multer = require('multer');
const sharp = require('sharp');

const UPLOAD_CONTEXT_HEADER = 'x-earflow-upload-context';
const UPLOAD_CONTEXT_ARTIST_PORTAL = 'artist-portal';

function parsePositiveInt(value) {
    const n = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeSongForClient(song) {
    if (!song || typeof song !== 'object') return song;
    const coverPath = (song.cover_path || song.coverPath || '').toString().trim();
    const filename = coverPath ? coverPath.replace(/^\/+/, '').split('/').pop() : '';
    const coverClient = filename ? `/covers/${filename}` : null;
    return {
        id: song.id,
        title: song.title,
        artist: song.artist,
        album: song.album,
        duration: song.duration || song.durationSeconds || song.duration_seconds,
        genre: song.genre,
        year: song.year,
        cover_path: coverClient || song.cover_path || song.coverPath,
        has_ebap: !!(song.has_ebap || song.hasEbap),
        is_available: song.is_available === true,
    };
}

function createSongCoverUploadRouter({ authenticateUser, storageModule, db, accessControl }) {
    const router = express.Router();

    const COVER_WIDTH = 1000;
    const COVER_HEIGHT = 1250;

    const upload = multer({
        storage: multer.memoryStorage(),
        limits: {
            fileSize: 10 * 1024 * 1024,
            files: 1,
        },
    });

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

    function ensureArtistPortalUploadContext(req) {
        const raw = req && req.headers ? req.headers[UPLOAD_CONTEXT_HEADER] : null;
        const value = Array.isArray(raw) ? raw[0] : raw;
        if (String(value || '').trim().toLowerCase() === UPLOAD_CONTEXT_ARTIST_PORTAL) {
            return true;
        }
        return false;
    }

    router.post('/api/songs/:id/cover', authenticateUser, upload.single('file'), async (req, res) => {
        if (!ensureArtistPortalUploadContext(req)) {
            return res.status(403).json({ error: 'Artist portal required', code: 'ARTIST_PORTAL_ONLY' });
        }

        const songId = parsePositiveInt(req.params.id);
        if (!songId) {
            return res.status(400).json({ error: 'Недопустимый идентификатор трека' });
        }

        const file = req.file;
        if (!file || !file.buffer) {
            return res.status(400).json({ error: 'NO_FILE', code: 'NO_FILE' });
        }

        const mime = String(file.mimetype || '').toLowerCase();
        const allowed = mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp';
        if (!allowed) {
            return res.status(415).json({ error: 'UNSUPPORTED_IMAGE_TYPE', code: 'UNSUPPORTED_IMAGE_TYPE' });
        }

        try {
            const song = await db.songs.getSongById(songId);
            if (!song) {
                return res.status(404).json({ error: 'Песня не найдена' });
            }

            await ensureSongOwnerOrAdmin(req, song);

            const webp = await sharp(file.buffer)
                .rotate()
                .resize(COVER_WIDTH, COVER_HEIGHT, { fit: 'cover', position: 'centre', withoutEnlargement: true })
                .webp({ quality: 85 })
                .toBuffer();

            const objectKey = storageModule.generateObjectKey('cover.webp', 'covers/');
            await storageModule.uploadBuffer(webp, objectKey, 'image/webp');

            const updated = await db.songs.updateSong(songId, { cover_path: objectKey });
            if (!updated) {
                return res.status(404).json({ error: 'Песня не найдена' });
            }

            return res.json(normalizeSongForClient(updated));
        } catch (error) {
            const status = Number.isFinite(error?.status) ? error.status : 500;
            if (status === 401) return res.status(401).json({ error: 'Authentication required' });
            if (status === 403) return res.status(403).json({ error: 'Доступ запрещен' });
            return res.status(500).json({ error: 'Upload failed', code: 'UPLOAD_FAILED' });
        }
    });

    return router;
}

module.exports = createSongCoverUploadRouter;
