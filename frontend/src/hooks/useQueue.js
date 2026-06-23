/**
 * useQueue - Hook для управления очередью воспроизведения
 * Поддержка shuffle, repeat, play next
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import apiClient from '../api/client';
import useAuth from './useAuth';

// Режимы повтора
export const REPEAT_MODES = {
    OFF: 'off',
    ALL: 'all',
    ONE: 'one'
};

const useQueue = () => {
    const { isAuthenticated } = useAuth();
    const [queue, setQueue] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [shuffleEnabled, setShuffleEnabled] = useState(false);
    const [repeatMode, setRepeatMode] = useState(REPEAT_MODES.OFF);
    const [sourceType, setSourceType] = useState(null);
    const [sourceId, setSourceId] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const isSyncingRef = useRef(false);

    /**
     * Загрузить текущую очередь с сервера
     */
    const loadQueue = useCallback(async () => {
        if (!isAuthenticated) return;

        setLoading(true);
        setError(null);

        try {
            const response = await apiClient.request('/api/queue');

            setQueue(response.tracks || []);
            setCurrentIndex(response.state?.currentIndex || 0);
            setShuffleEnabled(response.state?.shuffleEnabled || false);
            setRepeatMode(response.state?.repeatMode || REPEAT_MODES.OFF);
            setSourceType(response.state?.sourceType || null);
            setSourceId(response.state?.sourceId || null);

            return response;
        } catch (err) {
            setError(err.message);
            return null;
        } finally {
            setLoading(false);
        }
    }, [isAuthenticated]);

    /**
     * Установить очередь из плейлиста
     */
    const setQueueFromPlaylist = useCallback(async (playlistId, startIndex = 0) => {
        if (!playlistId) return false;

        setLoading(true);
        setError(null);

        try {
            const response = await apiClient.request('/api/queue/set', {
                method: 'POST',
                body: JSON.stringify({
                    playlist_id: playlistId,
                    start_index: startIndex
                })
            });

            // Перезагружаем очередь для получения актуальных треков
            await loadQueue();

            return response;
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    }, [loadQueue]);

    /**
     * Установить очередь из массива ID песен
     */
    const setQueueFromSongs = useCallback(async (songIds, startIndex = 0) => {
        if (!songIds || songIds.length === 0) return false;

        setLoading(true);
        setError(null);

        try {
            const response = await apiClient.request('/api/queue/set', {
                method: 'POST',
                body: JSON.stringify({
                    song_ids: songIds,
                    start_index: startIndex
                })
            });

            await loadQueue();

            return response;
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    }, [loadQueue]);

    /**
     * Добавить трек в очередь
     */
    const addToQueue = useCallback(async (songId, playNext = false) => {
        if (!songId) return false;

        try {
            const response = await apiClient.request('/api/queue/add', {
                method: 'POST',
                body: JSON.stringify({
                    song_id: songId,
                    play_next: playNext
                })
            });

            await loadQueue();

            return response;
        } catch (err) {
            throw err;
        }
    }, [loadQueue]);

    /**
     * Удалить трек из очереди по позиции
     */
    const removeFromQueue = useCallback(async (position) => {
        if (position < 0) return false;

        try {
            await apiClient.request(`/api/queue/${position}`, {
                method: 'DELETE'
            });

            await loadQueue();

            return true;
        } catch (err) {
            throw err;
        }
    }, [loadQueue]);

    /**
     * Очистить очередь
     */
    const clearQueue = useCallback(async () => {
        try {
            await apiClient.request('/api/queue', {
                method: 'DELETE'
            });

            setQueue([]);
            setCurrentIndex(0);
            setSourceType(null);
            setSourceId(null);

            return true;
        } catch (err) {
            throw err;
        }
    }, []);

    /**
     * Получить следующий трек
     */
    const getNextTrack = useCallback(async () => {
        try {
            const response = await apiClient.request('/api/queue/next', {
                method: 'POST'
            });

            if (response.track) {
                setCurrentIndex(response.index);
                return response.track;
            }

            return null;
        } catch (err) {
            throw err;
        }
    }, []);

    /**
     * Получить предыдущий трек
     */
    const getPreviousTrack = useCallback(async () => {
        try {
            const response = await apiClient.request('/api/queue/previous', {
                method: 'POST'
            });

            if (response.track) {
                setCurrentIndex(response.index);
                return response.track;
            }

            return null;
        } catch (err) {
            throw err;
        }
    }, []);

    /**
     * Перейти к определенному треку в очереди
     */
    const jumpToTrack = useCallback(async (index) => {
        if (index < 0 || index >= queue.length) return null;

        try {
            const response = await apiClient.request('/api/queue/jump', {
                method: 'POST',
                body: JSON.stringify({ index })
            });

            if (response.track) {
                setCurrentIndex(response.index);
                return response.track;
            }

            return null;
        } catch (err) {
            throw err;
        }
    }, [queue.length]);

    /**
     * Переключить shuffle
     */
    const toggleShuffle = useCallback(async () => {
        try {
            const response = await apiClient.request('/api/queue/shuffle', {
                method: 'POST'
            });

            setShuffleEnabled(response.shuffleEnabled);

            return response.shuffleEnabled;
        } catch (err) {
            throw err;
        }
    }, []);

    /**
     * Установить режим shuffle
     */
    const setShuffle = useCallback(async (enabled) => {
        try {
            const response = await apiClient.request('/api/queue/shuffle', {
                method: 'POST',
                body: JSON.stringify({ enabled })
            });

            setShuffleEnabled(response.shuffleEnabled);

            return response.shuffleEnabled;
        } catch (err) {
            throw err;
        }
    }, []);

    /**
     * Переключить режим повтора (циклически)
     */
    const toggleRepeat = useCallback(async () => {
        try {
            const response = await apiClient.request('/api/queue/repeat', {
                method: 'POST'
            });

            setRepeatMode(response.repeatMode);

            return response.repeatMode;
        } catch (err) {
            throw err;
        }
    }, []);

    /**
     * Установить конкретный режим повтора
     */
    const setRepeat = useCallback(async (mode) => {
        if (!Object.values(REPEAT_MODES).includes(mode)) {
            throw new Error('Invalid repeat mode');
        }

        try {
            const response = await apiClient.request('/api/queue/repeat', {
                method: 'POST',
                body: JSON.stringify({ mode })
            });

            setRepeatMode(response.repeatMode);

            return response.repeatMode;
        } catch (err) {
            throw err;
        }
    }, []);

    /**
     * Синхронизировать состояние с сервером
     */
    const syncState = useCallback(async (updates) => {
        if (isSyncingRef.current) return;
        isSyncingRef.current = true;

        try {
            await apiClient.request('/api/queue/state', {
                method: 'PUT',
                body: JSON.stringify(updates)
            });
        } catch (err) {
        } finally {
            isSyncingRef.current = false;
        }
    }, []);

    /**
     * Обновить текущий индекс (локально + сервер)
     */
    const updateCurrentIndex = useCallback(async (index) => {
        setCurrentIndex(index);
        await syncState({ current_index: index });
    }, [syncState]);

    /**
     * Текущий трек
     */
    const currentTrack = queue[currentIndex] || null;

    /**
     * Есть ли следующий трек
     */
    const hasNext = queue.length > 0 && (
        repeatMode !== REPEAT_MODES.OFF ||
        currentIndex < queue.length - 1
    );

    /**
     * Есть ли предыдущий трек
     */
    const hasPrevious = queue.length > 0 && (
        repeatMode !== REPEAT_MODES.OFF ||
        currentIndex > 0
    );

    // Загрузка при монтировании (опционально)
    useEffect(() => {
        // Не загружаем автоматически - это делает PlayerContext
    }, []);

    return {
        // Состояние очереди
        queue,
        currentIndex,
        currentTrack,
        shuffleEnabled,
        repeatMode,
        sourceType,
        sourceId,
        loading,
        error,

        // Навигация
        hasNext,
        hasPrevious,

        // Методы управления очередью
        loadQueue,
        setQueueFromPlaylist,
        setQueueFromSongs,
        addToQueue,
        removeFromQueue,
        clearQueue,

        // Методы воспроизведения
        getNextTrack,
        getPreviousTrack,
        jumpToTrack,
        updateCurrentIndex,

        // Режимы
        toggleShuffle,
        setShuffle,
        toggleRepeat,
        setRepeat,

        // Утилиты
        syncState,
        REPEAT_MODES
    };
};

export default useQueue;
