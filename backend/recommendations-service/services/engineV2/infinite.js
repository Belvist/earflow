const { initSessionV2, nextBatchV2 } = require('./index');

async function infiniteFeedV2(userId, sessionId, offset, limit, excludeIds) {
    const off = Number.isFinite(Number(offset)) ? Number(offset) : 0;
    const lim = Math.min(Math.max(Number(limit) || 20, 1), 100);

    if (!sessionId) {
        const init = await initSessionV2(userId, {}, false, lim, excludeIds);
        const tracks = Array.isArray(init.tracks) ? init.tracks : [];
    return {
        sessionId: init.sessionId || null,
        tracks,
        hasMore: init.hasMore === true,
        offset: off + tracks.length,
        nextOffset: off + tracks.length,
        recommendationMeta: init.recommendationMeta || null,
        sessionState: init.sessionState || null,
        clientActions: init.clientActions || null,
    };
    }

    const next = await nextBatchV2(userId, sessionId, lim, excludeIds);
    const tracks = Array.isArray(next.tracks) ? next.tracks : [];

    if (tracks.length === 0 && next.hasMore === true) {
        const fresh = await initSessionV2(userId, {}, true, lim, excludeIds);
        const freshTracks = Array.isArray(fresh.tracks) ? fresh.tracks : [];
        return {
            sessionId: fresh.sessionId || sessionId || null,
            tracks: freshTracks,
            hasMore: fresh.hasMore === true || freshTracks.length > 0,
            offset: off + freshTracks.length,
            nextOffset: off + freshTracks.length,
            recommendationMeta: fresh.recommendationMeta || null,
            sessionState: fresh.sessionState || null,
            clientActions: fresh.clientActions || null,
        };
    }

    return {
        sessionId: sessionId || null,
        tracks,
        hasMore: next.hasMore === true,
        offset: off + tracks.length,
        nextOffset: off + tracks.length,
        recommendationMeta: next.recommendationMeta || null,
        sessionState: next.sessionState || null,
        clientActions: next.clientActions || null,
    };
}

module.exports = {
    infiniteFeedV2,
};
