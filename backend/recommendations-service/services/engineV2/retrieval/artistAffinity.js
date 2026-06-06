const config = require('../../../config');
const { query } = require('../../../lib/database');

async function buildArtistAffinityCandidates(userId, options = {}) {
    if (config.engineV2.artistAffinityEnabled !== true) {
        return { ids: [], sourceScore: 0, perIdScores: new Map() };
    }

    const limit = Math.min(Math.max(Number(config.engineV2.artistAffinityLimit) || 120, 1), 500);
    const excludeDays = Math.max(Number(config.engineV2.recentExcludeDays) || 14, 1);
    const topArtists = Math.min(Math.max(Number(config.engineV2.artistAffinityTopArtists) || 8, 1), 20);
    const historyDays = Math.min(Math.max(Number(config.engineV2.genreAffinityHistoryDays) || 90, 7), 365);
    const perArtistLimit = Math.ceil(limit / topArtists);
    const skipBurstMode = options.skipBurstMode === true;

    const popularityWeight = skipBurstMode ? 0.80 : 0.40;

    try {
        const result = await query(
            `WITH artist_affinity AS (
                SELECT
                    s.artist,
                    SUM(
                        COALESCE(uh.play_count, 0)::float * 1.0
                        + CASE WHEN l.id IS NOT NULL THEN 4.0 ELSE 0.0 END
                        + CASE WHEN uh.liked = true THEN 2.0 ELSE 0.0 END
                        - COALESCE(uh.skip_count, 0)::float * 1.5
                    ) AS raw_score
                FROM user_history uh
                JOIN songs s ON s.id = uh.song_id
                LEFT JOIN likes l ON l.user_id = $1 AND l.song_id = uh.song_id
                WHERE uh.user_id = $1
                    AND uh.last_played > NOW() - INTERVAL '1 day' * $7
                    AND s.artist IS NOT NULL
                    AND trim(s.artist) != ''
                GROUP BY s.artist
                HAVING SUM(COALESCE(uh.play_count, 0)) > 0
                ORDER BY raw_score DESC
                LIMIT $4
            ),
            total_affinity AS (
                SELECT GREATEST(SUM(GREATEST(raw_score, 0.01)), 0.01) AS total
                FROM artist_affinity
            ),
            recently_played AS (
                SELECT song_id
                FROM user_history
                WHERE user_id = $1
                    AND (
                        last_played > NOW() - INTERVAL '1 day' * $3
                        OR play_count >= 5
                    )
            ),
            ranked_candidates AS (
                SELECT
                    s.id,
                    aa.raw_score,
                    GREATEST(aa.raw_score, 0.01) / ta.total AS weight,
                    ROW_NUMBER() OVER (
                        PARTITION BY aa.artist
                        ORDER BY
                            COALESCE(s.popularity, 0)::float * $6::float
                            + RANDOM() * (1.0 - $6::float)
                            DESC
                    ) AS rn
                FROM artist_affinity aa
                CROSS JOIN total_affinity ta
                JOIN songs s ON s.artist = aa.artist
                LEFT JOIN dislikes d ON d.song_id = s.id AND d.user_id = $1
                LEFT JOIN recently_played rp ON s.id = rp.song_id
                WHERE COALESCE(s.is_available, true) = true
                    AND d.song_id IS NULL
                    AND rp.song_id IS NULL
            )
            SELECT id, raw_score, weight
            FROM ranked_candidates
            WHERE rn <= $2
            ORDER BY weight DESC, rn ASC
            LIMIT $5`,
            [
                userId,          // $1
                perArtistLimit,  // $2
                excludeDays,     // $3
                topArtists,      // $4
                limit,           // $5
                popularityWeight, // $6
                historyDays,     // $7
            ]
        );

        const rows = result.rows || [];
        if (rows.length === 0) {
            return { ids: [], sourceScore: 0, perIdScores: new Map() };
        }

        const maxWeight = rows.reduce((m, r) => Math.max(m, Number(r.weight) || 0), 0);
        const perIdScores = new Map();
        for (const row of rows) {
            const w = maxWeight > 0 ? (Number(row.weight) || 0) / maxWeight : 0;
            perIdScores.set(Number(row.id), 0.60 + w * 0.30);
        }

        return {
            ids: rows.map((r) => Number(r.id)),
            sourceScore: 0.75,
            perIdScores,
        };
    } catch {
        return { ids: [], sourceScore: 0, perIdScores: new Map() };
    }
}

module.exports = { buildArtistAffinityCandidates };
