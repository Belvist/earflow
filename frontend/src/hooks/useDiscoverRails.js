import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import apiClient from '../api/client';

const DEFAULT_TTL_MS = 60 * 1000;

const MAX_CACHE_ENTRIES = 50;

const cachedBySeed = new Map();

function pruneCache(map, maxEntries) {
    if (!(map instanceof Map)) return;
    const max = Number.isFinite(maxEntries) ? maxEntries : MAX_CACHE_ENTRIES;
    if (map.size <= max) return;

    const entries = Array.from(map.entries())
        .map(([key, value]) => ({ key, at: value?.at ?? 0 }))
        .sort((a, b) => (a.at ?? 0) - (b.at ?? 0));

    const toDelete = entries.slice(0, Math.max(0, map.size - max));
    for (const item of toDelete) {
        map.delete(item.key);
    }
}

export default function useDiscoverRails({ seed, authScope = 'anon', autoLoad = true, ttlMs = DEFAULT_TTL_MS } = {}) {
    const effectiveSeed = useMemo(() => (seed === undefined || seed === null ? '' : String(seed)), [seed]);
    const effectiveAuthScope = useMemo(() => {
        const raw = authScope === undefined || authScope === null ? 'anon' : String(authScope);
        return raw.trim() || 'anon';
    }, [authScope]);
    const cacheKey = useMemo(() => `${effectiveAuthScope}:${effectiveSeed}`, [effectiveAuthScope, effectiveSeed]);
    const initialCached = useMemo(() => {
        const entry = cachedBySeed.get(cacheKey);
        return entry?.data ?? null;
    }, [cacheKey]);

    const [data, setData] = useState(initialCached);
    const [loading, setLoading] = useState(autoLoad && !initialCached);
    const [error, setError] = useState(null);

    const abortRef = useRef(null);
    const isMountedRef = useRef(true);
    const previousCacheKeyRef = useRef(cacheKey);

    const load = useCallback(async (force = false) => {
        const now = Date.now();
        const cachedEntry = cachedBySeed.get(cacheKey);
        const cachedData = cachedEntry?.data ?? null;
        const cachedAt = typeof cachedEntry?.at === 'number' ? cachedEntry.at : 0;
        if (!force && cachedData && (now - cachedAt) < ttlMs) {
            setData(cachedData);
            setLoading(false);
            return cachedData;
        }

        if (abortRef.current) {
            try { abortRef.current.abort(); } catch { }
        }

        const controller = new AbortController();
        abortRef.current = controller;

        setLoading(true);
        setError(null);

        try {
            const result = await apiClient.getDiscoverRails({ seed: effectiveSeed, signal: controller.signal });
            if (!isMountedRef.current) return null;

            cachedBySeed.set(cacheKey, { data: result, at: Date.now() });
            pruneCache(cachedBySeed, MAX_CACHE_ENTRIES);
            setData(result);
            return result;
        } catch (e) {
            if (!isMountedRef.current) return null;
            if (e?.name === 'AbortError') return null;
            setError(e?.message ? e.message : 'Failed to load discover rails');
            return null;
        } finally {
            if (isMountedRef.current) {
                setLoading(false);
            }
        }
    }, [cacheKey, effectiveSeed, ttlMs]);

    useEffect(() => {
        isMountedRef.current = true;

        const cacheKeyChanged = previousCacheKeyRef.current !== cacheKey;
        previousCacheKeyRef.current = cacheKey;

        setData((prev) => (initialCached ?? (cacheKeyChanged ? null : prev)));
        if (!autoLoad && isMountedRef.current) {
            setLoading(false);
        }

        if (autoLoad) {
            load(false);
        }

        return () => {
            isMountedRef.current = false;
            if (abortRef.current) {
                try { abortRef.current.abort(); } catch { }
            }
        };
    }, [autoLoad, cacheKey, initialCached, load]);

    const rails = useMemo(() => {
        const r = data && Array.isArray(data.rails) ? data.rails : [];
        return r.filter((rail) => rail && Array.isArray(rail.playlists) && rail.playlists.length > 0);
    }, [data]);

    return {
        data,
        rails,
        loading,
        error,
        refresh: () => load(true),
    };
}
