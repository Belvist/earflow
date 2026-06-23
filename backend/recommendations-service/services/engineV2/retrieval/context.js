const config = require('../../../config');
const { query } = require('../../../lib/database');

async function buildContextCandidates(userId, ctx) {
    const evening = ctx && ctx.evening === true;
    if (!evening) {
        return { ids: [], sourceScore: 0 };
    }

    const limit = Math.min(Math.max(Number(config.engineV2.contextLimit) || 0, 1), 500);

    const excludeDays = Math.max(Number(config.engineV2.recentExcludeDays) || 14, 1);
    const poolSize = Math.min(limit * 5, 1000);

    const result = await query(
        `WITH recently_played AS (
       SELECT song_id FROM user_history
       WHERE user_id = $1
         AND (last_played > NOW() - INTERVAL '1 day' * $4 OR play_count >= 5)
     ),
     pool AS (
       SELECT s.id, COALESCE(s.popularity, 0) AS pop
       FROM songs s
       JOIN song_features sf ON sf.song_id = s.id
       LEFT JOIN dislikes d ON d.song_id = s.id AND d.user_id = $1
       LEFT JOIN recently_played rp ON s.id = rp.song_id
       WHERE COALESCE(s.is_available, true) = true
         AND d.song_id IS NULL
         AND rp.song_id IS NULL
         AND COALESCE(sf.energy, 0.5) < $2::double precision
       ORDER BY s.popularity DESC, s.play_count DESC
       LIMIT $5
     )
     SELECT id FROM pool
     ORDER BY pop * (0.6 + 0.4 * random())
     LIMIT $3`,
        [userId, Number(config.engineV2.contextMaxEnergy) || 0.35, limit, excludeDays, poolSize]
    );

    return {
        ids: (result.rows || []).map((r) => r.id),
        sourceScore: 0.4,
    };
}

module.exports = {
    buildContextCandidates,
};
