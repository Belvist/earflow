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

async function fetchCandidateObjects(userId, ids, sourceScores, sourceBuckets) {
    const list = uniqInt(ids);
    if (list.length === 0) return [];

    const result = await query(
        `WITH artist_dislike_counts AS (
       SELECT LOWER(TRIM(ds.artist)) AS artist_key, COUNT(*)::int AS dislike_count
         FROM dislikes dd
         JOIN songs ds ON ds.id = dd.song_id
        WHERE dd.user_id = $1
          AND ds.artist IS NOT NULL
          AND TRIM(ds.artist) != ''
        GROUP BY LOWER(TRIM(ds.artist))
     )
     SELECT
       s.id,
       s.artist,
       s.genre,
       sf.tempo,
       sf.energy,
       COALESCE(s.popularity, 0)::double precision AS popularity,
       COALESCE(s.play_count, 0)::double precision AS play_count,
       COALESCE(uh.play_count, 0)::int AS user_play_count,
       COALESCE(uh.skip_count, 0)::int AS user_skip_count,
       COALESCE(adl.dislike_count, 0)::int AS user_artist_dislike_count
     FROM songs s
     LEFT JOIN song_features sf ON s.id = sf.song_id
     LEFT JOIN user_history uh ON uh.user_id = $1 AND uh.song_id = s.id
     LEFT JOIN artist_dislike_counts adl
       ON LOWER(TRIM(s.artist)) = adl.artist_key
     WHERE s.id = ANY($2::int[])`,
        [userId, list]
    );

    const map = new Map((result.rows || []).map((r) => [r.id, r]));
    const scores = sourceScores instanceof Map ? sourceScores : new Map();
    const buckets = sourceBuckets instanceof Map ? sourceBuckets : new Map();

    const out = [];
    for (const id of list) {
        const row = map.get(id);
        if (!row) continue;

        const tempo = row.tempo == null ? null : Number(row.tempo);
        const energy = row.energy == null ? null : Number(row.energy);

        out.push({
            id: row.id,
            artist: row.artist || '',
            genre: typeof row.genre === 'string' ? row.genre.trim() : '',
            tempo: Number.isFinite(tempo) ? tempo : null,
            energy: Number.isFinite(energy) ? energy : null,
            popularity: Number(row.popularity) || 0,
            playCount: Number(row.play_count) || 0,
            userPlayCount: Number(row.user_play_count) || 0,
            userSkipCount: Number(row.user_skip_count) || 0,
            userArtistDislikeCount: Number(row.user_artist_dislike_count) || 0,
            sourceScore: Number(scores.get(row.id)) || 0,
            tasteBucket: buckets.get(row.id) || null,
        });
    }

    return out;
}

module.exports = {
    uniqInt,
    fetchCandidateObjects,
};
