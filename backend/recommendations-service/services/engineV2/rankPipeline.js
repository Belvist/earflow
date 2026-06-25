/**
 * Single ranking pipeline: Go ranking-service primary, Node rankLocally degraded fallback.
 * @module services/engineV2/rankPipeline
 */

const axios = require('axios');
const config = require('../../config');
const { rankWithService, rankLocally } = require('./ranking');

async function rankCandidateList(userId, candidates, limit, context = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 0, 1), 100);
    const list = Array.isArray(candidates) ? candidates : [];
    if (list.length === 0) return [];

    const url = config.engineV2.rankingServiceUrl;
    const timeoutMs = config.engineV2.rankingTimeoutMs;
    const rankCtx = {
        isEvening: context?.isEvening === true,
        seedTempo: context?.seedTempo != null ? Number(context.seedTempo) : null,
        sessionId: typeof context?.sessionId === 'string' ? context.sessionId : null,
    };

    if (url) {
        try {
            return await rankWithService(axios, url, timeoutMs, list, safeLimit, rankCtx);
        } catch {
            return rankLocally(list, safeLimit, rankCtx);
        }
    }

    return rankLocally(list, safeLimit, rankCtx);
}

module.exports = {
    rankCandidateList,
};
