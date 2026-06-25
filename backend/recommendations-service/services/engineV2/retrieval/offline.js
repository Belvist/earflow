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

/**
 * Precomputed offline recommendations (reco-offline-worker → Redis).
 */
async function buildOfflineCandidates(userId) {
  const uid = Number.parseInt(String(userId), 10);
  if (!Number.isFinite(uid) || uid <= 0) {
    return { ids: [], sourceScore: 0 };
  }

  let ids = [];
  try {
    ids = await redis.loadOfflineRecommendations(uid);
  } catch {
    ids = [];
  }

  const list = uniqInt(ids);
  if (list.length === 0) {
    return { ids: [], sourceScore: 0 };
  }

  return {
    ids: list,
    sourceScore: 0.92,
  };
}

module.exports = {
  buildOfflineCandidates,
};
