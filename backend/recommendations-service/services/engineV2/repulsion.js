const config = require('../../config');
const { query } = require('../../lib/database');

function uniqInt(ids) {
    const out = [];
    const seen = new Set();
    for (const raw of Array.isArray(ids) ? ids : []) {
        const id = Number.parseInt(raw, 10);
        if (!Number.isFinite(id) || id <= 0) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    return out;
}

async function loadRepulsionPenaltyMap(userId, historyTrackIds) {
    if (config.engineV2.repulsionEnabled !== true) {
        return new Map();
    }

    const historyCount = Math.min(
        Math.max(Number(config.engineV2.repulsionHistoryTracks) || 0, 2),
        10
    );

    const history = uniqInt(historyTrackIds).slice(0, historyCount);
    if (history.length === 0) {
        return new Map();
    }

    const perTrackLimit = Math.min(Math.max(Number(config.engineV2.repulsionLimit) || 0, 1), 200);
    const penalty = Number(config.engineV2.repulsionPenalty);
    const safePenalty = Number.isFinite(penalty) ? penalty : 0;

    if (safePenalty <= 0) {
        return new Map();
    }

    try {
        const result = await query(
            `WITH history AS (
       SELECT unnest($2::int[]) AS song_id
     ),
     hist AS (
       SELECT h.song_id, s.embedding
       FROM history h
       JOIN songs s ON s.id = h.song_id
       WHERE s.embedding IS NOT NULL
     ),
     nn AS (
       SELECT s2.id
       FROM hist h
       JOIN LATERAL (
         SELECT s.id
         FROM songs s
         LEFT JOIN dislikes d ON d.song_id = s.id AND d.user_id = $1
         WHERE h.embedding IS NOT NULL
           AND s.embedding IS NOT NULL
           AND COALESCE(s.is_available, true) = true
           AND d.song_id IS NULL
           AND s.id <> h.song_id
         ORDER BY s.embedding <=> h.embedding
         LIMIT $3
       ) s2 ON true
     )
     SELECT id, count(*)::int AS cnt
     FROM nn
     GROUP BY id`,
            [userId, history, perTrackLimit]
        );

        const map = new Map();
        const denom = history.length;

        for (const row of result.rows || []) {
            const id = Number.parseInt(row?.id, 10);
            const cnt = Number.parseInt(row?.cnt, 10);
            if (!Number.isFinite(id) || id <= 0) continue;
            if (!Number.isFinite(cnt) || cnt <= 0) continue;
            map.set(id, (cnt / denom) * safePenalty);
        }

        return map;
    } catch {
        return new Map();
    }
}

module.exports = {
    loadRepulsionPenaltyMap,
};
