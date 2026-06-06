'use strict';

const express = require('express');

function parsePositiveInt(value) {
    const n = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function parseLimit(value, fallback, max) {
    const n = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(n, max);
}

function parseOffset(value) {
    const n = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n) || n < 0) return 0;
    return n;
}

function normalizeArtistParam(value) {
    const raw = value === undefined || value === null ? '' : String(value);
    return raw.normalize('NFC').trim().slice(0, 120);
}

function createArtistsRouter({ authenticateUser, db, normalizeSongForClient }) {
    const router = express.Router();

    router.get('/api/artists', authenticateUser, async (req, res) => {
        try {
            const q = typeof req.query.q === 'string' ? req.query.q : '';
            const limit = parseLimit(req.query.limit, 50, 100);
            const offset = parseOffset(req.query.offset);
            const items = await db.artists.listArtists({ q, limit, offset });
            return res.json(Array.isArray(items) ? items : []);
        } catch {
            return res.json([]);
        }
    });

    router.get('/api/artists/:artist/tracks', authenticateUser, async (req, res) => {
        try {
            const artist = normalizeArtistParam(req.params.artist);
            if (!artist) {
                return res.status(400).json({ error: 'Некорректный артист' });
            }

            const limit = parseLimit(req.query.limit, 100, 200);
            const offset = parseOffset(req.query.offset);

            const requestIsAdmin = !!(req && req.user && req.user.isAdmin === true);
            const requestUserId = parsePositiveInt(req && req.user ? (req.user.id ?? req.user.userId ?? req.user.user_id ?? req.user.sub) : null);
            const ownerUserId = requestIsAdmin ? null : requestUserId;

            const tracks = await db.artists.listArtistTracks(artist, { limit, offset, ownerUserId });
            const normalized = (Array.isArray(tracks) ? tracks : []).map(normalizeSongForClient);
            return res.json(normalized);
        } catch {
            return res.json([]);
        }
    });

    return router;
}

module.exports = createArtistsRouter;
