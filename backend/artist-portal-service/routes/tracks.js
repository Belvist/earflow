'use strict';

const express = require('express');

function parsePositiveIntStrict(value) {
    const raw = value === undefined || value === null ? '' : String(value).trim();
    if (!/^\d+$/.test(raw)) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function createTracksRouter({
    getBearer,
    ensureMfaStepUpForWrite,
    fetchArtistMe,
    proxyJson,
    uploadSongToUploadService,
    uploadSongCoverToUploadService,
    cleanupUploadFile,
    imageUpload,
    songUpload,
    uploadServiceUrl,
    disableTrackUploadStepUp,
}) {
    const router = express.Router();

    async function ensureArtistReadAccess(bearer) {
        const me = await fetchArtistMe({ bearer, timeoutMs: 5000 });
        if (me.status !== 200) return { ok: false, status: me.status, data: me.data };
        const isArtist = me.data && me.data.isArtist === true;
        const isAdmin = me.data && me.data.isAdmin === true;
        if (!isArtist && !isAdmin) {
            return { ok: false, status: 403, data: { error: 'ARTIST_ACCESS_REQUIRED' } };
        }
        return { ok: true };
    }

    function requireBearer(req, res) {
        const bearer = getBearer(req);
        if (!bearer) {
            res.status(401).json({ error: 'Authentication required' });
            return null;
        }
        return bearer;
    }

    function hasUploadedSongFile(file) {
        if (!file || typeof file !== 'object') return false;
        if (Buffer.isBuffer(file.buffer) && file.buffer.length > 0) return true;
        if (typeof file.path === 'string' && file.path && Number(file.size) > 0) return true;
        return false;
    }

    router.get('/api/artist-portal/tracks', async (req, res) => {
        try {
            const bearer = requireBearer(req, res);
            if (!bearer) return;

            const access = await ensureArtistReadAccess(bearer);
            if (!access.ok) return res.status(access.status).json(access.data);

            const me = await fetchArtistMe({ bearer, timeoutMs: 5000 });
            if (me.status !== 200) return res.status(me.status).json(me.data);

            const rawArtistName = me.data && typeof me.data.artistName === 'string' ? me.data.artistName.trim() : '';
            const artistName = rawArtistName.startsWith('@') ? rawArtistName.slice(1).trim() : rawArtistName;
            if (!artistName) return res.status(404).json({ error: 'ARTIST_NOT_FOUND' });

            const proxied = await proxyJson({
                method: 'GET',
                url: `${uploadServiceUrl}/api/artists/${encodeURIComponent(artistName)}/tracks?limit=200&offset=0`,
                bearer,
                timeoutMs: 10_000,
            });
            return res.status(proxied.status).json(proxied.data);
        } catch {
            return res.status(502).json({ error: 'UPSTREAM_ERROR' });
        }
    });

    router.post('/api/artist-portal/tracks', songUpload.single('file'), async (req, res) => {
        const file = req.file;
        try {
            const bearer = requireBearer(req, res);
            if (!bearer) return;

            if (disableTrackUploadStepUp === true) {
                const access = await ensureArtistReadAccess(bearer);
                if (!access.ok) return res.status(access.status).json(access.data);
            } else {
                const gate = await ensureMfaStepUpForWrite({ bearer });
                if (!gate.ok) return res.status(gate.status).json(gate.data);
            }

            if (!hasUploadedSongFile(file)) {
                return res.status(400).json({ error: 'NO_FILE' });
            }

            const up = await uploadSongToUploadService({ bearer, file, timeoutMs: 120_000 });
            if (!up.ok) {
                const st = up.status && Number.isFinite(Number(up.status)) ? Number(up.status) : 502;
                return res.status(st).json(up.data);
            }

            return res.status(201).json(up.data);
        } catch {
            return res.status(502).json({ error: 'UPSTREAM_ERROR' });
        } finally {
            if (typeof cleanupUploadFile === 'function') {
                await cleanupUploadFile(file);
            }
        }
    });

    router.put('/api/artist-portal/tracks/:id', async (req, res) => {
        try {
            const bearer = requireBearer(req, res);
            if (!bearer) return;

            const gate = await ensureMfaStepUpForWrite({ bearer });
            if (!gate.ok) return res.status(gate.status).json(gate.data);

            const songId = parsePositiveIntStrict(req.params.id);
            if (!songId) return res.status(400).json({ error: 'INVALID_ID' });

            const body = req.body && typeof req.body === 'object' ? req.body : {};
            const payload = {
                ...(body.title !== undefined ? { title: body.title } : {}),
                ...(body.artist !== undefined ? { artist: body.artist } : {}),
                ...(body.album !== undefined ? { album: body.album } : {}),
                ...(body.genre !== undefined ? { genre: body.genre } : {}),
                ...(body.year !== undefined ? { year: body.year } : {}),
            };

            const proxied = await proxyJson({
                method: 'PUT',
                url: `${uploadServiceUrl}/api/songs/${songId}`,
                bearer,
                timeoutMs: 10_000,
                body: payload,
            });
            return res.status(proxied.status).json(proxied.data);
        } catch {
            return res.status(502).json({ error: 'UPSTREAM_ERROR' });
        }
    });

    router.delete('/api/artist-portal/tracks/:id', async (req, res) => {
        try {
            const bearer = requireBearer(req, res);
            if (!bearer) return;

            const gate = await ensureMfaStepUpForWrite({ bearer });
            if (!gate.ok) return res.status(gate.status).json(gate.data);

            const songId = parsePositiveIntStrict(req.params.id);
            if (!songId) return res.status(400).json({ error: 'INVALID_ID' });

            const proxied = await proxyJson({
                method: 'DELETE',
                url: `${uploadServiceUrl}/api/songs/${songId}`,
                bearer,
                timeoutMs: 10_000,
            });
            return res.status(proxied.status).json(proxied.data);
        } catch {
            return res.status(502).json({ error: 'UPSTREAM_ERROR' });
        }
    });

    router.post('/api/artist-portal/tracks/:id/cover', imageUpload.single('file'), async (req, res) => {
        try {
            const bearer = requireBearer(req, res);
            if (!bearer) return;

            if (disableTrackUploadStepUp === true) {
                const access = await ensureArtistReadAccess(bearer);
                if (!access.ok) return res.status(access.status).json(access.data);
            } else {
                const gate = await ensureMfaStepUpForWrite({ bearer });
                if (!gate.ok) return res.status(gate.status).json(gate.data);
            }

            const songId = parsePositiveIntStrict(req.params.id);
            if (!songId) return res.status(400).json({ error: 'INVALID_ID' });

            const file = req.file;
            if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
                return res.status(400).json({ error: 'NO_FILE' });
            }

            const up = await uploadSongCoverToUploadService({ bearer, songId, file, timeoutMs: 15_000 });
            if (!up.ok) {
                const st = up.status && Number.isFinite(Number(up.status)) ? Number(up.status) : 502;
                return res.status(st).json(up.data);
            }

            return res.status(200).json(up.data);
        } catch {
            return res.status(502).json({ error: 'UPSTREAM_ERROR' });
        }
    });

    router.post('/api/artist-portal/tracks/:id/publish', async (req, res) => {
        try {
            const bearer = requireBearer(req, res);
            if (!bearer) return;

            const gate = await ensureMfaStepUpForWrite({ bearer });
            if (!gate.ok) return res.status(gate.status).json(gate.data);

            const songId = parsePositiveIntStrict(req.params.id);
            if (!songId) return res.status(400).json({ error: 'INVALID_ID' });

            const proxied = await proxyJson({
                method: 'POST',
                url: `${uploadServiceUrl}/api/songs/${songId}/publish`,
                bearer,
                timeoutMs: 10_000,
                body: {},
            });
            return res.status(proxied.status).json(proxied.data);
        } catch {
            return res.status(502).json({ error: 'UPSTREAM_ERROR' });
        }
    });

    router.post('/api/artist-portal/tracks/:id/unpublish', async (req, res) => {
        try {
            const bearer = requireBearer(req, res);
            if (!bearer) return;

            const gate = await ensureMfaStepUpForWrite({ bearer });
            if (!gate.ok) return res.status(gate.status).json(gate.data);

            const songId = parsePositiveIntStrict(req.params.id);
            if (!songId) return res.status(400).json({ error: 'INVALID_ID' });

            const proxied = await proxyJson({
                method: 'POST',
                url: `${uploadServiceUrl}/api/songs/${songId}/unpublish`,
                bearer,
                timeoutMs: 10_000,
                body: {},
            });
            return res.status(proxied.status).json(proxied.data);
        } catch {
            return res.status(502).json({ error: 'UPSTREAM_ERROR' });
        }
    });

    return router;
}

module.exports = createTracksRouter;
