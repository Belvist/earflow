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

function buildSeed(userId) {
  const now = new Date();
  const dayOfYear = Math.floor((now - new Date(Date.UTC(now.getUTCFullYear(), 0, 0))) / 86400000);
  const sixHourBucket = Math.floor(now.getUTCHours() / 6);
  const seedBase = Math.abs(dayOfYear * 2654435761 + sixHourBucket * 374761393) % 4294967295;
  const rawSeed = Number(BigInt(userId) ^ BigInt(seedBase));
  return Math.abs(rawSeed) % 2147483647;
}

async function loadBroadDiscoveryCandidates(userId, seed, limit, excludeDays, existingIds) {
  const existing = uniqInt(existingIds);
  const poolSize = Math.min(Math.max(limit * 8, 200), 2000);
  const perArtistCap = 3;

  const result = await query(
    `WITH existing_ids AS (
       SELECT unnest($5::int[]) AS id
     ),
     recently_played AS (
       SELECT song_id
       FROM user_history
       WHERE user_id = $1
         AND (last_played > NOW() - INTERVAL '1 day' * $4 OR play_count >= 5)
     ),
     pool AS (
       SELECT
         s.id,
         NULLIF(LOWER(TRIM(s.artist)), '') AS artist_key,
         COALESCE(s.popularity, s.play_count, 0)::double precision AS pop,
         (abs(hashtextextended((s.id::text || ':' || COALESCE(s.artist, '') || ':' || COALESCE(s.genre, '')), $2::bigint)) % 1000000)::double precision / 1000000.0 AS jitter
       FROM songs s
       LEFT JOIN dislikes d ON d.song_id = s.id AND d.user_id = $1
       LEFT JOIN recently_played rp ON rp.song_id = s.id
       LEFT JOIN existing_ids ex ON ex.id = s.id
       WHERE COALESCE(s.is_available, true) = true
         AND d.song_id IS NULL
         AND rp.song_id IS NULL
         AND ex.id IS NULL
         AND (
           NULLIF(s.audio_url, '') IS NOT NULL
           OR NULLIF(s.file_path, '') IS NOT NULL
           OR COALESCE(s.has_ebap, false) = true
         )
       ORDER BY
         LN(GREATEST(COALESCE(s.popularity, s.play_count, 0), 0) + 2) * 0.25 + jitter * 0.75 DESC
       LIMIT $6
     ),
     diversified AS (
       SELECT
         id,
         ROW_NUMBER() OVER (
           PARTITION BY COALESCE(artist_key, 'artist:' || id::text)
           ORDER BY pop DESC, jitter DESC
         ) AS artist_rank,
         pop,
         jitter
       FROM pool
     )
     SELECT id
     FROM diversified
     WHERE artist_rank <= $7
     ORDER BY jitter DESC, pop DESC
     LIMIT $3`,
    [userId, seed, limit, excludeDays, existing, poolSize, perArtistCap]
  );

  return (result.rows || []).map((r) => r.id);
}

async function buildExplorationCandidates(userId) {
  const limit = Math.min(Math.max(Number(config.engineV2.explorationLimit) || 0, 1), 500);
  const excludeDays = Math.max(Number(config.engineV2.recentExcludeDays) || 14, 1);

  const seed = buildSeed(userId);

  try {
    const result = await query(
      `WITH genre_affinity AS (
         SELECT
           lower(trim(s.genre)) AS genre,
           GREATEST(
             SUM(
               COALESCE(uh.play_count, 0)::float
               + CASE WHEN l.id IS NOT NULL THEN 4 ELSE 0 END
               + CASE WHEN uh.liked = true THEN 2 ELSE 0 END
               - COALESCE(uh.skip_count, 0)::float * 1.5
             ),
             0.01
           ) AS affinity_score
         FROM user_history uh
         JOIN songs s ON s.id = uh.song_id
         LEFT JOIN likes l ON l.user_id = $1 AND l.song_id = uh.song_id
         WHERE uh.user_id = $1
           AND uh.last_played > NOW() - INTERVAL '6 months'
           AND s.genre IS NOT NULL
           AND trim(s.genre) != ''
         GROUP BY lower(trim(s.genre))
         HAVING SUM(COALESCE(uh.play_count, 0)) + SUM(CASE WHEN l.id IS NOT NULL THEN 1 ELSE 0 END) > 0
       ),
       max_affinity AS (
         SELECT GREATEST(MAX(affinity_score), 1) AS mx FROM genre_affinity
       ),
       recently_played AS (
         SELECT song_id FROM user_history
         WHERE user_id = $1
           AND (last_played > NOW() - INTERVAL '1 day' * $4 OR play_count >= 5)
       )
       SELECT s.id
       FROM songs s
       JOIN genre_affinity ga ON lower(trim(s.genre)) = ga.genre
       CROSS JOIN max_affinity ma
       LEFT JOIN dislikes d ON d.song_id = s.id AND d.user_id = $1
       LEFT JOIN recently_played rp ON s.id = rp.song_id
       WHERE COALESCE(s.is_available, true) = true
         AND d.song_id IS NULL
         AND rp.song_id IS NULL
       ORDER BY
         (ga.affinity_score / ma.mx) * 0.4
         + (abs(hashtextextended(s.id::text, $2::bigint)) % 1000000)::float / 1000000.0 * 0.6
         DESC
       LIMIT $3`,
      [userId, seed, limit, excludeDays]
    );

    const affinityIds = uniqInt((result.rows || []).map((r) => r.id));
    const broadLimit = Math.max(limit - affinityIds.length, Math.ceil(limit * 0.6));
    const broadIds = broadLimit > 0
      ? await loadBroadDiscoveryCandidates(userId, seed, broadLimit, excludeDays, affinityIds)
      : [];

    return {
      ids: uniqInt(affinityIds.concat(broadIds)).slice(0, limit),
      sourceScore: 0.2,
    };
  } catch {
    try {
      const broadIds = await loadBroadDiscoveryCandidates(userId, seed, limit, excludeDays, []);
      return { ids: uniqInt(broadIds).slice(0, limit), sourceScore: 0.12 };
    } catch {
      return { ids: [], sourceScore: 0 };
    }
  }
}

module.exports = {
  buildExplorationCandidates,
};
