const config = require('../../../config');
const { query } = require('../../../lib/database');
const redis = require('../../../lib/redis');

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

async function buildSessionIntentCandidates(userId, sessionId) {
  if (config.engineV2.onlineIntentEnabled !== true) {
    return { ids: [], sourceScore: 0, meta: { positiveAnchors: 0, negativeAnchors: 0 } };
  }

  const sid = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (!sid) {
    return { ids: [], sourceScore: 0, meta: { positiveAnchors: 0, negativeAnchors: 0 } };
  }

  const anchors = await redis.loadSessionIntentTrackIds(sid, config.engineV2.onlineIntentMaxAnchors).catch(() => ({ positive: [], negative: [] }));
  const positive = uniqInt(anchors.positive);
  const negative = uniqInt(anchors.negative);
  if (positive.length === 0 && negative.length === 0) {
    return { ids: [], sourceScore: 0, meta: { positiveAnchors: 0, negativeAnchors: 0 } };
  }

  const limit = Math.min(Math.max(Number(config.engineV2.onlineIntentLimit) || 0, 1), 1000);
  const excludeDays = Math.max(Number(config.engineV2.recentExcludeDays) || 14, 1);
  const negativePenalty = Math.max(0, Number(config.engineV2.onlineIntentNegativePenalty) || 0);

  const result = await query(
    `WITH positive_input AS (
           SELECT unnest($2::int[]) AS song_id
         ),
         negative_input AS (
           SELECT unnest($3::int[]) AS song_id
         ),
         positive_agg AS (
           SELECT sum(s.embedding) AS v, count(*)::real AS c
           FROM positive_input p
           JOIN songs s ON s.id = p.song_id
           WHERE s.embedding IS NOT NULL
         ),
         negative_agg AS (
           SELECT sum(s.embedding) AS v, count(*)::real AS c
           FROM negative_input n
           JOIN songs s ON s.id = n.song_id
           WHERE s.embedding IS NOT NULL
         ),
         positive_vector AS (
           SELECT CASE WHEN c > 0 AND v IS NOT NULL THEN l2_normalize(reco_scale_vector(v, (1.0::real / c))) ELSE NULL END AS v
           FROM positive_agg
         ),
         negative_vector AS (
           SELECT CASE WHEN c > 0 AND v IS NOT NULL THEN l2_normalize(reco_scale_vector(v, (1.0::real / c))) ELSE NULL END AS v
           FROM negative_agg
         ),
         positive_fallback AS (
           SELECT um.embedding AS v
           FROM user_models um
           WHERE um.user_id = $1
             AND um.embedding IS NOT NULL
           LIMIT 1
         ),
         seed AS (
           SELECT COALESCE((SELECT v FROM positive_vector), (SELECT v FROM positive_fallback)) AS v
         ),
         recently_played AS (
           SELECT song_id
           FROM user_history
           WHERE user_id = $1
             AND (last_played > NOW() - INTERVAL '1 day' * $5 OR play_count >= 5)
         ),
         blocked AS (
           SELECT unnest(($2::int[] || $3::int[])) AS song_id
         ),
         scored AS (
           SELECT
             s.id,
             (1.0::double precision - (s.embedding <=> pv.v)) AS positive_similarity,
             CASE
               WHEN nv.v IS NULL THEN 0::double precision
               ELSE GREATEST(0::double precision, 1.0::double precision - (s.embedding <=> nv.v))
             END AS negative_similarity
           FROM seed pv
           LEFT JOIN negative_vector nv ON true
           JOIN songs s ON true
           LEFT JOIN dislikes d ON d.song_id = s.id AND d.user_id = $1
           LEFT JOIN recently_played rp ON rp.song_id = s.id
           LEFT JOIN blocked b ON b.song_id = s.id
           WHERE s.embedding IS NOT NULL
             AND COALESCE(s.is_available, true) = true
             AND pv.v IS NOT NULL
             AND d.song_id IS NULL
             AND rp.song_id IS NULL
             AND b.song_id IS NULL
         )
         SELECT
           id,
           (positive_similarity - ($6::double precision * negative_similarity)) AS score
         FROM scored
         ORDER BY score DESC, id ASC
         LIMIT $4`,
    [userId, positive, negative, limit, excludeDays, negativePenalty]
  ).catch(() => ({ rows: [] }));

  const perIdScores = new Map();
  const ids = [];
  for (const row of result.rows || []) {
    const id = Number.parseInt(row.id, 10);
    if (!Number.isFinite(id) || id <= 0) continue;
    ids.push(id);
    const score = Number(row.score);
    perIdScores.set(id, Number.isFinite(score) ? Math.max(0.05, 0.85 + score) : 0.85);
  }

  return {
    ids,
    sourceScore: 1.15,
    perIdScores,
    meta: {
      positiveAnchors: positive.length,
      negativeAnchors: negative.length,
    },
  };
}

module.exports = {
  buildSessionIntentCandidates,
};
