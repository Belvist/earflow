/**
 * usePlaylists - Hook для управления плейлистами
 * Взаимодействует с playlist-service через API Gateway
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import apiClient from '../api/client';
import useAuth from './useAuth';

const usePlaylists = (autoLoad = true) => {
    const { isAuthenticated, authReady, status } = useAuth();
    const [playlists, setPlaylists] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [selectedPlaylist, setSelectedPlaylist] = useState(null);
    const [selectedPlaylistTracks, setSelectedPlaylistTracks] = useState([]);

    const abortControllerRef = useRef(null);

    /**
     * Загрузить все плейлисты пользователя
     */
    const loadPlaylists = useCallback(async (options = {}) => {
        if (authReady && status === 'guest') {
            setPlaylists([]);
            return [];
        }
        if (!isAuthenticated) {
            return [];
        }

        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        abortControllerRef.current = new AbortController();

        setLoading(true);
        setError(null);

        try {
            const params = new URLSearchParams();
            if (options.limit) params.set('limit', options.limit);
            if (options.offset) params.set('offset', options.offset);
            if (options.includePublic) params.set('includePublic', 'true');

            const qs = params.toString();
            const url = qs ? `/api/playlists?${qs}` : '/api/playlists';
            const response = await apiClient.request(url, {
                signal: abortControllerRef.current.signal
            });

            // Backend returns { playlists: [...] }
            const playlistsData = Array.isArray(response) ? response : (response.playlists || []);
            setPlaylists(playlistsData);
            return playlistsData;
        } catch (err) {
            if (err.name === 'AbortError') return [];
            setError(err.message);
            return [];
        } finally {
            setLoading(false);
        }
    }, [authReady, isAuthenticated, status]);

    /**
     * Создать новый плейлист
     */
    const createPlaylist = useCallback(async (name, description = '', isPublic = false) => {
        if (!name || name.trim().length === 0) {
            throw new Error('Название плейлиста обязательно');
        }

        setLoading(true);
        setError(null);

        try {
            const response = await apiClient.request('/api/playlists', {
                method: 'POST',
                body: JSON.stringify({
                    name: name.trim(),
                    description: description?.trim() || '',
                    is_public: !!isPublic
                })
            });

            // Добавляем в начало списка
            setPlaylists(prev => [response, ...prev]);
            return response;
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    }, []);

    /**
     * Получить плейлист с треками
     */
    const getPlaylist = useCallback(async (playlistId) => {
        if (!playlistId) return null;

        setLoading(true);
        setError(null);

        try {
            const response = await apiClient.request(`/api/playlists/${playlistId}`);
            setSelectedPlaylist(response);
            // Backend now embeds tracks in the playlist object
            setSelectedPlaylistTracks(response.tracks || response.songs || []);
            return response;
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    }, []);

    /**
     * Обновить плейлист
     */
    const updatePlaylist = useCallback(async (playlistId, updates) => {
        if (!playlistId) return null;

        setLoading(true);
        setError(null);

        try {
            const safeUpdates = updates && typeof updates === 'object'
                ? Object.fromEntries(Object.entries(updates).filter(([k]) => k !== 'is_public'))
                : updates;
            const response = await apiClient.request(`/api/playlists/${playlistId}`, {
                method: 'PUT',
                body: JSON.stringify(safeUpdates)
            });

            // Обновляем в списке
            setPlaylists(prev => prev.map(p =>
                p.id === playlistId ? { ...p, ...response } : p
            ));

            // Обновляем выбранный если совпадает
            if (selectedPlaylist?.id === playlistId) {
                setSelectedPlaylist(prev => ({ ...prev, ...response }));
            }

            return response;
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    }, [selectedPlaylist]);

    /**
     * Удалить плейлист
     */
    const deletePlaylist = useCallback(async (playlistId) => {
        if (!playlistId) return false;

        setLoading(true);
        setError(null);

        try {
            await apiClient.request(`/api/playlists/${playlistId}`, {
                method: 'DELETE'
            });

            // Удаляем из списка
            setPlaylists(prev => prev.filter(p => p.id !== playlistId));

            // Сбрасываем выбранный если совпадает
            if (selectedPlaylist?.id === playlistId) {
                setSelectedPlaylist(null);
                setSelectedPlaylistTracks([]);
            }

            return true;
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    }, [selectedPlaylist]);

    /**
     * Добавить трек в плейлист
     */
    const addTrackToPlaylist = useCallback(async (playlistId, songId) => {
        if (!playlistId || !songId) return null;

        try {
            const response = await apiClient.request(`/api/playlists/${playlistId}/tracks`, {
                method: 'POST',
                body: JSON.stringify({ song_id: songId })
            });

            // Обновляем счетчик в списке плейлистов
            setPlaylists(prev => prev.map(p =>
                p.id === playlistId
                    ? { ...p, track_count: (p.track_count || 0) + 1 }
                    : p
            ));

            return response;
        } catch (err) {
            throw err;
        }
    }, []);

    /**
     * Добавить несколько треков в плейлист
     */
    const addTracksToPlaylist = useCallback(async (playlistId, songIds) => {
        if (!playlistId || !songIds || songIds.length === 0) return null;

        try {
            const response = await apiClient.request(`/api/playlists/${playlistId}/tracks`, {
                method: 'POST',
                body: JSON.stringify({ song_ids: songIds })
            });

            // Обновляем счетчик
            setPlaylists(prev => prev.map(p =>
                p.id === playlistId
                    ? { ...p, track_count: (p.track_count || 0) + (response.added || 0) }
                    : p
            ));

            return response;
        } catch (err) {
            throw err;
        }
    }, []);

    /**
     * Удалить трек из плейлиста
     */
    const removeTrackFromPlaylist = useCallback(async (playlistId, songId) => {
        if (!playlistId || !songId) return false;

        try {
            await apiClient.request(`/api/playlists/${playlistId}/tracks/${songId}`, {
                method: 'DELETE'
            });

            // Обновляем счетчик
            setPlaylists(prev => prev.map(p =>
                p.id === playlistId
                    ? { ...p, track_count: Math.max((p.track_count || 1) - 1, 0) }
                    : p
            ));

            // Обновляем треки выбранного плейлиста
            if (selectedPlaylist?.id === playlistId) {
                setSelectedPlaylistTracks(prev => prev.filter(t => t.id !== songId));
            }

            return true;
        } catch (err) {
            throw err;
        }
    }, [selectedPlaylist]);

    /**
     * Изменить порядок трека в плейлисте
     */
    const reorderTrack = useCallback(async (playlistId, songId, newPosition) => {
        if (!playlistId || !songId || newPosition < 1) return false;

        try {
            await apiClient.request(`/api/playlists/${playlistId}/tracks/${songId}/position`, {
                method: 'PUT',
                body: JSON.stringify({ position: newPosition })
            });

            return true;
        } catch (err) {
            throw err;
        }
    }, []);

    /**
     * Очистить выбранный плейлист
     */
    const clearSelectedPlaylist = useCallback(() => {
        setSelectedPlaylist(null);
        setSelectedPlaylistTracks([]);
    }, []);

    // Автозагрузка при монтировании
    useEffect(() => {
        if (autoLoad && isAuthenticated) {
            loadPlaylists();
        } else if (authReady && status === 'guest') {
            setPlaylists([]);
        }

        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        };
    }, [autoLoad, authReady, isAuthenticated, loadPlaylists, status]);

    return {
        // Состояние
        playlists,
        loading,
        error,
        selectedPlaylist,
        selectedPlaylistTracks,

        // Методы CRUD
        loadPlaylists,
        createPlaylist,
        getPlaylist,
        updatePlaylist,
        deletePlaylist,

        // Методы для треков
        addTrackToPlaylist,
        addTracksToPlaylist,
        removeTrackFromPlaylist,
        reorderTrack,

        // Утилиты
        clearSelectedPlaylist,
        setSelectedPlaylist
    };
};

export default usePlaylists;
