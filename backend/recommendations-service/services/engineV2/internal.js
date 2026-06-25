const config = require('../../config');
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

function mergeSourcesRoundRobin(sources, maxSize) {
    const list = Array.isArray(sources) ? sources : [];
    const max = Math.max(1, Number(maxSize) || 1);
    const buckets = list.map((src) => uniqInt(src?.ids));
    const positions = buckets.map(() => 0);

    const out = [];
    const seen = new Set();

    while (out.length < max) {
        let progressed = false;

        for (let i = 0; i < buckets.length && out.length < max; i += 1) {
            const b = buckets[i];
            const p = positions[i];
            if (!b || p >= b.length) continue;

            const id = b[p];
            positions[i] = p + 1;
            progressed = true;

            if (seen.has(id)) continue;
            seen.add(id);
            out.push(id);
        }

        if (!progressed) {
            break;
        }
    }

    return out;
}

function clampRatio(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
}

function getTasteMix(options = {}) {
    const raw = {
        exact: clampRatio(config.engineV2.exactTasteRatio, 0.4),
        near: clampRatio(config.engineV2.nearTasteRatio, 0.2),
        discovery: clampRatio(config.engineV2.discoveryRatio, 0.4),
    };

    const profileStrength = clampRatio(options.profileStrength, 0);
    const hasOnlineIntent = options.hasOnlineIntent === true;
    const skipBurstMode = options.skipBurstMode === true;

    if (profileStrength >= 0.65) {
        raw.exact = Math.max(raw.exact, 0.65);
        raw.near = Math.max(raw.near, 0.25);
        raw.discovery = Math.min(raw.discovery, 0.10);
    } else if (profileStrength >= 0.35) {
        raw.exact = Math.max(raw.exact, 0.55);
        raw.near = Math.max(raw.near, 0.25);
        raw.discovery = Math.min(raw.discovery, 0.20);
    } else if (profileStrength < 0.18) {
        raw.exact = Math.max(raw.exact, 0.30);
        raw.near = Math.max(raw.near, 0.25);
        raw.discovery = Math.min(raw.discovery, 0.45);
    }

    if (hasOnlineIntent) {
        raw.exact = Math.max(raw.exact, 0.70);
        raw.near = Math.max(raw.near, 0.20);
        raw.discovery = Math.min(raw.discovery, 0.10);
    }

    if (skipBurstMode) {
        raw.exact = Math.max(raw.exact, 0.78);
        raw.near = Math.max(raw.near, 0.17);
        raw.discovery = Math.min(raw.discovery, 0.05);
    }

    const sum = raw.exact + raw.near + raw.discovery;
    if (!Number.isFinite(sum) || sum <= 0) {
        return { exact: 0.4, near: 0.2, discovery: 0.4 };
    }

    return {
        exact: raw.exact / sum,
        near: raw.near / sum,
        discovery: raw.discovery / sum,
    };
}

function allocateBucketLimits(maxSize, mix) {
    const max = Math.max(1, Number(maxSize) || 1);
    const ratios = [
        { name: 'exact', ratio: Number(mix?.exact) || 0 },
        { name: 'near', ratio: Number(mix?.near) || 0 },
        { name: 'discovery', ratio: Number(mix?.discovery) || 0 },
    ];

    const out = { exact: 0, near: 0, discovery: 0 };
    let allocated = 0;

    const remainders = ratios.map((item) => {
        const raw = max * item.ratio;
        const base = Math.floor(raw);
        out[item.name] = base;
        allocated += base;
        return { name: item.name, remainder: raw - base };
    });

    remainders.sort((a, b) => b.remainder - a.remainder);

    let i = 0;
    while (allocated < max && remainders.length > 0) {
        out[remainders[i % remainders.length].name] += 1;
        allocated += 1;
        i += 1;
    }

    return out;
}

function mergeBucketRoundRobin(sources, maxSize, seen) {
    const list = Array.isArray(sources) ? sources : [];
    const max = Math.max(0, Number(maxSize) || 0);
    if (max <= 0 || list.length === 0) return [];

    const buckets = list.map((src) => uniqInt(src?.ids));
    const positions = buckets.map(() => 0);
    const globalSeen = seen instanceof Set ? seen : new Set();

    const out = [];

    while (out.length < max) {
        let progressed = false;

        for (let i = 0; i < buckets.length && out.length < max; i += 1) {
            const b = buckets[i];
            if (!b || positions[i] >= b.length) continue;

            const id = b[positions[i]];
            positions[i] += 1;
            progressed = true;

            if (globalSeen.has(id)) continue;
            globalSeen.add(id);
            out.push(id);
        }

        if (!progressed) break;
    }

    return out;
}

function markBucketIds(map, ids, bucket) {
    if (!(map instanceof Map)) return;
    for (const id of uniqInt(ids)) {
        if (!map.has(id)) {
            map.set(id, bucket);
        }
    }
}

function buildBucketLookup(groups) {
    const lookup = new Map();
    markBucketIds(lookup, (groups.exact || []).flatMap((src) => src?.ids || []), 'exact');
    markBucketIds(lookup, (groups.near || []).flatMap((src) => src?.ids || []), 'near');
    markBucketIds(lookup, (groups.discovery || []).flatMap((src) => src?.ids || []), 'discovery');
    return lookup;
}

function mergeSourcesByTasteMix(groups, maxSize, mix) {
    const max = Math.max(1, Number(maxSize) || 1);
    const allocations = allocateBucketLimits(max, mix);
    const seen = new Set();
    const bucketLookup = buildBucketLookup(groups);
    const sourceBuckets = new Map();

    const exact = mergeBucketRoundRobin(groups.exact, allocations.exact, seen);
    const near = mergeBucketRoundRobin(groups.near, allocations.near, seen);
    const discovery = mergeBucketRoundRobin(groups.discovery, allocations.discovery, seen);
    markBucketIds(sourceBuckets, exact, 'exact');
    markBucketIds(sourceBuckets, near, 'near');
    markBucketIds(sourceBuckets, discovery, 'discovery');

    const selected = exact.concat(near, discovery);
    if (selected.length >= max) {
        return {
            ids: selected.slice(0, max),
            sourceBuckets,
            allocations,
            bucketCounts: {
                exact: exact.length,
                near: near.length,
                discovery: discovery.length,
            },
        };
    }

    const fill = mergeBucketRoundRobin(
        [].concat(groups.exact || [], groups.near || [], groups.discovery || []),
        max - selected.length,
        seen
    );
    for (const id of fill) {
        if (!sourceBuckets.has(id)) {
            sourceBuckets.set(id, bucketLookup.get(id) || 'unknown');
        }
    }

    const ids = selected.concat(fill).slice(0, max);
    return {
        ids,
        sourceBuckets,
        allocations,
        bucketCounts: {
            exact: exact.length,
            near: near.length,
            discovery: discovery.length,
            fill: fill.length,
        },
    };
}

function countSourceIds(src) {
    return uniqInt(src?.ids).length;
}

async function loadUserProfileStats(userId) {
    try {
        const result = await query(
            `WITH recent_history AS (
                SELECT song_id, play_count, skip_count
                  FROM user_history
                 WHERE user_id = $1
                   AND (last_played IS NULL OR last_played > NOW() - INTERVAL '180 days')
             ),
             user_likes AS (
                SELECT song_id
                  FROM likes
                 WHERE user_id = $1
             )
             SELECT
                (SELECT COUNT(DISTINCT song_id)::int FROM recent_history) AS track_count,
                (SELECT COALESCE(SUM(COALESCE(play_count, 0)), 0)::int FROM recent_history) AS play_count,
                (SELECT COALESCE(SUM(COALESCE(skip_count, 0)), 0)::int FROM recent_history) AS skip_count,
                (SELECT COUNT(DISTINCT song_id)::int FROM user_likes) AS like_count`,
            [userId]
        );
        const row = result.rows?.[0] || {};
        return {
            trackCount: Number(row.track_count) || 0,
            playCount: Number(row.play_count) || 0,
            skipCount: Number(row.skip_count) || 0,
            likeCount: Number(row.like_count) || 0,
        };
    } catch {
        return { trackCount: 0, playCount: 0, skipCount: 0, likeCount: 0 };
    }
}

function computeProfileStrength(stats) {
    const trackScore = clampRatio((Number(stats?.trackCount) || 0) / 12, 0);
    const playScore = clampRatio((Number(stats?.playCount) || 0) / 30, 0);
    const likeScore = clampRatio((Number(stats?.likeCount) || 0) / 5, 0);
    return Math.round((trackScore * 0.4 + playScore * 0.4 + likeScore * 0.2) * 1000) / 1000;
}

function classifyRecommendationMode(profileStrength, sourceCounts) {
    const counts = sourceCounts && typeof sourceCounts === 'object' ? sourceCounts : {};
    const personalizedCount =
        (Number(counts.vector) || 0)
        + (Number(counts.sessionIntent) || 0)
        + (Number(counts.momentum) || 0)
        + (Number(counts.collaborative) || 0)
        + (Number(counts.artistAffinity) || 0)
        + (Number(counts.genreAffinity) || 0)
        + (Number(counts.similarArtist) || 0);
    const explorationCount = Number(counts.exploration) || 0;
    if (profileStrength < 0.18 && personalizedCount < 24) return 'cold_start';
    if (personalizedCount < 12 && explorationCount > 0) return 'discovery_only';
    return 'personalized';
}

async function loadRecentTrackIds(userId, limit) {
    const safeLimit = Math.min(Math.max(Number(limit) || 0, 1), 10);
    const result = await query(
        `SELECT song_id
     FROM user_history
     WHERE user_id = $1
     ORDER BY last_played DESC NULLS LAST
     LIMIT $2`,
        [userId, safeLimit]
    );

    const ids = (result.rows || []).map((r) => r.song_id);
    return uniqInt(ids);
}

async function computeSeedTempo(userId, recentTrackIds) {
    if (!Array.isArray(recentTrackIds) || recentTrackIds.length === 0) {
        return null;
    }

    const result = await query(
        `SELECT sf.tempo
     FROM song_features sf
     WHERE sf.song_id = $1`,
        [recentTrackIds[0]]
    );

    const tempo = result.rows?.[0]?.tempo;
    const n = tempo == null ? null : Number(tempo);
    return Number.isFinite(n) ? n : null;
}

async function retrieveCandidates(userId, options = {}) {
    const { buildSessionIntentCandidates } = require('./retrieval/sessionIntent');
    const { buildVectorCandidates } = require('./retrieval/vector');
    const { buildMomentumCandidates } = require('./retrieval/momentum');
    const { buildSideStepCandidates } = require('./retrieval/sideStep');
    const { buildCollaborativeCandidates } = require('./retrieval/collaborative');
    const { buildContextCandidates } = require('./retrieval/context');
    const { buildExplorationCandidates } = require('./retrieval/exploration');
    const { buildGenreAffinityCandidates } = require('./retrieval/genreAffinity');
    const { buildArtistAffinityCandidates } = require('./retrieval/artistAffinity');
    const { buildSimilarArtistCandidates } = require('./retrieval/similarArtist');
    const { buildOfflineCandidates } = require('./retrieval/offline');
    const redis = require('../../lib/redis');
    const sessionId = typeof options.sessionId === 'string' ? options.sessionId.trim() : '';

    const tzOffsetMin = Number(config.engineV2.timezoneOffsetMinutes) || 0;
    const t = new Date(Date.now() + tzOffsetMin * 60_000);
    const h = t.getUTCHours();
    const evening = h >= 18 || h < 5;

    const recentLimit = Math.max(
        Number(config.engineV2.vectorRecentTracks) || 0,
        Number(config.engineV2.repulsionHistoryTracks) || 0
    );

    const [recentTrackIds, skipBurstCount, profileStats] = await Promise.all([
        loadRecentTrackIds(userId, recentLimit),
        redis.getSkipBurstCount(userId).catch(() => 0),
        loadUserProfileStats(userId),
    ]);

    const skipBurstMode = skipBurstCount >= (Number(config.engineV2.skipBurstThreshold) || 3);
    const affinityOptions = { skipBurstMode };
    const profileStrength = computeProfileStrength(profileStats);

    const [
        sessionIntentSource,
        vectorSource,
        momentumSource,
        sideStepSource,
        collaborativeSource,
        contextSource,
        explorationSource,
        genreAffinitySource,
        artistAffinitySource,
        similarArtistSource,
        offlineSource,
    ] = await Promise.all([
        buildSessionIntentCandidates(userId, sessionId),
        buildVectorCandidates(userId, recentTrackIds),
        buildMomentumCandidates(userId, recentTrackIds),
        buildSideStepCandidates(userId, recentTrackIds),
        buildCollaborativeCandidates(userId),
        buildContextCandidates(userId, { evening }),
        buildExplorationCandidates(userId),
        buildGenreAffinityCandidates(userId, affinityOptions),
        buildArtistAffinityCandidates(userId, affinityOptions),
        buildSimilarArtistCandidates(userId, affinityOptions),
        buildOfflineCandidates(userId),
    ]);

    const sourceGroups = {
        exact: [
            sessionIntentSource,
            vectorSource,
            momentumSource,
            collaborativeSource,
            artistAffinitySource,
            offlineSource,
        ],
        near: [
            sideStepSource,
            contextSource,
            genreAffinitySource,
            similarArtistSource,
        ],
        discovery: [
            explorationSource,
        ],
    };

    const sources = [].concat(sourceGroups.exact, sourceGroups.near, sourceGroups.discovery);

    const scores = new Map();
    for (const src of sources) {
        const srcIds = Array.isArray(src?.ids) ? src.ids : [];
        const flatScore = Number(src?.sourceScore) || 0;
        const perIdScores = src?.perIdScores instanceof Map ? src.perIdScores : null;
        for (const raw of srcIds) {
            const id = Number.parseInt(raw, 10);
            if (!Number.isFinite(id) || id <= 0) continue;
            const prev = Number(scores.get(id)) || 0;
            const idScore = perIdScores && perIdScores.has(id)
                ? Number(perIdScores.get(id))
                : flatScore;
            scores.set(id, prev + idScore);
        }
    }

    const tasteMix = getTasteMix({
        profileStrength,
        hasOnlineIntent: countSourceIds(sessionIntentSource) > 0,
        skipBurstMode,
    });
    const merged = mergeSourcesByTasteMix(sourceGroups, config.engineV2.maxCandidates, tasteMix);
    const capped = merged.ids.length > 0
        ? merged.ids
        : mergeSourcesRoundRobin(sources, config.engineV2.maxCandidates);
    const seedTempo = await computeSeedTempo(userId, recentTrackIds);

    const sourceCounts = {
        vector: countSourceIds(vectorSource),
        sessionIntent: countSourceIds(sessionIntentSource),
        momentum: countSourceIds(momentumSource),
        collaborative: countSourceIds(collaborativeSource),
        artistAffinity: countSourceIds(artistAffinitySource),
        sideStep: countSourceIds(sideStepSource),
        context: countSourceIds(contextSource),
        genreAffinity: countSourceIds(genreAffinitySource),
        similarArtist: countSourceIds(similarArtistSource),
        exploration: countSourceIds(explorationSource),
        offline: countSourceIds(offlineSource),
    };

    return {
        ids: capped,
        scores,
        seedTempo,
        evening,
        recentTrackIds,
        skipBurstMode,
        profileStrength,
        profileStats,
        recommendationMode: classifyRecommendationMode(profileStrength, sourceCounts),
        sourceMix: tasteMix,
        sourceCounts,
        onlineIntent: sessionIntentSource?.meta || null,
        bucketAllocations: merged.allocations || null,
        bucketCounts: merged.bucketCounts || null,
        sourceBuckets: merged.sourceBuckets instanceof Map ? merged.sourceBuckets : new Map(),
    };
}

module.exports = {
    retrieveCandidates,
};
