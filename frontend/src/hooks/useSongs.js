import { useState, useEffect, useCallback, useRef } from 'react';
import apiClient from '../api/client';
import useAuth from './useAuth';

/**
 * Hook для управления песнями
 */
const useSongs = (autoLoad = true) => {
  const { isAuthenticated, authReady, status, rehydrateSession } = useAuth();
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 200,
    total: 0,
    pages: 0,
  });

  const paginationRef = useRef(pagination);
  useEffect(() => {
    paginationRef.current = pagination;
  }, [pagination]);

  /**
   * Загрузить список песен
   */
  /**
   * Загрузить список песен
   */
  const loadSongs = useCallback(async (params = {}) => {
    setLoading(true);
    setError(null);

    try {
      // Используем стандартный метод получения песен пользователя
      const currentPagination = paginationRef.current;
      const page = Number.isFinite(Number(params.page)) && Number(params.page) > 0 ? Number(params.page) : currentPagination.page;
      const limit = Number.isFinite(Number(params.limit)) && Number(params.limit) > 0 ? Number(params.limit) : currentPagination.limit;
      const search = typeof params.search === 'string' ? params.search : (typeof params.q === 'string' ? params.q : undefined);

      const requestSongs = () => apiClient.getSongs({
        ...params,
        page,
        limit,
        ...(typeof search === 'string' ? { search } : {}),
      });
      let songsData;
      try {
        songsData = await requestSongs();
      } catch (err) {
        const st = Number(err?.status || err?.responseStatus || 0);
        if ((st === 401 || st === 403) && typeof rehydrateSession === 'function') {
          const recovered = await Promise.resolve(rehydrateSession()).catch(() => false);
          if (recovered) {
            songsData = await requestSongs();
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }

      const songsArray = Array.isArray(songsData) ? songsData : [];
      setSongs(songsArray);
      setPagination(prev => ({
        ...prev,
        page,
        limit,
        // Если API вернет пагинацию, обновить здесь
      }));
      return songsArray;
    } catch (err) {
      setError(err?.message || 'Failed to load songs');
      const st = Number(err?.status || err?.responseStatus || 0);
      const transient = st === 0 || st === 401 || st === 403 || st === 408 || st === 429 || st >= 500;
      if (transient) {
        return [];
      }
      setSongs([]); // Устанавливаем пустой массив при ошибке
      return [];
    } finally {
      setLoading(false);
    }
  }, [rehydrateSession]);

  /**
   * Загрузить песню
   */
  const uploadSong = useCallback(async (file, onProgress) => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.uploadSong(file, onProgress);
      // Обновляем список
      await loadSongs({ page: 1 });
      return response;
    } catch (err) {
      setError(err?.message || 'Failed to upload song');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [loadSongs]);

  /**
   * Удалить песню
   */
  const deleteSong = useCallback(async (id) => {
    setLoading(true);
    setError(null);

    try {
      await apiClient.deleteSong(id);
      // Удаляем из локального состояния
      setSongs(prev => prev.filter(song => song.id !== id));
    } catch (err) {
      setError(err?.message || 'Failed to delete song');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Обновить метаданные песни
   */
  const updateSong = useCallback(async (id, metadata) => {
    setLoading(true);
    setError(null);

    try {
      await apiClient.updateSong(id, metadata);
      setSongs(prev =>
        prev.map(song =>
          song.id === id ? { ...song, ...(metadata || {}) } : song
        )
      );
    } catch (err) {
      setError(err?.message || 'Failed to update song');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Обновить локальное состояние трека (без запроса на сервер)
   * Используется для мгновенного обновления UI после изменений
   */
  const updateSongLocal = useCallback((id, updates) => {
    setSongs(prev =>
      prev.map(song =>
        song.id === id ? { ...song, ...(updates || {}) } : song
      )
    );
  }, []);

  /**
   * Перезагрузить данные одного трека с сервера
   */
  const refreshSong = useCallback(async (id) => {
    try {
      const response = await apiClient.request(`/api/songs/${id}`);
      if (response) {
        const updatedSong = { ...response };
        setSongs(prev =>
          prev.map(song =>
            song.id === id ? updatedSong : song
          )
        );
        return updatedSong;
      }
    } catch (err) {
      // ignore
    }
    return null;
  }, []);

  /**
   * Поиск песен
   */
  const searchSongs = useCallback(async (query) => {
    return await loadSongs({ page: 1, search: query });
  }, [loadSongs]);

  /**
   * Получить URL для стриминга
   */
  const getStreamUrl = useCallback((song) => {
    void song;
    return null;
  }, []);

  /**
   * Преобразовать песни в формат для плеера
   */
  const formatSongsForPlayer = useCallback((songsData) => {
    if (!songsData || !Array.isArray(songsData)) {
      return [];
    }
    return songsData.map(song => {
      // Валидация ID - без ID трек невозможно воспроизвести
      if (!song || !song.id) {
        return null;
      }

      // Генерируем правильный URL для стриминга через API
      const streamUrl = getStreamUrl(song);

      // Генерируем URL обложки с cache busting если есть updated_at
      const hasCacheUpdate = !!song.updated_at;
      const coverUrl = apiClient.getCoverUrl(song, hasCacheUpdate);

      const rawDurationSeconds = Number(song.duration);
      const durationSeconds = Number.isFinite(rawDurationSeconds) && rawDurationSeconds > 0
        ? Math.round(rawDurationSeconds)
        : 0;

      return {
        // Сначала spread, чтобы наши значения ниже переопределили некорректные
        ...song,
        // Критичные поля - всегда переопределяем
        id: song.id,
        title: song.title || 'Без названия',
        artist: song.artist || 'Неизвестный исполнитель',
        album: song.album || 'Неизвестный альбом',
        duration: formatDuration(durationSeconds),
        duration_seconds: durationSeconds,
        cover_path: song.cover_path || song.coverPath || song.cover,
        cover: coverUrl,
        audioUrl: streamUrl,
        isLiked: false,
        user_id: song.user_id,
        updated_at: song.updated_at,
      };
    }).filter(Boolean); // Убираем null значения
  }, [getStreamUrl]);

  /**
   * Автоматическая загрузка при монтировании и при изменении авторизации
   */
  useEffect(() => {
    // autoLoad может быть булевым или флагом isAuthenticated
    const shouldLoad = autoLoad === true || autoLoad;

    if (shouldLoad && isAuthenticated) {
      loadSongs().catch(err => {
        setError(err?.message || 'Failed to load songs');
      });
    } else if (authReady && status === 'guest') {
      // Очищаем список при logout
      setSongs([]);
    }
  }, [autoLoad, authReady, isAuthenticated, loadSongs, status]);

  return {
    songs,
    loading,
    error,
    pagination,
    loadSongs,
    uploadSong,
    deleteSong,
    updateSong,
    updateSongLocal,
    refreshSong,
    searchSongs,
    getStreamUrl,
    formatSongsForPlayer,
  };
};

/**
 * Форматировать длительность из секунд в MM:SS
 */
function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

export default useSongs;
