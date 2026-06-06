-- Migration: 000_check_tables
-- Description: Проверяет и дополняет структуру таблиц для рекомендаций
-- NOTE: Основные таблицы создаются в database-service/database/init.sql
--       Эта миграция только добавляет недостающие колонки

-- ============================================
-- ПРОВЕРКА И ДОПОЛНЕНИЕ SONGS
-- ============================================

-- Добавляем недостающие колонки для audio features (если нет song_features)
ALTER TABLE songs ADD COLUMN IF NOT EXISTS bpm INTEGER;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS key VARCHAR(10);
ALTER TABLE songs ADD COLUMN IF NOT EXISTS mood VARCHAR(50);
ALTER TABLE songs ADD COLUMN IF NOT EXISTS energy NUMERIC(3,2);
ALTER TABLE songs ADD COLUMN IF NOT EXISTS danceability NUMERIC(3,2);

-- Constraints для audio features
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'songs_energy_range') THEN
    ALTER TABLE songs ADD CONSTRAINT songs_energy_range 
      CHECK (energy IS NULL OR (energy >= 0 AND energy <= 1));
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'songs_danceability_range') THEN
    ALTER TABLE songs ADD CONSTRAINT songs_danceability_range 
      CHECK (danceability IS NULL OR (danceability >= 0 AND danceability <= 1));
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- ПРОВЕРКА USER_HISTORY
-- ============================================

-- Добавляем first_played если нет
ALTER TABLE user_history ADD COLUMN IF NOT EXISTS first_played TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- ============================================
-- ПРОВЕРКА USER_INTERACTIONS
-- ============================================

-- Добавляем session_id и duration если нет
ALTER TABLE user_interactions ADD COLUMN IF NOT EXISTS session_id VARCHAR(100);
ALTER TABLE user_interactions ADD COLUMN IF NOT EXISTS duration_ms INTEGER DEFAULT 0;
ALTER TABLE user_interactions ADD COLUMN IF NOT EXISTS progress NUMERIC(4,3);

-- ============================================
-- СОЗДАНИЕ ТАБЛИЦЫ RECOMMENDATION_SESSIONS (если нет)
-- ============================================

CREATE TABLE IF NOT EXISTS recommendation_sessions (
  id VARCHAR(100) PRIMARY KEY,
  user_id INTEGER NOT NULL,
  preferences JSONB DEFAULT '{}',
  exclude_ids INTEGER[] DEFAULT '{}',
  source VARCHAR(50) DEFAULT 'offline',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_accessed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '1 hour'
);

CREATE INDEX IF NOT EXISTS idx_reco_sessions_user ON recommendation_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_reco_sessions_expires ON recommendation_sessions (expires_at);

-- ============================================
-- CLEANUP FUNCTION
-- ============================================

CREATE OR REPLACE FUNCTION cleanup_expired_reco_sessions()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM recommendation_sessions WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- ENSURE DEFAULT VALUES
-- ============================================

-- Убеждаемся что popularity имеет значение по умолчанию
ALTER TABLE songs ALTER COLUMN popularity SET DEFAULT 0;
ALTER TABLE songs ALTER COLUMN play_count SET DEFAULT 0;

-- Обновляем NULL значения
UPDATE songs SET popularity = 0 WHERE popularity IS NULL;
UPDATE songs SET play_count = 0 WHERE play_count IS NULL;
