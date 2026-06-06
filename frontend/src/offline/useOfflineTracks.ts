import { useCallback, useEffect, useRef, useState } from 'react';
import {
    listTracks,
    listTrackIds,
    deleteTrack as deleteTrackDb,
    clearAll,
    computeTotalBytes,
    hasTrack,
    getStorageQuota,
    requestPersistentStorage,
    type OfflineTrackMeta,
    type StorageQuota,
} from './OfflineStorage';
import {
    downloadTrack as downloadTrackCore,
    resolveTrackStreamUrl,
    type DownloadResult,
    type DownloadTrackInput,
} from './OfflineDownloader';

/**
 * Главный хук для работы с офлайн-треками.
 * Единая точка истины для списка скачанных id, прогресса загрузки и квоты.
 *
 * ВАЖНО:
 *   - state.downloadQueue и state.activeDownload — детерминированы и имеют одну in-flight задачу
 *   - отмена через AbortController сохраняется при unmount компонента
 */

export interface OfflineDownloadTask {
    trackId: string;
    title: string;
    loaded: number;
    total: number;
    startedAt: number;
}

export interface OfflineTracksState {
    offlineIds: Set<string>;
    tracks: OfflineTrackMeta[];
    totalBytes: number;
    quota: StorageQuota | null;
    active: OfflineDownloadTask | null;
    queue: DownloadTrackInput[];
}

interface UseOfflineTracksOptions {
    apiClient: {
        getSongDirectSession?: (_id: string | number, _opts?: { signal?: AbortSignal }) => Promise<any>;
    } | null;
}

const REFRESH_INTERVAL_MS = 30_000;

export function useOfflineTracks({ apiClient }: UseOfflineTracksOptions) {
    const [offlineIds, setOfflineIds] = useState<Set<string>>(() => new Set());
    const [tracks, setTracks] = useState<OfflineTrackMeta[]>([]);
    const [totalBytes, setTotalBytes] = useState<number>(0);
    const [quota, setQuota] = useState<StorageQuota | null>(null);
    const [active, setActive] = useState<OfflineDownloadTask | null>(null);
    const [queue, setQueue] = useState<DownloadTrackInput[]>([]);

    const abortRef = useRef<AbortController | null>(null);
    const processingRef = useRef<boolean>(false);
    const mountedRef = useRef<boolean>(true);
    const queueRef = useRef<DownloadTrackInput[]>([]);

    const syncQueue = useCallback((updater: (_prev: DownloadTrackInput[]) => DownloadTrackInput[]) => {
        const next = updater(queueRef.current);
        queueRef.current = next;
        if (mountedRef.current) setQueue(next);
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            if (abortRef.current) {
                try { abortRef.current.abort(); } catch { }
                abortRef.current = null;
            }
            // Сбрасываем флаг обработки, иначе после re-mount (StrictMode / navigation)
            // processQueue будет "залипать" на processingRef=true и очередь встанет.
            processingRef.current = false;
        };
    }, []);

    const refresh = useCallback(async () => {
        try {
            const [ids, all, bytes, q] = await Promise.all([
                listTrackIds(),
                listTracks(),
                computeTotalBytes(),
                getStorageQuota(),
            ]);
            if (!mountedRef.current) return;
            setOfflineIds(new Set(ids));
            setTracks(all.slice().sort((a, b) => b.addedAt - a.addedAt));
            setTotalBytes(bytes);
            setQuota(q);
        } catch { }
    }, []);

    useEffect(() => {
        refresh();
        const timer = window.setInterval(refresh, REFRESH_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, [refresh]);

    const processQueue = useCallback(async () => {
        if (processingRef.current) return;
        if (!apiClient) return;

        processingRef.current = true;

        try {
            while (mountedRef.current) {
                const head = queueRef.current[0];
                if (!head) break;
                syncQueue((prev) => prev.slice(1));

                const current = head;

                const already = await hasTrack(current.id);
                if (already) continue;

                const ac = new AbortController();
                abortRef.current = ac;

                setActive({
                    trackId: current.id,
                    title: current.title,
                    loaded: 0,
                    total: 0,
                    startedAt: Date.now(),
                });

                let resolvedStreamUrl = current.streamUrl;
                let resolvedMime = current.mime;
                let resolvedQuality = current.quality;

                if (!resolvedStreamUrl && apiClient) {
                    const sess = await resolveTrackStreamUrl(apiClient, current.id, ac.signal);
                    if (sess) {
                        resolvedStreamUrl = sess.url;
                        resolvedMime = sess.mime;
                        resolvedQuality = sess.quality;
                    }
                }

                if (!resolvedStreamUrl) {
                    setActive(null);
                    continue;
                }

                const result: DownloadResult = await downloadTrackCore(
                    { ...current, streamUrl: resolvedStreamUrl, mime: resolvedMime, quality: resolvedQuality },
                    ac.signal,
                    (loaded, total) => {
                        if (!mountedRef.current) return;
                        setActive((prev) => (prev && prev.trackId === current.id ? { ...prev, loaded, total } : prev));
                    },
                );

                abortRef.current = null;

                if (!mountedRef.current) break;

                if (result.ok || result.reason === 'ALREADY_EXISTS') {
                    setOfflineIds((prev) => {
                        if (prev.has(current.id)) return prev;
                        const next = new Set(prev);
                        next.add(current.id);
                        return next;
                    });
                }

                setActive(null);

                if (result.reason === 'QUOTA_EXCEEDED') {
                    syncQueue(() => []);
                    break;
                }
            }
        } finally {
            processingRef.current = false;
            await refresh();
        }
    }, [apiClient, refresh]);

    useEffect(() => {
        if (queue.length === 0) return;
        if (processingRef.current) return;
        void processQueue();
    }, [queue, processQueue]);

    const enqueue = useCallback((tasks: DownloadTrackInput | DownloadTrackInput[]) => {
        const arr = Array.isArray(tasks) ? tasks : [tasks];
        const valid = arr.filter((t) => t && t.id);
        if (valid.length === 0) return;
        syncQueue((prev) => {
            const seen = new Set(prev.map((t) => t.id));
            const merged = [...prev];
            for (const v of valid) {
                if (!seen.has(v.id)) {
                    merged.push(v);
                    seen.add(v.id);
                }
            }
            return merged;
        });
    }, [syncQueue]);

    const cancelActive = useCallback(() => {
        if (abortRef.current) {
            try { abortRef.current.abort(); } catch { }
            abortRef.current = null;
        }
    }, []);

    const clearQueue = useCallback(() => {
        syncQueue(() => []);
        cancelActive();
    }, [cancelActive, syncQueue]);

    const removeTrack = useCallback(async (trackId: string) => {
        await deleteTrackDb(trackId);
        if (!mountedRef.current) return;
        setOfflineIds((prev) => {
            if (!prev.has(trackId)) return prev;
            const next = new Set(prev);
            next.delete(trackId);
            return next;
        });
        await refresh();
    }, [refresh]);

    const removeAll = useCallback(async () => {
        cancelActive();
        syncQueue(() => []);
        await clearAll();
        if (!mountedRef.current) return;
        setOfflineIds(new Set());
        setTracks([]);
        setTotalBytes(0);
        await refresh();
    }, [cancelActive, refresh, syncQueue]);

    const ensurePersistent = useCallback(async () => {
        return await requestPersistentStorage();
    }, []);

    return {
        offlineIds,
        tracks,
        totalBytes,
        quota,
        active,
        queue,
        enqueue,
        cancelActive,
        clearQueue,
        removeTrack,
        removeAll,
        refresh,
        ensurePersistent,
    };
}
