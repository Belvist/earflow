-- Social feed schema.
-- Apply: psql $DATABASE_URL -f backend/database-service/database/migrations/004_social_feed.sql

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS photo_url VARCHAR(500);

CREATE TABLE IF NOT EXISTS user_settings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  display_name VARCHAR(255),
  audio_quality VARCHAR(20) DEFAULT 'auto' CHECK (audio_quality IN ('auto', 'low', 'medium', 'high', 'lossless')),
  autoplay_enabled BOOLEAN DEFAULT true,
  crossfade_seconds INTEGER DEFAULT 0 CHECK (crossfade_seconds >= 0 AND crossfade_seconds <= 12),
  normalize_volume BOOLEAN DEFAULT false,
  theme VARCHAR(20) DEFAULT 'dark' CHECK (theme IN ('dark', 'light', 'system')),
  show_lyrics BOOLEAN DEFAULT true,
  listening_history_enabled BOOLEAN DEFAULT true,
  show_activity BOOLEAN DEFAULT true,
  notifications_enabled BOOLEAN DEFAULT true,
  listener_ui JSONB NOT NULL DEFAULT '{"v":1,"miniBarVariant":"floating","miniPlayStyle":"adaptive","updatedAt":0}'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS display_name VARCHAR(255);

CREATE TABLE IF NOT EXISTS social_posts (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  body TEXT NOT NULL,
  kind VARCHAR(24) NOT NULL DEFAULT 'text' CHECK (kind IN ('text')),
  visibility VARCHAR(24) NOT NULL DEFAULT 'public' CHECK (visibility IN ('public')),
  status VARCHAR(24) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP WITH TIME ZONE,
  CHECK (title IS NULL OR char_length(title) <= 120),
  CHECK (char_length(body) BETWEEN 1 AND 2000)
);

CREATE TABLE IF NOT EXISTS social_post_likes (
  post_id BIGINT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_social_posts_feed
  ON social_posts (created_at DESC, id DESC)
  WHERE status = 'active' AND visibility = 'public';

CREATE INDEX IF NOT EXISTS idx_social_posts_user
  ON social_posts (user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_social_post_likes_user
  ON social_post_likes (user_id, created_at DESC);
