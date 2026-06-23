'use strict';

const express = require('express');
const multer = require('multer');
const sharp = require('sharp');

function createArtistAssetsRouter({ authenticateUser, uploadLimiter, storageModule, db, accessControl }) {
    const router = express.Router();

    const upload = multer({
        storage: multer.memoryStorage(),
        limits: {
            files: 1,
            fileSize: 12 * 1024 * 1024,
        },
    });

    async function ensureArtistUploaderOrAdmin(req) {
        const requestUserId = accessControl.getRequestUserId(req);
        const requestIsAdmin = accessControl.getRequestIsAdmin(req);
        if (!requestUserId) {
            const e = new Error('AUTH_REQUIRED');
            e.status = 401;
            throw e;
        }

        if (requestIsAdmin) {
            return { userId: requestUserId, requestIsAdmin };
        }

        const owned = await db.artistOwnerships.getOwnedArtistByUserId(requestUserId);
        if (!owned) {
            const e = new Error('FORBIDDEN');
            e.status = 403;
            throw e;
        }

        return { userId: requestUserId, requestIsAdmin, artist: owned };
    }

    function validateImageUpload(file) {
        const f = file && typeof file === 'object' ? file : null;
        if (!f || !Buffer.isBuffer(f.buffer) || f.buffer.length === 0) {
            const e = new Error('NO_FILE');
            e.status = 400;
            e.code = 'NO_FILE';
            throw e;
        }

        const mime = String(f.mimetype || '').toLowerCase();
        const ok = mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp';
        if (!ok) {
            const e = new Error('UNSUPPORTED_IMAGE_TYPE');
            e.status = 415;
            e.code = 'UNSUPPORTED_IMAGE_TYPE';
            throw e;
        }

        const size = Number(f.size) || f.buffer.length;
        if (!Number.isFinite(size) || size <= 0) {
            const e = new Error('INVALID_FILE');
            e.status = 400;
            e.code = 'INVALID_FILE';
            throw e;
        }

        return { mime, size };
    }

    async function transcodeToWebp({ buffer, maxWidth, maxHeight }) {
        const meta = await sharp(buffer, { failOn: 'truncated' }).metadata();
        const w = Number(meta.width) || 0;
        const h = Number(meta.height) || 0;
        if (!w || !h) {
            const e = new Error('INVALID_IMAGE');
            e.status = 400;
            e.code = 'INVALID_IMAGE';
            throw e;
        }
        if (w > 12000 || h > 12000) {
            const e = new Error('IMAGE_TOO_LARGE');
            e.status = 413;
            e.code = 'IMAGE_TOO_LARGE';
            throw e;
        }

        return await sharp(buffer, { failOn: 'truncated' })
            .resize(maxWidth, maxHeight, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 86 })
            .toBuffer();
    }

    async function handleUpload(req, res, kind) {
        try {
            await ensureArtistUploaderOrAdmin(req);

            const file = req.file;
            validateImageUpload(file);

            const isAvatar = kind === 'avatar';
            const maxWidth = isAvatar ? 1200 : 2400;
            const maxHeight = isAvatar ? 1200 : 1350;

            const webp = await transcodeToWebp({ buffer: file.buffer, maxWidth, maxHeight });

            const objectKey = storageModule.generateObjectKey(`${kind}.webp`, 'covers/');
            await storageModule.uploadBuffer(webp, objectKey, 'image/webp');

            return res.status(201).json({ key: objectKey });
        } catch (error) {
            const status = Number.isFinite(error?.status) ? error.status : 500;
            const code = typeof error?.code === 'string' && error.code ? error.code : undefined;

            if (status === 401) return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
            if (status === 403) return res.status(403).json({ error: 'Доступ запрещен', code: 'FORBIDDEN' });
            if (status === 415) return res.status(415).json({ error: 'UNSUPPORTED_IMAGE_TYPE', code: 'UNSUPPORTED_IMAGE_TYPE' });
            if (status === 413) return res.status(413).json({ error: code || 'FILE_TOO_LARGE', code: code || 'FILE_TOO_LARGE' });
            if (status === 400) return res.status(400).json({ error: code || 'INVALID_FILE', code: code || 'INVALID_FILE' });
            return res.status(500).json({ error: 'Upload failed', code: 'UPLOAD_FAILED' });
        }
    }

    router.post('/api/upload/artist/avatar', authenticateUser, uploadLimiter, upload.single('file'), async (req, res) => {
        return await handleUpload(req, res, 'avatar');
    });

    router.post('/api/upload/artist/banner', authenticateUser, uploadLimiter, upload.single('file'), async (req, res) => {
        return await handleUpload(req, res, 'banner');
    });

    return router;
}

module.exports = createArtistAssetsRouter;
