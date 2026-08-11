-- Migration: 002_recommendations_indexes
-- Description: Добавляет оптимизированные индексы для рекомендаций
-- Date: 2024-01-01
-- Author: recommendations-service
-- NOTE: Таблицы уже созданы в database-service/database/init.sql
--       Эта миграция только добавляет индексы для оптимизации

-- ============================================
-- ИНДЕКСЫ ДЛЯ ГЛОБАЛЬНОГО ТОПА
-- ============================================

-- Составной индекс для сортировки по популярности
CREATE INDEX IF NOT EXISTS idx_songs_popularity_play_count 
ON songs (popularity DESC NULLS LAST, play_count DESC NULLS LAST);

-- Индекс для фильтрации по жанру с сортировкой
CREATE INDEX IF NOT EXISTS idx_songs_genre_popularity 
ON songs (genre, popularity DESC NULLS LAST) 
WHERE genre IS NOT NULL;

-- Индекс для фильтрации по артисту с сортировкой
CREATE INDEX IF NOT EXISTS idx_songs_artist_popularity 
ON songs (artist, popularity DESC NULLS LAST) 
WHERE artist IS NOT NULL;

-- ============================================
-- ИНДЕКСЫ ДЛЯ USER_HISTORY (персональные рекомендации)
-- ============================================

-- Основной индекс для запросов по пользователю
CREATE INDEX IF NOT EXISTS idx_user_history_user_last_played 
ON user_history (user_id, last_played DESC);

-- Индекс для поиска лайкнутых треков пользователя
CREATE INDEX IF NOT EXISTS idx_user_history_user_liked 
ON user_history (user_id) 
WHERE liked = true;

-- Индекс для агрегации по треку
CREATE INDEX IF NOT EXISTS idx_user_history_song_plays 
ON user_history (song_id, play_count DESC);

-- ============================================
-- ИНДЕКСЫ ДЛЯ LIKES/DISLIKES (collaborative filtering)
-- ============================================

-- Индекс для поиска лайков пользователя
CREATE INDEX IF NOT EXISTS idx_likes_user_created 
ON likes (user_id, created_at DESC);

-- Индекс для поиска пользователей, лайкнувших трек (collaborative)
CREATE INDEX IF NOT EXISTS idx_likes_song_user 
ON likes (song_id, user_id);

-- Индекс для дизлайков пользователя
CREATE INDEX IF NOT EXISTS idx_dislikes_user_song_created 
ON dislikes (user_id, song_id, created_at DESC);

-- ============================================
-- ИНДЕКСЫ ДЛЯ USER_INTERACTIONS (feedback)
-- ============================================

-- Индекс для недавних взаимодействий (time decay)
CREATE INDEX IF NOT EXISTS idx_user_interactions_recent 
ON user_interactions (song_id, created_at DESC) 
;

-- Индекс для типов взаимодействий
CREATE INDEX IF NOT EXISTS idx_user_interactions_type_time 
ON user_interactions (interaction_type, created_at DESC);

-- Партиционированный индекс по пользователю и времени
CREATE INDEX IF NOT EXISTS idx_user_interactions_user_time_type 
ON user_interactions (user_id, created_at DESC, interaction_type);

-- ============================================
-- ИНДЕКСЫ ДЛЯ SONG_FEATURES (content-based filtering)
-- ============================================

-- Составной индекс для поиска похожих по audio features
CREATE INDEX IF NOT EXISTS idx_song_features_energy_valence 
ON song_features (energy, valence);

-- Индекс для поиска по danceability
CREATE INDEX IF NOT EXISTS idx_song_features_danceability_energy 
ON song_features (danceability, energy);

-- ============================================
-- ЧАСТИЧНЫЕ ИНДЕКСЫ ДЛЯ ОПТИМИЗАЦИИ
-- ============================================

-- Только активные треки (с прослушиваниями)
CREATE INDEX IF NOT EXISTS idx_songs_active 
ON songs (id) 
WHERE play_count > 0;

-- Только треки с обложками
CREATE INDEX IF NOT EXISTS idx_songs_with_covers 
ON songs (id) 
WHERE cover_path IS NOT NULL OR cover IS NOT NULL;

-- ============================================
-- ИНДЕКС ДЛЯ FULL-TEXT SEARCH (если ещё не создан)
-- ============================================

-- GIN индекс для поиска по названию и артисту
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_songs_search_text'
  ) THEN
    -- Создаём GIN индекс для полнотекстового поиска
    EXECUTE 'CREATE INDEX idx_songs_search_text ON songs USING GIN (
      to_tsvector(''russian'', COALESCE(title, '''') || '' '' || COALESCE(artist, ''''))
    )';
  END IF;
END $$;

-- ============================================
-- СТАТИСТИКА
-- ============================================

-- Обновляем статистику для планировщика запросов
ANALYZE songs;
ANALYZE user_history;
ANALYZE likes;
ANALYZE dislikes;
ANALYZE user_interactions;
ANALYZE song_features;

COMMENT ON INDEX idx_songs_popularity_play_count IS 'Оптимизация глобального топа рекомендаций';
COMMENT ON INDEX idx_user_history_user_last_played IS 'Оптимизация персональных рекомендаций';
COMMENT ON INDEX idx_likes_song_user IS 'Оптимизация collaborative filtering';
