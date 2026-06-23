export const getPlaylistTrackCount = (playlist) => {
    if (!playlist || typeof playlist !== 'object') return 0;
    const candidates = [playlist.track_count, playlist.tracks_count, playlist.trackCount];
    for (const v of candidates) {
        const n = typeof v === 'string' ? parseInt(v, 10) : v;
        if (Number.isFinite(n) && n >= 0) return n;
    }
    return 0;
};

export const applyPlaylistTrackCountDelta = (playlists, playlistId, delta) => {
    if (!Array.isArray(playlists) || !playlistId || !Number.isFinite(delta) || delta === 0) {
        return playlists;
    }

    return playlists.map((p) => {
        if (!p || p.id !== playlistId) return p;
        const currentCount = getPlaylistTrackCount(p);
        const nextCount = Math.max(currentCount + delta, 0);
        return {
            ...p,
            track_count: nextCount,
            tracks_count: nextCount,
            trackCount: nextCount,
        };
    });
};

export const makeDebouncedRefetch = (fn, delayMs = 500) => {
    let timer = null;
    return () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            fn();
        }, delayMs);
    };
};

const PLAYLIST_CHANGED_EVENT = 'earflow:playlist-changed';

export const notifyPlaylistChanged = (payload) => {
    if (typeof window === 'undefined') return;
    try {
        window.dispatchEvent(new CustomEvent(PLAYLIST_CHANGED_EVENT, { detail: payload }));
    } catch {
    }
};

export const subscribePlaylistChanged = (handler) => {
    if (typeof window === 'undefined') return () => { };
    if (typeof handler !== 'function') return () => { };
    const listener = (e) => {
        try {
            handler(e?.detail);
        } catch {
        }
    };
    window.addEventListener(PLAYLIST_CHANGED_EVENT, listener);
    return () => {
        window.removeEventListener(PLAYLIST_CHANGED_EVENT, listener);
    };
};
