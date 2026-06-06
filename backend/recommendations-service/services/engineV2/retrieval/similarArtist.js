const config = require('../../../config');
const { query } = require('../../../lib/database');

async function buildSimilarArtistCandidates(userId, options = {}) {
    if (config.engineV2.similarArtistEnabled === false) {
        return { ids: [], sourceScore: 0, perIdScores: new Map() };
    }

    const limit = Math.min(Math.max(Number(config.engineV2.similarArtistLimit) || 80, 1), 300);
    const excludeDays = Math.max(Number(config.engineV2.recentExcludeDays) || 14, 1);
    const topArtists = Math.min(Math.max(Number(config.engineV2.similarArtistTopArtists) || 6, 1), 15);
    const historyDays = Math.min(Math.max(Number(config.engineV2.genreAffinityHistoryDays) || 90, 7), 365);

    try {
        const result = await query(
            `WITH user_top_artists AS (
                SELECT
                    s.artist,
                    SUM(COALESCE(uh.play_count, 0))::float AS total_plays
                FROM user_history uh
                JOIN songs s ON s.id = uh.song_id
                WHERE uh.user_id = $1
                  AND uh.last_played > NOW() - INTERVAL '1 day' * $5
                  AND s.artist IS NOT NULL
                  AND TRIM(s.artist) != ''
                GROUP BY s.artist
                HAVING SUM(COALESCE(uh.play_count, 0)) > 0
                ORDER BY total_plays DESC
                LIMIT $3
            ),
            user_genres AS (
                SELECT DISTINCT LOWER(TRIM(s.genre)) AS genre
                FROM songs s
                JOIN user_top_artists uta ON LOWER(TRIM(s.artist)) = LOWER(TRIM(uta.artist))
                WHERE s.genre IS NOT NULL
                  AND TRIM(s.genre) != ''
            ),
            excluded_artists AS (
                SELECT DISTINCT LOWER(TRIM(artist)) AS artist FROM user_top_artists
            ),
            recently_played AS (
                SELECT song_id
                FROM user_history
                WHERE user_id = $1
                  AND (
                    last_played > NOW() - INTERVAL '1 day' * $4
                    OR play_count >= 5
                  )
            ),
            similar_candidates AS (
                SELECT
                    s.id,
                    ROW_NUMBER() OVER (
                        PARTITION BY LOWER(TRIM(s.artist))
                        ORDER BY COALESCE(s.popularity, 0) DESC, s.id DESC
                    ) AS rn
                FROM songs s
                JOIN user_genres ug ON LOWER(TRIM(s.genre)) = ug.genre
                LEFT JOIN excluded_artists ea ON LOWER(TRIM(s.artist)) = ea.artist
                LEFT JOIN dislikes d ON d.song_id = s.id AND d.user_id = $1
                LEFT JOIN recently_played rp ON s.id = rp.song_id
                WHERE COALESCE(s.is_available, true) = true
                  AND ea.artist IS NULL
                  AND d.song_id IS NULL
                  AND rp.song_id IS NULL
                  AND s.artist IS NOT NULL
                  AND TRIM(s.artist) != ''
            )
            SELECT id FROM similar_candidates
            WHERE rn <= 3
            ORDER BY rn ASC, RANDOM()
            LIMIT $2`,
            [userId, limit, topArtists, excludeDays, historyDays]
        );

        const rows = result.rows || [];
        if (rows.length === 0) {
            return { ids: [], sourceScore: 0, perIdScores: new Map() };
        }

        return {
            ids: rows.map((r) => Number(r.id)),
            sourceScore: 0.45,
            perIdScores: new Map(),
        };
    } catch {
        return { ids: [], sourceScore: 0, perIdScores: new Map() };
    }
}

module.exports = { buildSimilarArtistCandidates };
