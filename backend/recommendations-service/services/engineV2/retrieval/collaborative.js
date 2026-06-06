const config = require('../../../config');
const { query } = require('../../../lib/database');

async function loadLinkedUsers(userId, limit) {
    const safe = Math.min(Math.max(Number(limit) || 0, 1), 200);
    const result = await query(
        `SELECT neighbor_user_id
     FROM user_taste_links
     WHERE user_id = $1
     ORDER BY weight DESC, updated_at DESC
     LIMIT $2`,
        [userId, safe]
    );

    return (result.rows || [])
        .map((r) => Number.parseInt(r.neighbor_user_id, 10))
        .filter((id) => Number.isFinite(id) && id > 0);
}

async function loadSimilarUsersByEmbedding(userId, limit) {
    const safe = Math.min(Math.max(Number(limit) || 0, 1), 200);

    const result = await query(
        `WITH me AS (
       SELECT embedding
       FROM user_models
       WHERE user_id = $1 AND embedding IS NOT NULL
     )
     SELECT um.user_id
     FROM me, user_models um
     WHERE um.user_id != $1
       AND um.embedding IS NOT NULL
     ORDER BY um.embedding <=> (SELECT embedding FROM me LIMIT 1)
     LIMIT $2`,
        [userId, safe]
    ).catch(() => ({ rows: [] }));

    return (result.rows || [])
        .map((r) => Number.parseInt(r.user_id, 10))
        .filter((id) => Number.isFinite(id) && id > 0);
}

async function buildCollaborativeCandidates(userId) {
    const neighborLimit = config.engineV2.collabNeighborLimit;
    const seedUsers = await loadLinkedUsers(userId, neighborLimit).catch(() => []);
    const users = seedUsers.length > 0
        ? seedUsers
        : await loadSimilarUsersByEmbedding(userId, neighborLimit).catch(() => []);

    if (users.length === 0) {
        return { ids: [], sourceScore: 0 };
    }

    const limit = Math.min(Math.max(Number(config.engineV2.collabLimit) || 0, 1), 1000);
    const excludeDays = Math.max(Number(config.engineV2.recentExcludeDays) || 14, 1);

    const result = await query(
        `WITH src AS (
       SELECT unnest($2::int[]) AS uid
     ),
     recently_played AS (
       SELECT song_id FROM user_history
       WHERE user_id = $1
         AND (last_played > NOW() - INTERVAL '1 day' * $4 OR play_count >= 5)
     ),
     liked AS (
       SELECT l.song_id, count(*)::int AS cnt
       FROM src
       JOIN likes l ON l.user_id = src.uid
       GROUP BY l.song_id
     )
     SELECT s.id
     FROM liked
     JOIN songs s ON s.id = liked.song_id
     LEFT JOIN dislikes d ON d.song_id = s.id AND d.user_id = $1
     LEFT JOIN recently_played rp ON s.id = rp.song_id
     WHERE COALESCE(s.is_available, true) = true
       AND d.song_id IS NULL
       AND rp.song_id IS NULL
     ORDER BY liked.cnt DESC, s.popularity DESC, s.play_count DESC
     LIMIT $3`,
        [userId, users, limit, excludeDays]
    );

    return {
        ids: (result.rows || []).map((r) => r.id),
        sourceScore: 0.9,
    };
}

module.exports = {
    buildCollaborativeCandidates,
};
