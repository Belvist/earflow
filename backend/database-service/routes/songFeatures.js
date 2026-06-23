const express = require('express');
const router = express.Router();
const db = require('../database/db');

let songsFeatureColumnsPromise = null;
let songsFeatureColumnsExpiresAt = 0;

async function getSongsFeatureColumns() {
    const now = Date.now();
    if (!songsFeatureColumnsPromise || now >= songsFeatureColumnsExpiresAt) {
        songsFeatureColumnsPromise = (async () => {
            const result = await db.query(
                `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'songs'`
            );
            const columns = new Set((result.rows || []).map((r) => r.column_name));
            songsFeatureColumnsExpiresAt = Date.now() + 5 * 60 * 1000;
            return {
                hasBpm: columns.has('bpm'),
                hasKey: columns.has('key'),
                hasMood: columns.has('mood'),
                hasEnergy: columns.has('energy'),
                hasDanceability: columns.has('danceability'),
            };
        })().catch(() => {
            songsFeatureColumnsPromise = null;
            songsFeatureColumnsExpiresAt = 0;
            const e = new Error('Schema capabilities unavailable');
            e.code = 'SCHEMA_UNAVAILABLE';
            throw e;
        });
    }
    return songsFeatureColumnsPromise;
}

function requireService(allowed) {
    const allow = Array.isArray(allowed) ? allowed : [];
    return (req, res, next) => {
        const name = req && req.service ? req.service.name : null;
        if (!name) {
            return res.status(401).json({ error: 'Отсутствует аутентификация сервиса', code: 'NO_SERVICE_AUTH' });
        }
        if (!allow.includes(name)) {
            return res.status(403).json({ error: 'Сервис не авторизован для этого действия', code: 'SERVICE_FORBIDDEN' });
        }
        return next();
    };
}

function clamp01(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
}

function clampFloat(value, { min = null, max = null } = {}) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    if (min !== null && n < min) return min;
    if (max !== null && n > max) return max;
    return n;
}

function normalizeKey(value) {
    if (value === undefined || value === null) return null;
    const s = String(value).trim();
    if (!s) return null;
    return s.slice(0, 10);
}

router.get('/pending', requireService(['track-processor', 'recommendations-service', 'audio-features-worker']), async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(String(req.query.limit || '200'), 10) || 200, 1), 1000);

        const result = await db.query(
            `SELECT s.id, s.file_path, s.mime_type, s.is_available, s.created_at
       FROM songs s
       LEFT JOIN song_features sf ON sf.song_id = s.id
       WHERE s.is_available = true
         AND (sf.song_id IS NULL OR (sf.tempo IS NULL AND sf.energy IS NULL AND sf.valence IS NULL AND sf.danceability IS NULL AND sf.acousticness IS NULL AND sf.instrumentalness IS NULL AND sf.liveness IS NULL AND sf.speechiness IS NULL))
       ORDER BY s.id ASC
       LIMIT $1`,
            [limit]
        );

        return res.json({ items: result.rows || [], limit });
    } catch {
        return res.status(500).json({ error: 'Ошибка получения списка', code: 'INTERNAL_ERROR' });
    }
});

router.post('/upsert', requireService(['track-processor', 'recommendations-service', 'audio-features-worker']), async (req, res) => {
    const payload = req.body || {};

    const songId = Number.parseInt(String(payload.songId ?? payload.song_id ?? ''), 10);
    if (!Number.isFinite(songId) || songId <= 0) {
        return res.status(400).json({ error: 'Invalid songId' });
    }

    const tempo = clampFloat(payload.tempo, { min: 0, max: 1000 });
    const energy = clamp01(payload.energy);
    const valence = clamp01(payload.valence);
    const danceability = clamp01(payload.danceability);
    const acousticness = clamp01(payload.acousticness);
    const instrumentalness = clamp01(payload.instrumentalness);
    const liveness = clamp01(payload.liveness);
    const speechiness = clamp01(payload.speechiness);

    const bpm = payload.bpm === undefined || payload.bpm === null
        ? null
        : Math.max(0, Math.min(1000, Number.parseInt(String(payload.bpm), 10) || 0));

    const key = normalizeKey(payload.key);
    const mood = payload.mood === undefined || payload.mood === null ? null : String(payload.mood).trim().slice(0, 50) || null;

    try {
        const caps = await getSongsFeatureColumns();
        const client = await db.getClient();
        try {
            await client.query('BEGIN');

            const exists = await client.query('SELECT 1 FROM songs WHERE id = $1', [songId]);
            if (!exists.rows || exists.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Song not found' });
            }

            await client.query(
                `INSERT INTO song_features (
           song_id, tempo, energy, valence, danceability, acousticness, instrumentalness, liveness, speechiness
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (song_id) DO UPDATE SET
           tempo = EXCLUDED.tempo,
           energy = EXCLUDED.energy,
           valence = EXCLUDED.valence,
           danceability = EXCLUDED.danceability,
           acousticness = EXCLUDED.acousticness,
           instrumentalness = EXCLUDED.instrumentalness,
           liveness = EXCLUDED.liveness,
           speechiness = EXCLUDED.speechiness`,
                [songId, tempo, energy, valence, danceability, acousticness, instrumentalness, liveness, speechiness]
            );

            const setParts = [];
            const args = [songId];

            if (caps.hasBpm) {
                args.push(bpm);
                setParts.push(`bpm = COALESCE($${args.length}, bpm)`);
            }
            if (caps.hasKey) {
                args.push(key);
                setParts.push(`key = COALESCE($${args.length}, key)`);
            }
            if (caps.hasMood) {
                args.push(mood);
                setParts.push(`mood = COALESCE($${args.length}, mood)`);
            }
            if (caps.hasEnergy) {
                args.push(energy);
                setParts.push(`energy = COALESCE($${args.length}::numeric, energy)`);
            }
            if (caps.hasDanceability) {
                args.push(danceability);
                setParts.push(`danceability = COALESCE($${args.length}::numeric, danceability)`);
            }

            if (setParts.length > 0) {
                await client.query(
                    `UPDATE songs
           SET ${setParts.join(', ')}
           WHERE id = $1`,
                    args
                );
            }

            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }

        return res.status(200).json({ ok: true });
    } catch (error) {
        if (error && error.code === 'SCHEMA_UNAVAILABLE') {
            return res.status(503).json({ error: 'Схема базы данных недоступна', code: 'SCHEMA_UNAVAILABLE' });
        }
        return res.status(500).json({ error: 'Ошибка сохранения', code: 'INTERNAL_ERROR' });
    }
});

module.exports = router;
