'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs-extra');

function createCoversRouter({ storageModule, localUploadDir }) {
    const router = express.Router();
    const localRoot = (localUploadDir || '').toString().trim();

    async function serveCover(filename, req, res) {
        const safeFilename = path.basename(filename || '');
        if (!safeFilename || !/^[a-zA-Z0-9_.-]+$/.test(safeFilename)) {
            return res.status(400).json({ error: 'Некорректное имя файла обложки' });
        }

        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Vary', 'Accept-Encoding');

        const mime = (
            safeFilename.endsWith('.png') ? 'image/png' :
                safeFilename.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
        );
        res.setHeader('Content-Type', mime);

        if (storageModule && typeof storageModule.isMinioReady === 'function' && storageModule.isMinioReady()) {
            const keysToTry = [safeFilename, `covers/${safeFilename}`];
            for (const key of keysToTry) {
                try {
                    const result = await storageModule.getFileStream(key, { bucket: 'covers' });
                    if (result && result.stream) {
                        if (Number.isFinite(result.contentLength)) {
                            res.setHeader('Content-Length', String(result.contentLength));
                        }
                        return result.stream.pipe(res);
                    }
                } catch {
                }
            }
        }

        const candidates = [];
        if (localRoot) {
            candidates.push(path.join(localRoot, 'covers', safeFilename));
            candidates.push(path.join(localRoot, safeFilename));
        }

        for (const p of candidates) {
            try {
                if (await fs.pathExists(p)) {
                    const stat = await fs.stat(p);
                    res.setHeader('Content-Length', String(stat.size));
                    return fs.createReadStream(p).pipe(res);
                }
            } catch {
            }
        }

        return res.status(404).json({ error: 'Обложка не найдена' });
    }

    router.get('/covers/:filename', async (req, res) => {
        return await serveCover(req.params.filename, req, res);
    });

    router.get('/api/songs/cover/:filename', async (req, res) => {
        return await serveCover(req.params.filename, req, res);
    });

    return router;
}

module.exports = createCoversRouter;
