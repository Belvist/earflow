'use strict';

const express = require('express');
const {
    createPreviewToken,
    validatePreviewToken,
    putDraft,
    getDraft,
} = require('../lib/artistCardPreviewStore');

function safeText(v) {
    if (v === null || v === undefined) return '';
    return String(v);
}

function readArtistPublicId(data) {
    return safeText(data?.artistPublicId || data?.artist_public_id || data?.publicId || data?.public_id).trim().toLowerCase();
}

function createPreviewRouter({ getBearer, fetchArtistMe, fetchUserId }) {
    const router = express.Router();

    function requireBearer(req, res) {
        const bearer = getBearer(req);
        if (!bearer) {
            res.status(401).json({ error: 'Authentication required' });
            return null;
        }
        return bearer;
    }

    router.post('/api/artist-portal/artist-card/preview-token', async (req, res) => {
        try {
            const bearer = requireBearer(req, res);
            if (!bearer) return;

            const me = await fetchArtistMe({ bearer, timeoutMs: 5000 });
            if (me.status !== 200) return res.status(me.status).json(me.data);

            const pid = readArtistPublicId(me.data);
            if (!/^[a-f0-9]{32}$/i.test(pid)) return res.status(404).json({ error: 'ARTIST_NOT_FOUND' });

            const uid = await fetchUserId({ bearer, timeoutMs: 5000 });
            if (!uid) return res.status(401).json({ error: 'Authentication required' });

            if (!me.data || (me.data.isArtist !== true && me.data.isAdmin !== true)) {
                return res.status(403).json({ error: 'ARTIST_ACCESS_REQUIRED' });
            }

            const created = await createPreviewToken({ userId: uid, artistPublicId: pid });
            return res.status(201).json({ token: created.token, expiresInSeconds: created.expiresInSeconds, artistPublicId: pid });
        } catch (e) {
            const status = e && typeof e === 'object' && Number.isFinite(e.status) ? e.status : 502;
            const code = e && typeof e === 'object' && typeof e.message === 'string' ? e.message : 'UPSTREAM_ERROR';
            if (code === 'REDIS_UNAVAILABLE') return res.status(503).json({ error: 'PREVIEW_UNAVAILABLE' });
            return res.status(status).json({ error: code });
        }
    });

    router.put('/api/artist-portal/artist-card/preview-draft', async (req, res) => {
        try {
            const bearer = requireBearer(req, res);
            if (!bearer) return;

            const token = safeText(req.query?.token).trim();
            const artistPublicId = safeText(req.query?.artistPublicId).trim();

            const validated = await validatePreviewToken({ token, artistPublicId });
            if (!validated) return res.status(403).json({ error: 'INVALID_TOKEN' });

            const uid = await fetchUserId({ bearer, timeoutMs: 5000 });
            if (!uid) return res.status(401).json({ error: 'Authentication required' });

            if (validated.userId !== uid) return res.status(403).json({ error: 'FORBIDDEN' });

            const me = await fetchArtistMe({ bearer, timeoutMs: 5000 });
            if (me.status !== 200) return res.status(me.status).json(me.data);
            if (!me.data || (me.data.isArtist !== true && me.data.isAdmin !== true)) {
                return res.status(403).json({ error: 'ARTIST_ACCESS_REQUIRED' });
            }
            const pid = readArtistPublicId(me.data);
            if (pid.toLowerCase() !== String(artistPublicId).toLowerCase()) {
                return res.status(403).json({ error: 'FORBIDDEN' });
            }

            const body = req.body && typeof req.body === 'object' ? req.body : {};
            await putDraft({ token, userId: uid, artistPublicId, draft: body });
            return res.status(200).json({ ok: true });
        } catch (e) {
            const status = e && typeof e === 'object' && Number.isFinite(e.status) ? e.status : 502;
            const code = e && typeof e === 'object' && typeof e.message === 'string' ? e.message : 'UPSTREAM_ERROR';
            if (code === 'REDIS_UNAVAILABLE') return res.status(503).json({ error: 'PREVIEW_UNAVAILABLE' });
            if (code === 'INVALID_TOKEN') return res.status(403).json({ error: 'INVALID_TOKEN' });
            return res.status(status).json({ error: code });
        }
    });

    router.get('/api/artist-portal/public-preview/artist-meta', async (req, res) => {
        const token = safeText(req.query?.token).trim();
        const artistPublicId = safeText(req.query?.artistPublicId).trim();

        try {
            const bearer = requireBearer(req, res);
            if (!bearer) return;

            const validated = await validatePreviewToken({ token, artistPublicId });
            if (!validated) {
                return res.status(403).json({ error: 'INVALID_TOKEN' });
            }

            const uid = await fetchUserId({ bearer, timeoutMs: 5000 });
            if (!uid) return res.status(401).json({ error: 'Authentication required' });
            if (validated.userId !== uid) return res.status(403).json({ error: 'FORBIDDEN' });

            const me = await fetchArtistMe({ bearer, timeoutMs: 5000 });
            if (me.status !== 200) return res.status(me.status).json(me.data);
            if (!me.data || (me.data.isArtist !== true && me.data.isAdmin !== true)) {
                return res.status(403).json({ error: 'ARTIST_ACCESS_REQUIRED' });
            }

            const pid = readArtistPublicId(me.data);
            if (pid.toLowerCase() !== String(artistPublicId).toLowerCase()) {
                return res.status(403).json({ error: 'FORBIDDEN' });
            }

            const draft = await getDraft({ token, artistPublicId });
            const payload = draft && typeof draft === 'object' ? {
                ...(draft.bio !== undefined ? { bio: draft.bio } : {}),
                ...(draft.heroCoverPath !== undefined ? { heroCoverPath: draft.heroCoverPath } : {}),
                ...(draft.avatarCoverPath !== undefined ? { avatarCoverPath: draft.avatarCoverPath } : {}),
                ...(draft.bannerCoverPath !== undefined ? { bannerCoverPath: draft.bannerCoverPath } : {}),
            } : {};

            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json(payload);
        } catch (e) {
            const status = e && typeof e === 'object' && Number.isFinite(e.status) ? e.status : 502;
            const code = e && typeof e === 'object' && typeof e.message === 'string' ? e.message : 'UPSTREAM_ERROR';
            return res.status(status).json({ error: code });
        }
    });

    return router;
}

module.exports = createPreviewRouter;
