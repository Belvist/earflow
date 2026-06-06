/**
 * usePlaylists Hook
 * Хук для загрузки и генерации плейлистов
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import apiClient from '../../../api/client';
import { useAuth } from '../../../context/AuthContext';
import { getPlaylistCacheOwnerKey } from '../utils/playlistCachePolicy';

// Кэш для предотвращения дублирующих запросов (привязан к пользователю — без утечек между сессиями)
let playlistsCache = null;
let playlistsCacheOwnerKey = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 60000; // 1 минута

/**
 * Хук для работы с плейлистами
 * @param {Object} options - опции
 * @param {number} options.maxItems - максимальное количество плейлистов
 * @param {boolean} options.autoLoad - автоматическая загрузка при монтировании
 * @returns {Object} - состояние и методы
 */
const usePlaylists = ({ maxItems = 6, autoLoad = true } = {}) => {
    const { authReady, isAuthenticated, user } = useAuth();
    const [playlists, setPlaylists] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const playlistsRef = useRef([]);
    const isLoadingRef = useRef(false);
    const isMountedRef = useRef(true);

    useEffect(() => {
        playlistsRef.current = playlists;
    }, [playlists]);

    /**
     * Генерация плейлистов на основе треков
     */
    const generatePlaylists = useCallback(async (forceRefresh = false) => {
        if (!authReady) {
            setLoading(false);
            return;
        }
        const ownerKey = isAuthenticated ? getPlaylistCacheOwnerKey(user) : 'anon';
        if (!ownerKey) {
            isLoadingRef.current = false;
            setLoading(false);
            return;
        }
        // Проверяем кэш (только для того же пользователя)
        const now = Date.now();
        if (
            !forceRefresh
            && playlistsCache
            && playlistsCacheOwnerKey === ownerKey
            && (now - cacheTimestamp) < CACHE_DURATION
        ) {
            setPlaylists(playlistsCache.slice(0, maxItems));
            setLoading(false);
            return;
        }

        // Предотвращаем параллельные запросы
        if (isLoadingRef.current) return;
        isLoadingRef.current = true;

        setLoading(true);
        setError(null);

        try {
            const result = await apiClient.getDiscoverRails({});
            if (!isMountedRef.current) return;

            const rails = Array.isArray(result?.rails) ? result.rails : [];
            const backendPlaylists = rails
                .flatMap((rail) => (rail && Array.isArray(rail.playlists) ? rail.playlists : []))
                .filter(Boolean);

            playlistsCache = backendPlaylists;
            playlistsCacheOwnerKey = ownerKey;
            cacheTimestamp = Date.now();

            if (isMountedRef.current) {
                setPlaylists(backendPlaylists.slice(0, maxItems));
            }
        } catch (err) {
            if (isMountedRef.current) {
                setError(err.message);
                if (!playlistsRef.current || playlistsRef.current.length === 0) {
                    setPlaylists([]);
                }
            }
        } finally {
            isLoadingRef.current = false;
            if (isMountedRef.current) {
                setLoading(false);
            }
        }
    }, [authReady, maxItems, isAuthenticated, user]);

    /** Сброс кэша при выходе или смене аккаунта (конфиденциальность) */
    useEffect(() => {
        if (!authReady) {
            return;
        }
        if (!isAuthenticated) {
            playlistsCache = null;
            playlistsCacheOwnerKey = null;
            cacheTimestamp = 0;
        }
        const nextOwner = isAuthenticated ? getPlaylistCacheOwnerKey(user) : 'anon';
        if (!nextOwner) return;
        if (playlistsCacheOwnerKey != null && playlistsCacheOwnerKey !== nextOwner) {
            playlistsCache = null;
            playlistsCacheOwnerKey = null;
            cacheTimestamp = 0;
            setPlaylists([]);
        }
    }, [authReady, isAuthenticated, user]);

    // Автозагрузка при монтировании
    useEffect(() => {
        isMountedRef.current = true;

        if (autoLoad && authReady) {
            generatePlaylists();
        }

        return () => {
            isMountedRef.current = false;
        };
    }, [autoLoad, authReady, generatePlaylists]);

    /**
     * Получает уникальные обложки из треков
     */
    const getUniqueCovers = useCallback((tracks, maxCovers = 4) => {
        if (!Array.isArray(tracks)) return [];

        const seenUrls = new Set();
        const covers = [];

        for (const track of tracks) {
            const coverUrl = apiClient.getCoverUrl(track);
            if (coverUrl && !seenUrls.has(coverUrl)) {
                seenUrls.add(coverUrl);
                covers.push(coverUrl);
                if (covers.length >= maxCovers) break;
            }
        }

        return covers;
    }, []);

    /**
     * Featured плейлист (первый с isFeatured: true)
     */
    const featuredPlaylist = useMemo(() =>
        playlists.find(p => p.isFeatured) || null,
        [playlists]);

    /**
     * Обычные плейлисты (без featured)
     */
    const regularPlaylists = useMemo(() =>
        playlists.filter(p => !p.isFeatured),
        [playlists]);

    /**
     * Принудительное обновление плейлистов
     */
    const refresh = useCallback(() => {
        return generatePlaylists(true);
    }, [generatePlaylists]);

    return {
        playlists,
        featuredPlaylist,
        regularPlaylists,
        loading,
        error,
        refresh,
        getUniqueCovers
    };
};

export default usePlaylists;
