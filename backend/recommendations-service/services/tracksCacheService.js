const { LRUCache } = require('lru-cache');
const config = require('../config');
const { createLogger, logError } = require('../lib/logger');
const { fetchTracksByIds } = require('../lib/database');
const redis = require('../lib/redis');

const logger = createLogger('tracks-cache-service');

const tracksCache = new LRUCache({
    max: config.cache.tracksMaxSize,
    ttl: config.cache.tracksTtlMs,
    updateAgeOnGet: true,
});

function normalizePositiveIntIds(ids) {
    return (Array.isArray(ids) ? ids : [])
        .map((id) => Number.parseInt(id, 10))
        .filter((id) => Number.isFinite(id) && id > 0);
}

function isCacheValid(track) {
    if (!track || typeof track !== 'object') return false;
    return typeof track.has_ebap === 'boolean' || typeof track.hasEbap === 'boolean';
}

function maybeLogNormalizedIdsEmpty(ids) {
    if (config.debug?.diagnosticsEnabled !== true) return;
    const inputCount = Array.isArray(ids) ? ids.length : 0;
    if (inputCount === 0) return;

    logger.warn({
        op: 'getTracksWithCache',
        reason: 'orderedIds-empty',
        inputCount,
        sample: Array.isArray(ids) ? ids.slice(0, 10) : [],
    }, 'Diagnostics: getTracksWithCache received ids but normalized list is empty');
}

function readFromMemoryCache(orderedIds) {
    const hits = [];
    const misses = [];

    for (const id of orderedIds) {
        const cached = tracksCache.get(id);
        if (cached && isCacheValid(cached)) {
            hits.push(cached);
        } else {
            if (cached) tracksCache.delete(id);
            misses.push(id);
        }
    }

    return { hits, misses };
}

async function readFromRedisCache(ids) {
    if (ids.length === 0) return { hits: [], misses: [] };

    try {
        const { cached: redisCached, missing } = await redis.getCachedTracksBatch(ids);

        const hits = [];
        const staleIds = [];

        for (const [id, track] of redisCached) {
            if (!isCacheValid(track)) {
                staleIds.push(id);
                continue;
            }
            tracksCache.set(id, track);
            hits.push(track);
        }

        if (staleIds.length > 0) {
            await Promise.all(staleIds.map((id) => redis.invalidateTrackCache(id).catch(() => null)));
        }

        return { hits, misses: [...missing, ...staleIds] };
    } catch (err) {
        logError(err, 'redis-track-cache');
        return { hits: [], misses: ids };
    }
}

async function readFromDatabase(ids) {
    if (ids.length === 0) return [];
    const tracks = await fetchTracksByIds(ids);

    for (const track of tracks) {
        tracksCache.set(track.id, track);
    }

    if (tracks.length > 0) {
        redis.cacheTracksBatch(tracks).catch((err) => {
            logError(err, 'redis-track-cache-write');
        });
    }

    return tracks;
}

function restoreOrder(orderedIds, tracks) {
    const map = new Map((Array.isArray(tracks) ? tracks : []).map((t) => [t.id, t]));
    return orderedIds.map((id) => map.get(id)).filter(Boolean);
}

async function getTracksWithCache(ids) {
    const orderedIds = normalizePositiveIntIds(ids);
    if (orderedIds.length === 0) {
        maybeLogNormalizedIdsEmpty(ids);
        return [];
    }

    const { hits: memoryHits, misses: memoryMisses } = readFromMemoryCache(orderedIds);
    const { hits: redisHits, misses: redisMisses } = await readFromRedisCache(memoryMisses);
    const dbTracks = await readFromDatabase(redisMisses);

    return restoreOrder(orderedIds, [...memoryHits, ...redisHits, ...dbTracks]);
}

module.exports = {
    getTracksWithCache,
};
