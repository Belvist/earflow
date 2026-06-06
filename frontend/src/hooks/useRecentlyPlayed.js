import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * @typedef {Object} RecentTrack
 * @property {number|string} id
 * @property {string} title
 * @property {string} artist
 * @property {string} [album]
 * @property {string|null} cover_path
 * @property {number} [duration]
 * @property {number} playedAt  Timestamp (ms)
 */

const STORAGE_KEY_PREFIX = 'earflow:recentlyPlayed:';
const GUEST_STORAGE_KEY = `${STORAGE_KEY_PREFIX}__guest__`;
const MAX_ENTRIES = 50;
const PERSIST_DEBOUNCE_MS = 400;

/**
 * @param {string|number|null|undefined} userId
 * @returns {string}
 */
function buildStorageKey(userId) {
    if (userId == null) return GUEST_STORAGE_KEY;
    const raw = String(userId).trim();
    return raw ? `${STORAGE_KEY_PREFIX}${raw}` : GUEST_STORAGE_KEY;
}

/**
 * @param {unknown} value
 * @returns {RecentTrack[]}
 */
function sanitizeStoredList(value) {
    if (!Array.isArray(value)) return [];
    const out = [];
    const seenIds = new Set();
    for (const raw of value) {
        if (!raw || typeof raw !== 'object') continue;
        const id = raw.id;
        if (id == null) continue;
        const key = String(id);
        if (seenIds.has(key)) continue;
        seenIds.add(key);
        const playedAt = Number(raw.playedAt);
        out.push({
            id,
            title: typeof raw.title === 'string' ? raw.title : '',
            artist: typeof raw.artist === 'string' ? raw.artist : '',
            album: typeof raw.album === 'string' ? raw.album : '',
            cover_path: typeof raw.cover_path === 'string' ? raw.cover_path : null,
            duration: Number.isFinite(Number(raw.duration)) ? Number(raw.duration) : 0,
            playedAt: Number.isFinite(playedAt) && playedAt > 0 ? playedAt : Date.now(),
        });
        if (out.length >= MAX_ENTRIES) break;
    }
    return out;
}

/**
 * @param {string} key
 * @returns {RecentTrack[]}
 */
function loadFromStorage(key) {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return [];
        const raw = window.localStorage.getItem(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return sanitizeStoredList(parsed);
    } catch {
        return [];
    }
}

/**
 * @param {string} key
 * @param {RecentTrack[]} list
 */
function saveToStorage(key, list) {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return;
        const safe = Array.isArray(list) ? list.slice(0, MAX_ENTRIES) : [];
        window.localStorage.setItem(key, JSON.stringify(safe));
    } catch {
        // Quota / privacy-mode — swallow silently: feature is non-critical.
    }
}

/**
 * @param {*} track
 * @returns {RecentTrack|null}
 */
function normalizeTrackForHistory(track) {
    if (!track || typeof track !== 'object') return null;
    const id = track.id;
    if (id == null) return null;
    const coverPath = (() => {
        const candidates = [track.cover_path, track.coverPath, track.cover];
        for (const c of candidates) {
            if (typeof c === 'string' && c.trim()) return c.trim();
        }
        return null;
    })();
    const duration = Number(track.duration ?? track.duration_seconds ?? track.durationSeconds);
    return {
        id,
        title: typeof track.title === 'string' ? track.title : '',
        artist: typeof track.artist === 'string' ? track.artist : '',
        album: typeof track.album === 'string' ? track.album : '',
        cover_path: coverPath,
        duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
        playedAt: Date.now(),
    };
}

/**
 * Hook that maintains a per-user rolling history of recently played tracks
 * in localStorage. Entries are deduped by track id (most-recent wins).
 *
 * @param {*} currentTrack
 * @param {string|number|null|undefined} userId
 * @returns {{
 *   recentlyPlayed: RecentTrack[],
 *   clearRecentlyPlayed: () => void,
 *   recordPlayed: (track: unknown) => void,
 * }}
 */
export function useRecentlyPlayed(currentTrack, userId) {
    const storageKey = buildStorageKey(userId);
    const [list, setList] = useState(() => loadFromStorage(storageKey));

    const latestKeyRef = useRef(storageKey);
    const lastRecordedIdRef = useRef(null);
    const persistTimerRef = useRef(0);

    // Swap storage namespace on user change (login/logout).
    useEffect(() => {
        if (latestKeyRef.current === storageKey) return;
        latestKeyRef.current = storageKey;
        setList(loadFromStorage(storageKey));
        lastRecordedIdRef.current = null;
    }, [storageKey]);

    const persistLater = useCallback((next) => {
        if (persistTimerRef.current) {
            clearTimeout(persistTimerRef.current);
        }
        persistTimerRef.current = window.setTimeout(() => {
            persistTimerRef.current = 0;
            saveToStorage(latestKeyRef.current, next);
        }, PERSIST_DEBOUNCE_MS);
    }, []);

    const recordPlayed = useCallback((track) => {
        const entry = normalizeTrackForHistory(track);
        if (!entry) return;
        const idKey = String(entry.id);
        if (lastRecordedIdRef.current === idKey) return;
        lastRecordedIdRef.current = idKey;

        setList((prev) => {
            const filtered = prev.filter((t) => String(t.id) !== idKey);
            const next = [entry, ...filtered].slice(0, MAX_ENTRIES);
            persistLater(next);
            return next;
        });
    }, [persistLater]);

    const clearRecentlyPlayed = useCallback(() => {
        lastRecordedIdRef.current = null;
        setList([]);
        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                window.localStorage.removeItem(latestKeyRef.current);
            }
        } catch {
            // swallow
        }
    }, []);

    // Auto-record when a new currentTrack arrives from PlayerContext.
    useEffect(() => {
        if (!currentTrack || typeof currentTrack !== 'object') return;
        const id = currentTrack.id;
        if (id == null) return;
        const idKey = String(id);
        if (lastRecordedIdRef.current === idKey) return;
        recordPlayed(currentTrack);
    }, [currentTrack, recordPlayed]);

    // Flush pending timer on unmount.
    useEffect(() => () => {
        if (persistTimerRef.current) {
            clearTimeout(persistTimerRef.current);
            persistTimerRef.current = 0;
        }
    }, []);

    return { recentlyPlayed: list, clearRecentlyPlayed, recordPlayed };
}

export default useRecentlyPlayed;
