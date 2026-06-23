'use strict';

const express = require('express');

function createDislikesRouter({ authenticateUser, db }) {
    const router = express.Router();

    router.get('/api/dislikes', authenticateUser, async (req, res) => {
        try {
            const disliked = await db.dislikes.listDislikes(req.user.id);
            return res.json(Array.isArray(disliked) ? disliked : []);
        } catch {
            return res.status(500).json({ error: 'Ошибка получения дизлайков' });
        }
    });

    router.post('/api/dislikes/:songId', authenticateUser, async (req, res) => {
        try {
            const songId = parseInt(req.params.songId, 10);
            if (!Number.isFinite(songId) || songId <= 0) {
                return res.status(400).json({ error: 'Недопустимый идентификатор трека' });
            }
            const result = await db.dislikes.addDislike(req.user.id, songId);
            return res.json(result);
        } catch {
            return res.status(500).json({ error: 'Ошибка дизлайка' });
        }
    });

    router.delete('/api/dislikes/:songId', authenticateUser, async (req, res) => {
        try {
            const songId = parseInt(req.params.songId, 10);
            if (!Number.isFinite(songId) || songId <= 0) {
                return res.status(400).json({ error: 'Недопустимый идентификатор трека' });
            }
            const result = await db.dislikes.removeDislike(req.user.id, songId);
            return res.json(result);
        } catch {
            return res.status(500).json({ error: 'Ошибка снятия дизлайка' });
        }
    });

    return router;
}

module.exports = createDislikesRouter;
