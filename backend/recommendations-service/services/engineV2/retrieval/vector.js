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

async function buildVectorCandidates(userId, recentTrackIds) {
    const recent = uniqInt(recentTrackIds).slice(0, config.engineV2.vectorRecentTracks);
    if (recent.length === 0) {
        return { ids: [], sourceScore: 0 };
    }

    const limit = Math.min(Math.max(Number(config.engineV2.vectorLimit) || 0, 1), 500);
    const excludeDays = Math.max(Number(config.engineV2.recentExcludeDays) || 14, 1);

    const result = await query(
        `WITH recent AS (
       SELECT unnest($2::int[]) AS song_id
     ),
     agg AS (
       SELECT reco_scale_vector(sum(s.embedding), (1.0::real / count(*)::real)) AS v
       FROM recent r
       JOIN songs s ON s.id = r.song_id
       WHERE s.embedding IS NOT NULL
     ),
     recently_played AS (
       SELECT song_id FROM user_history
       WHERE user_id = $1
         AND (last_played > NOW() - INTERVAL '1 day' * $4 OR play_count >= 5)
     )
     SELECT s.id
     FROM agg a
     JOIN songs s ON true
     LEFT JOIN dislikes d ON d.song_id = s.id AND d.user_id = $1
     LEFT JOIN recently_played rp ON s.id = rp.song_id
     WHERE a.v IS NOT NULL
       AND s.embedding IS NOT NULL
       AND COALESCE(s.is_available, true) = true
       AND d.song_id IS NULL
       AND rp.song_id IS NULL
     ORDER BY s.embedding <=> a.v
     LIMIT $3`,
        [userId, recent, limit, excludeDays]
    );

    return {
        ids: (result.rows || []).map((r) => r.id),
        sourceScore: 1.0,
    };
}

module.exports = {
    buildVectorCandidates,
};
