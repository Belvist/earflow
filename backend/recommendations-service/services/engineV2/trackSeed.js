/**
 * Track-seed similar & radio — Engine V2 path (replaces personalRecommendations for API).
 * @module services/engineV2/trackSeed
 */

const { query, fetchTracksByIds } = require('../../lib/database');
const { uniqInt, fetchCandidateObjects } = require('./candidateObjects');
const { rankCandidateList } = require('./rankPipeline');
const redis = require('../../lib/redis');
const config = require('../../config');

const RADIO_CANDIDATE_POOL_MULTIPLIER = 5;

async function loadSeedTrack(trackId) {
    const tid = Number.parseInt(trackId, 10);
    if (!Number.isFinite(tid) || tid <= 0) {
        return null;
    }

    const result = await query(
        `SELECT s.id, s.artist, s.genre, sf.tempo, sf.energy, sf.valence, sf.danceability
     FROM songs s
     LEFT JOIN song_features sf ON sf.song_id = s.id
     WHERE s.id = $1
       AND COALESCE(s.is_available, true) = true`,
        [tid]
    );

    return result.rows?.[0] || null;
}

async function similarIdsFromEmbedding(userId, trackId, limit) {
    const result = await query(
        `WITH target AS (
       SELECT embedding
       FROM songs
       WHERE id = $1 AND embedding IS NOT NULL
     )
     SELECT s.id
     FROM songs s
     CROSS JOIN target t
     LEFT JOIN dislikes d ON d.song_id = s.id AND d.user_id = $3
     WHERE t.embedding IS NOT NULL
       AND s.id != $1
       AND s.embedding IS NOT NULL
       AND COALESCE(s.is_available, true) = true
       AND d.song_id IS NULL
     ORDER BY s.embedding <=> t.embedding
     LIMIT $2`,
        [trackId, limit, userId]
    ).catch(() => ({ rows: [] }));

    return uniqInt((result.rows || []).map((r) => r.id));
}

async function similarIdsFromAudioFeatures(userId, trackId, limit) {
    const result = await query(
        `WITH target AS (
       SELECT energy, valence, danceability, tempo
       FROM song_features
       WHERE song_id = $1
     ),
     scored AS (
       SELECT
         sf.song_id AS id,
         1.0 - (
           ABS(COALESCE(sf.energy, 0.5) - COALESCE(t.energy, 0.5)) * 0.3 +
           ABS(COALESCE(sf.valence, 0.5) - COALESCE(t.valence, 0.5)) * 0.3 +
           ABS(COALESCE(sf.danceability, 0.5) - COALESCE(t.danceability, 0.5)) * 0.2 +
           LEAST(ABS(COALESCE(sf.tempo, 120) - COALESCE(t.tempo, 120)) / 60.0, 1.0) * 0.2
         ) AS similarity
       FROM song_features sf
       CROSS JOIN target t
       JOIN songs s ON s.id = sf.song_id
       LEFT JOIN dislikes d ON d.song_id = s.id AND d.user_id = $3
       WHERE sf.song_id != $1
         AND COALESCE(s.is_available, true) = true
         AND d.song_id IS NULL
     )
     SELECT id
     FROM scored
     ORDER BY similarity DESC
     LIMIT $2`,
        [trackId, limit, userId]
    );

    return uniqInt((result.rows || []).map((r) => r.id));
}

async function resolveRadioExcludeIds(userId, sessionId) {
    const sid = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!sid) return [];
    try {
        const ok = await redis.touchEphemeralSession(userId, sid, config.engineV2.sessionTtlSeconds);
        if (!ok) return [];
        return await redis.loadSessionExcludeIds(sid);
    } catch {
        return [];
    }
}

async function radioCandidateIds(userId, trackId, limit, sessionId) {
    const seed = await loadSeedTrack(trackId);
    if (!seed) {
        return { ids: [], scores: new Map(), seedTempo: null };
    }

    const excludeIds = await resolveRadioExcludeIds(userId, sessionId);
    const poolLimit = Math.min(Math.max(limit * RADIO_CANDIDATE_POOL_MULTIPLIER, limit), 250);

    const result = await query(
        `WITH exclude_ids AS (
       SELECT unnest($4::int[]) AS id
     ),
     scored AS (
       SELECT
         s.id,
         CASE WHEN s.artist = $2 THEN 0.4 ELSE 0 END +
         CASE WHEN s.genre = $3 THEN 0.2 ELSE 0 END +
         CASE
           WHEN sf.energy IS NOT NULL AND $5::numeric IS NOT NULL THEN
             0.4 * (1.0 - (
               ABS(COALESCE(sf.energy, 0.5) - COALESCE($5::numeric, 0.5)) * 0.3 +
               ABS(COALESCE(sf.valence, 0.5) - COALESCE($6::numeric, 0.5)) * 0.3 +
               ABS(COALESCE(sf.danceability, 0.5) - COALESCE($7::numeric, 0.5)) * 0.2 +
               LEAST(ABS(COALESCE(sf.tempo, 120) - COALESCE($8::numeric, 120)) / 60.0, 1.0) * 0.2
             ))
           ELSE 0.1
         END +
         RANDOM() * 0.1 AS score
       FROM songs s
       LEFT JOIN song_features sf ON sf.song_id = s.id
       LEFT JOIN exclude_ids ex ON ex.id = s.id
       LEFT JOIN dislikes d ON d.song_id = s.id AND d.user_id = $9
       WHERE ex.id IS NULL
         AND s.id != $1
         AND COALESCE(s.is_available, true) = true
         AND d.song_id IS NULL
     )
     SELECT id, score
     FROM scored
     ORDER BY score DESC
     LIMIT $10`,
        [
            trackId,
            seed.artist,
            seed.genre,
            excludeIds.length > 0 ? excludeIds : [0],
            seed.energy,
            seed.valence,
            seed.danceability,
            seed.tempo,
            userId,
            poolLimit,
        ]
    );

    const scores = new Map();
    const ids = [];
    for (const row of result.rows || []) {
        const id = Number.parseInt(row.id, 10);
        if (!Number.isFinite(id) || id <= 0) continue;
        ids.push(id);
        scores.set(id, Number(row.score) || 0);
    }

    const tempo = seed.tempo == null ? null : Number(seed.tempo);
    return {
        ids: uniqInt(ids),
        scores,
        seedTempo: Number.isFinite(tempo) ? tempo : null,
    };
}

async function deliverSimilarTracks(userId, trackId, limit) {
    const tid = Number.parseInt(trackId, 10);
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);

    const seed = await loadSeedTrack(tid);
    if (!seed) {
        const err = new Error('Track not found');
        err.statusCode = 404;
        throw err;
    }

    let ids = await similarIdsFromEmbedding(userId, tid, safeLimit);
    if (ids.length === 0) {
        ids = await similarIdsFromAudioFeatures(userId, tid, safeLimit);
    }

    const tracks = await fetchTracksByIds(ids);
    return {
        tracks,
        sourceTrackId: tid,
        count: tracks.length,
    };
}

async function deliverRadioTracks(userId, trackId, limit, sessionId = null) {
    const tid = Number.parseInt(trackId, 10);
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);

    const seed = await loadSeedTrack(tid);
    if (!seed) {
        const err = new Error('Track not found');
        err.statusCode = 404;
        throw err;
    }

    const pool = await radioCandidateIds(userId, tid, safeLimit, sessionId);
    if (pool.ids.length === 0) {
        return {
            tracks: [],
            sourceTrackId: tid,
            count: 0,
            hasMore: false,
        };
    }

    const candidates = await fetchCandidateObjects(userId, pool.ids, pool.scores, new Map());
    const ranked = await rankCandidateList(userId, candidates, safeLimit, {
        seedTempo: pool.seedTempo,
        sessionId: typeof sessionId === 'string' ? sessionId : null,
    });

    const rankedIds = ranked.map((r) => r.id);
    const tracks = await fetchTracksByIds(rankedIds);

    return {
        tracks,
        sourceTrackId: tid,
        count: tracks.length,
        hasMore: tracks.length === safeLimit,
    };
}

module.exports = {
    deliverSimilarTracks,
    deliverRadioTracks,
    loadSeedTrack,
};
