const config = require('../../config');
const { query, fetchTracksByIds } = require('../../lib/database');
const redis = require('../../lib/redis');
const { sanitizeUserId } = require('../../lib/validators');

const { bloomFilterIds, bloomMarkSeen } = require('./seenBloom');
const { rankCandidateList } = require('./rankPipeline');
const { retrieveCandidates: retrieveCandidatesInternal } = require('./internal');
const { enrichDeliveryResponse } = require('../sessionStateMachine');
const { uniqInt, fetchCandidateObjects } = require('./candidateObjects');

function mergeUniqueInt(primary, secondary) {
    const out = [];
    const seen = new Set();
    for (const raw of Array.isArray(primary) ? primary : []) {
        const id = Number.parseInt(raw, 10);
        if (!Number.isFinite(id) || id <= 0) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    for (const raw of Array.isArray(secondary) ? secondary : []) {
        const id = Number.parseInt(raw, 10);
        if (!Number.isFinite(id) || id <= 0) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    return out;
}

function clamp01(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
}

function normalizeTasteMix(mix) {
    const raw = {
        exact: clamp01(mix?.exact ?? config.engineV2.exactTasteRatio ?? 0.4),
        near: clamp01(mix?.near ?? config.engineV2.nearTasteRatio ?? 0.2),
        discovery: clamp01(mix?.discovery ?? config.engineV2.discoveryRatio ?? 0.4),
    };
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

function allocateTasteMix(limit, mix) {
    const max = Math.min(Math.max(Number(limit) || 0, 1), 100);
    const normalized = normalizeTasteMix(mix);
    const buckets = [
        { name: 'exact', ratio: normalized.exact },
        { name: 'near', ratio: normalized.near },
        { name: 'discovery', ratio: normalized.discovery },
    ];
    const out = { exact: 0, near: 0, discovery: 0 };
    let allocated = 0;
    const remainders = buckets.map((b) => {
        const raw = max * b.ratio;
        const base = Math.floor(raw);
        out[b.name] = base;
        allocated += base;
        return { name: b.name, remainder: raw - base };
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

function getRankedId(item) {
    const id = Number.parseInt(item?.id, 10);
    return Number.isFinite(id) && id > 0 ? id : null;
}

function takeNextBucketItem(queue, used) {
    while (queue.length > 0) {
        const item = queue.shift();
        const id = getRankedId(item);
        if (!id || used.has(id)) continue;
        used.add(id);
        return item;
    }
    return null;
}

function applyTasteMixToRanked(ranked, sourceBuckets, limit, mix) {
    const safeLimit = Math.min(Math.max(Number(limit) || 0, 1), 100);
    const list = Array.isArray(ranked) ? ranked : [];
    if (list.length <= 1) {
        return list.slice(0, safeLimit);
    }

    const bucketMap = sourceBuckets instanceof Map ? sourceBuckets : new Map();
    const queues = {
        exact: [],
        near: [],
        discovery: [],
        unknown: [],
    };

    for (const item of list) {
        const id = getRankedId(item);
        if (!id) continue;
        const bucket = bucketMap.get(id);
        if (bucket === 'exact' || bucket === 'near' || bucket === 'discovery') {
            queues[bucket].push(item);
        } else {
            queues.unknown.push(item);
        }
    }

    const allocations = allocateTasteMix(safeLimit, mix);
    const used = new Set();
    const selected = [];
    const counts = { exact: 0, near: 0, discovery: 0 };
    const bucketOrder = ['exact', 'near', 'discovery'];

    while (selected.length < safeLimit) {
        let chosen = null;
        let bestDeficit = -Infinity;

        for (const bucket of bucketOrder) {
            const target = allocations[bucket] || 0;
            if (target <= 0 || counts[bucket] >= target || queues[bucket].length === 0) {
                continue;
            }

            const deficit = (target - counts[bucket]) / Math.max(target, 1);
            if (deficit > bestDeficit) {
                bestDeficit = deficit;
                chosen = bucket;
            }
        }

        if (!chosen) break;

        const item = takeNextBucketItem(queues[chosen], used);
        if (!item) {
            counts[chosen] = allocations[chosen] || 0;
            continue;
        }

        counts[chosen] += 1;
        selected.push(item);
    }

    if (selected.length >= safeLimit) {
        return selected.slice(0, safeLimit);
    }

    for (const item of list) {
        if (selected.length >= safeLimit) break;
        const id = getRankedId(item);
        if (!id || used.has(id)) continue;
        used.add(id);
        selected.push(item);
    }

    return selected.slice(0, safeLimit);
}

function getRankWindowSize(desired, candidateCount) {
    const safeDesired = Math.min(Math.max(Number(desired) || 0, 1), 100);
    const available = Math.max(Number(candidateCount) || 0, safeDesired);
    const expanded = Math.max(safeDesired, safeDesired * 5);
    return Math.min(available, expanded, 100);
}

function buildMixDiagnostics(retrieval, servedIds) {
    const sourceBuckets = retrieval?.sourceBuckets instanceof Map ? retrieval.sourceBuckets : new Map();
    const counts = { exact: 0, near: 0, discovery: 0, unknown: 0 };

    for (const id of uniqInt(servedIds)) {
        const bucket = sourceBuckets.get(id);
        if (bucket === 'exact' || bucket === 'near' || bucket === 'discovery') {
            counts[bucket] += 1;
        } else {
            counts.unknown += 1;
        }
    }

    return {
        sourceMix: retrieval?.sourceMix || null,
        servedBucketCounts: counts,
    };
}

function diagnosticsPayload(retrieval, servedIds) {
    if (config.debug?.diagnosticsEnabled !== true) {
        return {};
    }
    return { diagnostics: buildMixDiagnostics(retrieval, servedIds) };
}

function sanitizeSourceCounts(counts) {
    const out = {};
    const src = counts && typeof counts === 'object' ? counts : {};
    for (const key of [
        'vector',
        'sessionIntent',
        'momentum',
        'collaborative',
        'artistAffinity',
        'sideStep',
        'context',
        'genreAffinity',
        'similarArtist',
        'exploration',
        'offline',
    ]) {
        out[key] = Math.max(0, Number.parseInt(src[key], 10) || 0);
    }
    return out;
}

function buildRecommendationMeta(retrieval, servedIds) {
    const modeRaw = typeof retrieval?.recommendationMode === 'string' ? retrieval.recommendationMode : '';
    const mode = modeRaw === 'personalized' || modeRaw === 'cold_start' || modeRaw === 'discovery_only'
        ? modeRaw
        : 'unknown';
    const profileStrength = clamp01(retrieval?.profileStrength);
    const mix = buildMixDiagnostics(retrieval, servedIds);
    return {
        mode,
        personalized: mode === 'personalized',
        profileStrength,
        sourceMix: retrieval?.sourceMix || null,
        sourceCounts: sanitizeSourceCounts(retrieval?.sourceCounts),
        servedBucketCounts: mix.servedBucketCounts,
        candidateCount: uniqInt(retrieval?.ids).length,
        recentTrackCount: Array.isArray(retrieval?.recentTrackIds) ? retrieval.recentTrackIds.length : 0,
        skipBurstMode: retrieval?.skipBurstMode === true,
        onlineIntent: retrieval?.onlineIntent || null,
    };
}

const ACTIVE_SESSION_ENGINE = 'v2';

async function ensureSession(userId, options = {}) {
    const forceNew = options && options.forceNew === true;

    if (forceNew) {
        await redis.clearActiveSessionId(userId, { engine: ACTIVE_SESSION_ENGINE });
    }

    const existing = await redis.getActiveSessionId(userId, { engine: ACTIVE_SESSION_ENGINE });
    if (!forceNew && existing) {
        return existing;
    }

    const created = await redis.createEphemeralSession(userId, config.engineV2.sessionTtlSeconds);
    await redis.setActiveSessionId(
        userId,
        created,
        config.engineV2.sessionTtlSeconds,
        { engine: ACTIVE_SESSION_ENGINE }
    );
    return created;
}
async function retrieveCandidatesCompat(userId, options = {}) {
    const r = await retrieveCandidatesInternal(userId, options);
    return {
        ids: r.ids,
        scores: r.scores,
        seedTempo: r.seedTempo,
        evening: r.evening === true,
        recentTrackIds: Array.isArray(r.recentTrackIds) ? r.recentTrackIds : [],
        sourceMix: r.sourceMix || null,
        sourceCounts: r.sourceCounts || null,
        profileStrength: Number.isFinite(Number(r.profileStrength)) ? Number(r.profileStrength) : 0,
        profileStats: r.profileStats || null,
        onlineIntent: r.onlineIntent || null,
        recommendationMode: typeof r.recommendationMode === 'string' ? r.recommendationMode : 'unknown',
        skipBurstMode: r.skipBurstMode === true,
        bucketAllocations: r.bucketAllocations || null,
        bucketCounts: r.bucketCounts || null,
        sourceBuckets: r.sourceBuckets instanceof Map ? r.sourceBuckets : new Map(),
    };
}

async function applyRepulsionScores(userId, sourceScores, recentTrackIds) {
    if (!sourceScores || typeof sourceScores.get !== 'function') {
        return;
    }
    if (!Array.isArray(recentTrackIds) || recentTrackIds.length === 0) {
        return;
    }

    try {
        const { loadRepulsionPenaltyMap } = require('./repulsion');
        const penalties = await loadRepulsionPenaltyMap(userId, recentTrackIds);
        for (const [id, penalty] of penalties.entries()) {
            const prev = Number(sourceScores.get(id)) || 0;
            const p = Number(penalty) || 0;
            if (!Number.isFinite(p) || p <= 0) continue;
            sourceScores.set(id, prev - p);
        }
    } catch {
        return;
    }
}

async function filterCandidates(userId, ids, requestExcludeIds, options = {}) {
    const exclude = new Set(uniqInt(requestExcludeIds));
    const input = uniqInt(ids).filter((id) => !exclude.has(id));
    if (input.length === 0) return [];

    const sessionId = typeof options?.sessionId === 'string' ? options.sessionId.trim() : '';
    const ignoreSessionImpressions = options && options.ignoreSessionImpressions === true;
    const afterImpressions = await (async () => {
        if (!sessionId || ignoreSessionImpressions) return input;
        try {
            const membership = await redis.sessionHadImpressions(sessionId, input);
            if (!membership || typeof membership.get !== 'function') return input;
            const out = [];
            for (const id of input) {
                if (membership.get(id) !== true) {
                    out.push(id);
                }
            }
            return out.length > 0 ? out : [];
        } catch {
            return input;
        }
    })();

    if (afterImpressions.length === 0) return [];

    const ignoreBloom = options && options.ignoreBloom === true;
    const seenFiltered = ignoreBloom ? afterImpressions : await bloomFilterIds(userId, afterImpressions);
    if (seenFiltered.length === 0) return [];

    const realtimeAllowed = await (async () => {
        try {
            return await redis.filterRealtimeExcludedIds(userId, seenFiltered);
        } catch {
            return seenFiltered;
        }
    })();

    if (realtimeAllowed.length === 0) return [];

    const ignoreDailySeen = options && options.ignoreDailySeen === true;
    const dailySeenFiltered = await (async () => {
        if (ignoreDailySeen) return realtimeAllowed;
        try {
            const out = await redis.filterDailySeenIds(userId, realtimeAllowed);
            return Array.isArray(out) ? out : realtimeAllowed;
        } catch {
            return realtimeAllowed;
        }
    })();

    const dailyAllowed = dailySeenFiltered;
    if (dailyAllowed.length === 0) return [];

    const dislikeFiltered = await query(
        `SELECT s.id
     FROM songs s
     LEFT JOIN dislikes d ON d.song_id = s.id AND d.user_id = $1
     WHERE s.id = ANY($2::int[])
       AND d.song_id IS NULL`,
        [userId, dailyAllowed]
    );

    const allowed = new Set((dislikeFiltered.rows || []).map((r) => r.id));
    return dailyAllowed.filter((id) => allowed.has(id));
}

async function selectFilteredCandidateIds(userId, retrievalIds, requestExcludeIds, sessionExcludeIds, desired, sessionId) {
    const safeDesired = Math.min(Math.max(Number(desired) || 0, 1), 100);
    const minUseful = Math.max(1, Math.floor(safeDesired * 0.6));
    const requestExclude = uniqInt(requestExcludeIds);
    const sessionExclude = uniqInt(sessionExcludeIds);
    const combinedExclude = mergeUniqueInt(requestExclude, sessionExclude);
    const sid = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : null;

    let filteredIds = await filterCandidates(userId, retrievalIds, combinedExclude, {
        ignoreBloom: false,
        sessionId: sid,
    });

    if (filteredIds.length < minUseful) {
        const allowSeen = await filterCandidates(userId, retrievalIds, combinedExclude, {
            ignoreBloom: true,
            sessionId: sid,
        });
        filteredIds = mergeUniqueInt(filteredIds, allowSeen);
    }

    if (filteredIds.length < minUseful) {
        const relaxed = await filterCandidates(userId, retrievalIds, requestExclude, {
            ignoreBloom: true,
            ignoreDailySeen: true,
            ignoreSessionImpressions: true,
            sessionId: sid,
        });
        filteredIds = mergeUniqueInt(filteredIds, relaxed);
    }

    return filteredIds;
}

async function loadCatalogExpansionIds(userId, excludeIds, limit) {
    const safeLimit = Math.min(Math.max(Number(limit) || 0, 0), 100);
    if (safeLimit <= 0) return [];

    const excluded = uniqInt(excludeIds);
    const result = await query(
        `SELECT s.id
       FROM songs s
       LEFT JOIN dislikes d ON d.song_id = s.id AND d.user_id = $1
      WHERE COALESCE(s.is_available, true) = true
        AND d.song_id IS NULL
        AND NOT (s.id = ANY($2::int[]))
      ORDER BY
        COALESCE(s.popularity, 0) DESC,
        COALESCE(s.play_count, 0) DESC,
        RANDOM()
      LIMIT $3`,
        [userId, excluded.length > 0 ? excluded : [0], safeLimit]
    );

    return uniqInt((result.rows || []).map((row) => row.id));
}

async function expandRankedIdsIfNeeded(userId, rankedIds, retrieval, excludeIds, desired, context) {
    const safeDesired = Math.min(Math.max(Number(desired) || 0, 1), 100);
    const baseIds = uniqInt(rankedIds);
    if (baseIds.length >= safeDesired) return baseIds.slice(0, safeDesired);

    const needed = safeDesired - baseIds.length;
    let expansionIds = await loadCatalogExpansionIds(
        userId,
        mergeUniqueInt(excludeIds, baseIds),
        needed
    );

    if (expansionIds.length < needed) {
        const recentExcludeWindow = uniqInt(excludeIds).slice(-100);
        const relaxedIds = await loadCatalogExpansionIds(
            userId,
            mergeUniqueInt(recentExcludeWindow, mergeUniqueInt(baseIds, expansionIds)),
            needed - expansionIds.length
        );
        expansionIds = mergeUniqueInt(expansionIds, relaxedIds);
    }

    if (expansionIds.length === 0) return baseIds;

    const sourceScores = retrieval?.scores instanceof Map ? retrieval.scores : new Map();
    const sourceBuckets = retrieval?.sourceBuckets instanceof Map ? retrieval.sourceBuckets : new Map();
    for (const id of expansionIds) {
        if (!sourceScores.has(id)) {
            sourceScores.set(id, 0.14);
        }
        if (!sourceBuckets.has(id)) {
            sourceBuckets.set(id, 'discovery');
        }
    }

    const expansionCandidates = await fetchCandidateObjects(
        userId,
        expansionIds,
        sourceScores,
        sourceBuckets
    );
    if (expansionCandidates.length === 0) return baseIds;

    const rankedExpansion = await rankCandidateList(userId, expansionCandidates, safeDesired - baseIds.length, context);
    const expansionRankedIds = (Array.isArray(rankedExpansion) ? rankedExpansion : []).map((x) => x.id);
    return mergeUniqueInt(baseIds, expansionRankedIds).slice(0, safeDesired);
}

async function buildTracksResponse(userId, rankedIds) {
    const tracksRaw = await fetchTracksByIds(rankedIds);
    const tracks = Array.isArray(tracksRaw) ? tracksRaw : [];
    if (tracks.length > 0) {
        await bloomMarkSeen(userId, tracks.map((t) => t.id));
    }
    return tracks;
}

async function loadSessionExcludeIds(sessionId) {
    if (!sessionId || typeof sessionId !== 'string') {
        return [];
    }
    try {
        return await redis.loadSessionExcludeIds(sessionId);
    } catch {
        return [];
    }
}

async function persistSessionExcludeIds(sessionId, ids) {
    if (!sessionId || typeof sessionId !== 'string') {
        return;
    }
    const normalized = uniqInt(ids);
    if (normalized.length === 0) {
        return;
    }
    await redis.appendSessionExcludeIds(sessionId, normalized, config.recommendations.maxExcludeIds, config.engineV2.sessionTtlSeconds)
        .catch(() => null);
}

async function initSessionV2(userId, preferences, forceNew, limit, excludeIds = []) {
    const uid = sanitizeUserId(userId);
    const sessionId = await ensureSession(uid, { forceNew: forceNew === true });

    const sessionExcludeIds = await loadSessionExcludeIds(sessionId);

    const retrieval = await retrieveCandidatesCompat(uid, { sessionId });

    await applyRepulsionScores(uid, retrieval.scores, retrieval.recentTrackIds);

    const desired = Math.min(Math.max(Number(limit) || 0, 1), 100);
    const filteredIds = await selectFilteredCandidateIds(uid, retrieval.ids, excludeIds, sessionExcludeIds, desired, sessionId);

    const candidates = await fetchCandidateObjects(uid, filteredIds, retrieval.scores, retrieval.sourceBuckets);

    const rankWindow = getRankWindowSize(limit, candidates.length);
    const ranked = await rankCandidateList(uid, candidates, rankWindow, {
        isEvening: retrieval.evening === true,
        seedTempo: retrieval.seedTempo,
        sessionId,
    });

    const mixedRanked = applyTasteMixToRanked(ranked, retrieval.sourceBuckets, limit, retrieval.sourceMix);
    const expansionExclude = mergeUniqueInt(excludeIds, sessionExcludeIds);
    const rankedIds = await expandRankedIdsIfNeeded(
        uid,
        mixedRanked.map((x) => x.id),
        retrieval,
        expansionExclude,
        desired,
        {
            isEvening: retrieval.evening === true,
            seedTempo: retrieval.seedTempo,
            sessionId,
        }
    );
    const tracks = await buildTracksResponse(uid, rankedIds);
    const servedIds = tracks.map((t) => t && t.id != null ? t.id : null).filter((v) => v != null);
    const seedExclude = mergeUniqueInt(expansionExclude, servedIds);
    await persistSessionExcludeIds(sessionId, seedExclude).catch(() => null);

    return enrichDeliveryResponse(uid, sessionId, {
        sessionId,
        tracks,
        hasMore: tracks.length > 0 || filteredIds.length > 0 || retrieval.ids.length > 0,
        recommendationMeta: buildRecommendationMeta(retrieval, servedIds),
        ...diagnosticsPayload(retrieval, servedIds),
    });
}

async function nextBatchV2(userId, sessionId, count, excludeIds) {
    const uid = sanitizeUserId(userId);

    const sid = typeof sessionId === 'string' ? sessionId.trim() : '';

    if (sid.length > 0) {
        await redis.touchEphemeralSession(uid, sid, config.engineV2.sessionTtlSeconds);
    }

    const sessionExcludeIds = sid.length > 0 ? await loadSessionExcludeIds(sid) : [];

    const retrieval = await retrieveCandidatesCompat(uid, { sessionId: sid });

    await applyRepulsionScores(uid, retrieval.scores, retrieval.recentTrackIds);

    const desired = Math.min(Math.max(Number(count) || 0, 1), 100);
    const filteredIds = await selectFilteredCandidateIds(uid, retrieval.ids, excludeIds, sessionExcludeIds, desired, sid || null);

    const candidates = await fetchCandidateObjects(uid, filteredIds, retrieval.scores, retrieval.sourceBuckets);

    const rankWindow = getRankWindowSize(count, candidates.length);
    const ranked = await rankCandidateList(uid, candidates, rankWindow, {
        isEvening: retrieval.evening === true,
        seedTempo: retrieval.seedTempo,
        sessionId: sid || null,
    });

    const mixedRanked = applyTasteMixToRanked(ranked, retrieval.sourceBuckets, count, retrieval.sourceMix);
    const expansionExclude = mergeUniqueInt(excludeIds, sessionExcludeIds);
    const rankedIds = await expandRankedIdsIfNeeded(
        uid,
        mixedRanked.map((x) => x.id),
        retrieval,
        expansionExclude,
        desired,
        {
            isEvening: retrieval.evening === true,
            seedTempo: retrieval.seedTempo,
            sessionId: sid || null,
        }
    );
    const tracks = await buildTracksResponse(uid, rankedIds);
    const servedIds = tracks.map((t) => t && t.id != null ? t.id : null).filter((v) => v != null);

    if (sid.length > 0) {
        await persistSessionExcludeIds(sid, servedIds).catch(() => null);
    }

    return enrichDeliveryResponse(uid, sid || null, {
        tracks,
        hasMore: tracks.length > 0 || filteredIds.length > 0 || retrieval.ids.length > 0,
        recommendationMeta: buildRecommendationMeta(retrieval, servedIds),
        ...diagnosticsPayload(retrieval, servedIds),
    });
}

module.exports = {
    initSessionV2,
    nextBatchV2,
    retrieveCandidates: retrieveCandidatesCompat,
};
