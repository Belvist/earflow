const config = require('../../../config');
const { query } = require('../../../lib/database');

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

async function buildMomentumCandidates(userId, recentTrackIds) {
    if (config.engineV2.momentumEnabled !== true) {
        return { ids: [], sourceScore: 0 };
    }

    const recent = uniqInt(recentTrackIds);
    if (recent.length < 2) {
        return { ids: [], sourceScore: 0 };
    }

    const lastId = recent[0];
    const prevId = recent[1];

    const limit = Math.min(Math.max(Number(config.engineV2.momentumLimit) || 0, 1), 500);

    try {
        const excludeDays = Math.max(Number(config.engineV2.recentExcludeDays) || 14, 1);

        const result = await query(
            `WITH prev AS (
       SELECT embedding
       FROM songs
       WHERE id = $2 AND embedding IS NOT NULL
     ),
     last AS (
       SELECT embedding
       FROM songs
       WHERE id = $3 AND embedding IS NOT NULL
     ),
     future AS (
       SELECT (reco_scale_vector((SELECT embedding FROM last), 2::real) - (SELECT embedding FROM prev)) AS v
       WHERE (SELECT embedding FROM prev) IS NOT NULL AND (SELECT embedding FROM last) IS NOT NULL
     ),
     recently_played AS (
       SELECT song_id FROM user_history
       WHERE user_id = $1
         AND (last_played > NOW() - INTERVAL '1 day' * $5 OR play_count >= 5)
     )
     SELECT s.id
     FROM future f
     JOIN songs s ON true
     LEFT JOIN dislikes d ON d.song_id = s.id AND d.user_id = $1
     LEFT JOIN recently_played rp ON s.id = rp.song_id
     WHERE f.v IS NOT NULL
       AND s.embedding IS NOT NULL
       AND COALESCE(s.is_available, true) = true
       AND d.song_id IS NULL
       AND rp.song_id IS NULL
     ORDER BY s.embedding <=> f.v
     LIMIT $4`,
            [userId, prevId, lastId, limit, excludeDays]
        );

        return {
            ids: (result.rows || []).map((r) => r.id),
            sourceScore: 0.9,
        };
    } catch {
        return { ids: [], sourceScore: 0 };
    }
}

module.exports = {
    buildMomentumCandidates,
};
