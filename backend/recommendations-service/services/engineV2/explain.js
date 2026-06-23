const config = require('../../config');
const { sanitizeUserId } = require('../../lib/validators');
const redis = require('../../lib/redis');
const { retrieveCandidates } = require('./internal');
const { bloomFilterIds } = require('./seenBloom');

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

async function explainInfiniteV2(userId, sessionId, offset, limit, excludeIds) {
    const uid = sanitizeUserId(userId);

    if (typeof sessionId === 'string' && sessionId.trim().length > 0) {
        await redis.touchEphemeralSession(uid, sessionId, config.engineV2.sessionTtlSeconds);
    }

    const retrieval = await retrieveCandidates(uid, { sessionId });

    const requestExclude = new Set(uniqInt(excludeIds));
    const afterRequestExclude = uniqInt(retrieval.ids).filter((id) => !requestExclude.has(id));
    const afterBloom = await bloomFilterIds(uid, afterRequestExclude);

    return {
        engine: 'v2',
        sessionId: sessionId || null,
        offset: Number.isFinite(Number(offset)) ? Number(offset) : 0,
        limit: Math.min(Math.max(Number(limit) || 20, 1), 100),
        counts: {
            retrieved: retrieval.ids.length,
            afterRequestExclude: afterRequestExclude.length,
            afterSeenBloom: afterBloom.length,
        },
        retrieval: {
            sourceMix: retrieval.sourceMix || null,
            sourceCounts: retrieval.sourceCounts || null,
            bucketAllocations: retrieval.bucketAllocations || null,
            bucketCounts: retrieval.bucketCounts || null,
            skipBurstMode: retrieval.skipBurstMode === true,
            onlineIntent: retrieval.onlineIntent || null,
        },
        seedTempo: retrieval.seedTempo,
        config: {
            maxCandidates: config.engineV2.maxCandidates,
            exactTasteRatio: config.engineV2.exactTasteRatio,
            nearTasteRatio: config.engineV2.nearTasteRatio,
            discoveryRatio: config.engineV2.discoveryRatio,
            bloomBits: config.engineV2.bloomBits,
            bloomHashes: config.engineV2.bloomHashes,
        },
    };
}

module.exports = {
    explainInfiniteV2,
};
