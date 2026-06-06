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

async function buildSideStepCandidates(userId, recentTrackIds) {
  if (config.engineV2.sideStepEnabled !== true) {
    return { ids: [], sourceScore: 0 };
  }

  const recent = uniqInt(recentTrackIds).slice(0, config.engineV2.vectorRecentTracks);
  if (recent.length === 0) {
    return { ids: [], sourceScore: 0 };
  }

  const limit = Math.min(Math.max(Number(config.engineV2.sideStepLimit) || 0, 1), 500);
  const nnLimit = Math.min(500, Math.max(limit * 8, 50));

  const minCos = Number(config.engineV2.sideStepMinCos);
  const maxCos = Number(config.engineV2.sideStepMaxCos);
  const targetCos = Number(config.engineV2.sideStepTargetCos);

  const safeMinCos = Number.isFinite(minCos) ? minCos : 0.5;
  const safeMaxCos = Number.isFinite(maxCos) ? maxCos : 0.62;
  const safeTargetCos = Number.isFinite(targetCos) ? targetCos : (safeMinCos + safeMaxCos) / 2;

  const excludeDays = Math.max(Number(config.engineV2.recentExcludeDays) || 14, 1);

  try {
    const result = await query(
      `WITH recent AS (
       SELECT unnest($2::int[]) AS song_id
     ),
     agg_recent AS (
       SELECT reco_scale_vector(sum(s.embedding), (1.0::real / count(*)::real)) AS v
       FROM recent r
       JOIN songs s ON s.id = r.song_id
       WHERE s.embedding IS NOT NULL
     ),
     seed AS (
       SELECT COALESCE(
         (SELECT embedding FROM user_models WHERE user_id = $1 AND embedding IS NOT NULL),
         (SELECT v FROM agg_recent)
       ) AS v
     ),
     recently_played AS (
       SELECT song_id FROM user_history
       WHERE user_id = $1
         AND (last_played > NOW() - INTERVAL '1 day' * $8 OR play_count >= 5)
     ),
     nn AS (
       SELECT s.id,
              (1.0::double precision - (s.embedding <=> seed.v)) AS cos
       FROM seed
       JOIN songs s ON true
       LEFT JOIN dislikes d ON d.song_id = s.id AND d.user_id = $1
       LEFT JOIN recently_played rp ON s.id = rp.song_id
       WHERE seed.v IS NOT NULL
         AND s.embedding IS NOT NULL
         AND COALESCE(s.is_available, true) = true
         AND d.song_id IS NULL
         AND rp.song_id IS NULL
       ORDER BY s.embedding <=> seed.v
       LIMIT $3
     )
     SELECT id
     FROM nn
     WHERE cos >= $4::double precision
       AND cos <= $5::double precision
     ORDER BY abs(cos - $6::double precision) ASC
     LIMIT $7`,
      [userId, recent, nnLimit, safeMinCos, safeMaxCos, safeTargetCos, limit, excludeDays]
    );

    return {
      ids: (result.rows || []).map((r) => r.id),
      sourceScore: 0.7,
    };
  } catch {
    return { ids: [], sourceScore: 0 };
  }
}

module.exports = {
  buildSideStepCandidates,
};
