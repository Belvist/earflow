const config = require('../../../config');
const { query } = require('../../../lib/database');

async function buildGenreAffinityCandidates(userId, options = {}) {
    if (config.engineV2.genreAffinityEnabled !== true) {
        return { ids: [], sourceScore: 0, perIdScores: new Map() };
    }

    const limit = Math.min(Math.max(Number(config.engineV2.genreAffinityLimit) || 200, 1), 800);
    const excludeDays = Math.max(Number(config.engineV2.recentExcludeDays) || 14, 1);
    const topGenres = Math.min(Math.max(Number(config.engineV2.genreAffinityTopGenres) || 5, 1), 10);
    const historyDays = Math.min(Math.max(Number(config.engineV2.genreAffinityHistoryDays) || 90, 7), 365);
    const perGenreLimit = Math.ceil(limit / topGenres);
    const skipBurstMode = options.skipBurstMode === true;

    const popularityWeight = skipBurstMode ? 0.85 : 0.45;

    try {
        const result = await query(
            `WITH genre_affinity AS (
                SELECT
                    lower(trim(s.genre)) AS genre,
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
                    AND s.genre IS NOT NULL
                    AND trim(s.genre) != ''
                GROUP BY lower(trim(s.genre))
                HAVING
                    SUM(COALESCE(uh.play_count, 0))
                    + SUM(CASE WHEN l.id IS NOT NULL THEN 1 ELSE 0 END) > 0
                ORDER BY raw_score DESC
                LIMIT $4
            ),
            total_affinity AS (
                SELECT GREATEST(SUM(GREATEST(raw_score, 0.01)), 0.01) AS total
                FROM genre_affinity
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
                    ga.raw_score,
                    GREATEST(ga.raw_score, 0.01) / ta.total AS weight,
                    ROW_NUMBER() OVER (
                        PARTITION BY ga.genre
                        ORDER BY
                            COALESCE(s.popularity, 0)::float * $6::float
                            + RANDOM() * (1.0 - $6::float)
                            DESC
                    ) AS rn
                FROM genre_affinity ga
                CROSS JOIN total_affinity ta
                JOIN songs s ON lower(trim(s.genre)) = ga.genre
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
                perGenreLimit,   // $2
                excludeDays,     // $3
                topGenres,       // $4
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
            perIdScores.set(Number(row.id), 0.62 + w * 0.33);
        }

        return {
            ids: rows.map((r) => Number(r.id)),
            sourceScore: 0.80,
            perIdScores,
        };
    } catch {
        return { ids: [], sourceScore: 0, perIdScores: new Map() };
    }
}

module.exports = { buildGenreAffinityCandidates };
