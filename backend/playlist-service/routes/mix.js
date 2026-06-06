const express = require('express');
const router = express.Router();
const db = require('../lib/database');
const { signPayload, verifyToken } = require('../lib/shareTokens');
const { normalizeCoverPathForClient } = require('./playlistNormalize');

const SHARE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const MIX_SHARE_SECRET = process.env.MIX_SHARE_SECRET;

function parseStrictPositiveInt(value) {
    const s = value === undefined || value === null ? '' : String(value).trim();
    if (!s || !/^\d+$/.test(s)) return null;
    const n = Number(s);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function getMixShareSecret() {
    const secret = (MIX_SHARE_SECRET || '').toString();
    if (!secret || secret.length < 32) return null;
    return secret;
}

function normalizeSongIds(input) {
    if (!Array.isArray(input)) return [];
    const ids = [];
    for (const v of input) {
        const n = parseStrictPositiveInt(v);
        if (n) ids.push(n);
    }
    return Array.from(new Set(ids));
}

async function fetchOwnedSongsByIds(userId, songIds) {
    if (!songIds || songIds.length === 0) return [];

    const result = await db.pool.query(
        `
      SELECT s.*
      FROM songs s
      WHERE s.id = ANY($1::int[])
        AND s.uploader_id = $2
    `,
        [songIds, userId]
    );

    const map = new Map(result.rows.map((r) => [r.id, r]));
    return songIds.map((id) => map.get(id)).filter(Boolean);
}

router.post('/', async (req, res, next) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(401).json({ error: 'Токен отсутствует' });
        }

        const userId = parseStrictPositiveInt(req.user.id);
        if (!userId) {
            return res.status(401).json({ error: 'Некорректный токен' });
        }
        const { title, description, song_ids } = req.body || {};

        if (!title || typeof title !== 'string' || title.trim().length < 1 || title.trim().length > 120) {
            return res.status(400).json({ error: 'Некорректное название микстейпа' });
        }

        if (description && typeof description === 'string' && description.length > 500) {
            return res.status(400).json({ error: 'Описание не может превышать 500 символов' });
        }

        const ids = normalizeSongIds(song_ids);
        if (ids.length < 1) {
            return res.status(400).json({ error: 'Нет треков для шаринга' });
        }

        if (ids.length > 200) {
            return res.status(400).json({ error: 'Максимум 200 треков для шаринга' });
        }

        const songs = await fetchOwnedSongsByIds(userId, ids);
        if (songs.length !== ids.length) {
            return res.status(403).json({ error: 'Нельзя шарить треки, которые вам не принадлежат' });
        }

        const now = Date.now();
        const payload = {
            typ: 'mix',
            uid: userId,
            title: title.trim(),
            description: (description || '').toString().trim() || null,
            song_ids: ids,
            iat: now,
            exp: now + SHARE_TOKEN_TTL_MS,
        };

        const secret = getMixShareSecret();
        if (!secret) {
            return res.status(500).json({ error: 'Сервис шаринга не настроен' });
        }
        const token = signPayload(payload, secret);

        res.status(201).json({
            token,
            expiresAt: new Date(payload.exp).toISOString(),
            url: `/mix/${token}`,
        });
    } catch (error) {
        next(error);
    }
});

router.get('/:token', async (req, res, next) => {
    try {
        const { token } = req.params;
        if (!token || typeof token !== 'string' || token.length < 20) {
            return res.status(400).json({ error: 'Некорректная ссылка' });
        }

        const secret = getMixShareSecret();
        if (!secret) {
            return res.status(500).json({ error: 'Сервис шаринга не настроен' });
        }
        const payload = verifyToken(token, secret);
        if (!payload || payload.typ !== 'mix') {
            return res.status(404).json({ error: 'Ссылка недействительна или истекла' });
        }

        const userId = parseStrictPositiveInt(payload.uid);
        if (!userId) {
            return res.status(404).json({ error: 'Ссылка недействительна' });
        }

        const ids = normalizeSongIds(payload.song_ids);
        if (ids.length < 1 || ids.length > 200) {
            return res.status(404).json({ error: 'Ссылка недействительна' });
        }

        const songs = await fetchOwnedSongsByIds(userId, ids);
        if (songs.length !== ids.length) {
            return res.status(404).json({ error: 'Микстейп недоступен' });
        }

        const first = songs[0];
        const coverUrl = first && first.cover_path ? normalizeCoverPathForClient(first.cover_path) : null;

        res.json({
            id: `mix_${userId}_${payload.iat || Date.now()}`,
            type: 'mix',
            title: payload.title || 'Микстейп',
            description: payload.description || '',
            coverUrl,
            tracks: songs,
            trackCount: songs.length,
            shareToken: token,
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
