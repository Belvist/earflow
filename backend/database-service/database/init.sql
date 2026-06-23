-- Music Platform Database Schema
-- Creates all required tables for the music streaming platform

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE,
    username VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255),
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    avatar_url VARCHAR(500),
    is_premium BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    is_active BOOLEAN DEFAULT true
);

-- Ensure auth-related columns exist for compatibility with auth-service and routes/users.js
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS last_login TIMESTAMP,
    ADD COLUMN IF NOT EXISTS photo_url VARCHAR(500),
    ADD COLUMN IF NOT EXISTS salt VARCHAR(255),
    ADD COLUMN IF NOT EXISTS email_encrypted TEXT,
    ADD COLUMN IF NOT EXISTS email_hash TEXT,
    ADD COLUMN IF NOT EXISTS metadata TEXT,
    ADD COLUMN IF NOT EXISTS telegram_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_hash ON users (email_hash) WHERE email_hash IS NOT NULL;

UPDATE users
   SET email_hash = email
 WHERE email_hash IS NULL
   AND email IS NOT NULL
   AND email ~ '^[a-f0-9]{64}$';

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS mfa_secret_encrypted TEXT,
    ADD COLUMN IF NOT EXISTS mfa_recovery_codes TEXT,
    ADD COLUMN IF NOT EXISTS mfa_enabled_at TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_telegram_id ON users (telegram_id) WHERE telegram_id IS NOT NULL;

-- Create songs table
CREATE TABLE IF NOT EXISTS songs (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    artist VARCHAR(255) NOT NULL,
    album VARCHAR(255),
    duration INTEGER, -- in seconds
    genre VARCHAR(100),
    year INTEGER,
    release_date DATE,
    file_path VARCHAR(500) NOT NULL,
    audio_url VARCHAR(500),
    cover VARCHAR(500),
    cover_path TEXT,
    file_size BIGINT,
    mime_type VARCHAR(100),
    uploader_id INTEGER REFERENCES users (id),
    popularity INTEGER DEFAULT 0,
    play_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS artist_uploaders (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    artist_name VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS artists (
    id SERIAL PRIMARY KEY,
    public_id TEXT NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
    name VARCHAR(255) NOT NULL,
    name_key VARCHAR(255) NOT NULL UNIQUE,
    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    popular BOOLEAN NOT NULL DEFAULT FALSE,
    hero_cover_path TEXT,
    avatar_cover_path TEXT,
    banner_cover_path TEXT,
    bio TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_artists_name_key ON artists(name_key);

ALTER TABLE artists
    ADD COLUMN IF NOT EXISTS public_id TEXT;

ALTER TABLE artists
    ADD COLUMN IF NOT EXISTS popular BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS avatar_cover_path TEXT,
    ADD COLUMN IF NOT EXISTS banner_cover_path TEXT;

UPDATE artists
   SET public_id = encode(gen_random_bytes(16), 'hex')
 WHERE public_id IS NULL OR btrim(public_id) = '';

ALTER TABLE artists
    ALTER COLUMN public_id SET DEFAULT encode(gen_random_bytes(16), 'hex');

ALTER TABLE artists
    ALTER COLUMN public_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_artists_public_id ON artists(public_id);

CREATE INDEX IF NOT EXISTS idx_artists_popular_updated
    ON artists(updated_at DESC, id DESC)
    WHERE popular = TRUE;

-- Albums table with stable public IDs and referential integrity.
CREATE TABLE IF NOT EXISTS albums (
    id SERIAL PRIMARY KEY,
    public_id TEXT NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
    artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    name_key VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (artist_id, name_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_albums_public_id ON albums(public_id);
CREATE INDEX IF NOT EXISTS idx_albums_artist_id ON albums(artist_id);
CREATE INDEX IF NOT EXISTS idx_albums_artist_key ON albums(artist_id, name_key);

CREATE TABLE IF NOT EXISTS artist_ownerships (
    id SERIAL PRIMARY KEY,
    artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(32) NOT NULL DEFAULT 'owner',
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_artist_active_owner
    ON artist_ownerships(artist_id)
    WHERE status = 'active' AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_artist_ownerships_user_active
    ON artist_ownerships(user_id)
    WHERE status = 'active' AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS artist_accounts (
    id SERIAL PRIMARY KEY,
    artist_id INTEGER NOT NULL UNIQUE REFERENCES artists(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS artist_account_members (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES artist_accounts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(32) NOT NULL DEFAULT 'owner',
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_artist_account_member_active
    ON artist_account_members(account_id, user_id)
    WHERE status = 'active' AND revoked_at IS NULL;

INSERT INTO artist_accounts (artist_id)
SELECT DISTINCT artist_id
  FROM artist_ownerships
 WHERE artist_id IS NOT NULL
ON CONFLICT (artist_id) DO NOTHING;

INSERT INTO artist_account_members (account_id, user_id, role, status, created_at, revoked_at)
SELECT a.id, o.user_id, o.role, o.status, o.created_at, o.revoked_at
  FROM artist_ownerships o
  JOIN artist_accounts a ON a.artist_id = o.artist_id
ON CONFLICT DO NOTHING;

-- Backfill legacy artist_uploaders into the current artist ownership model.
WITH legacy AS (
    SELECT DISTINCT ON (lower(regexp_replace(btrim(au.artist_name), '\s+', ' ', 'g')))
           au.user_id,
           btrim(au.artist_name) AS artist_name,
           lower(regexp_replace(btrim(au.artist_name), '\s+', ' ', 'g')) AS name_key,
           au.created_at
      FROM artist_uploaders au
      JOIN users u ON u.id = au.user_id
     WHERE au.is_active = TRUE
       AND btrim(COALESCE(au.artist_name, '')) <> ''
     ORDER BY lower(regexp_replace(btrim(au.artist_name), '\s+', ' ', 'g')), au.created_at ASC NULLS LAST, au.user_id ASC
),
inserted_artists AS (
    INSERT INTO artists (name, name_key, created_by_user_id, is_verified, created_at, updated_at)
    SELECT l.artist_name, l.name_key, l.user_id, TRUE, COALESCE(l.created_at, NOW()), NOW()
      FROM legacy l
    ON CONFLICT (name_key) DO UPDATE
      SET updated_at = NOW()
    RETURNING id, name_key
),
all_artist_rows AS (
    SELECT ia.id, ia.name_key
      FROM inserted_artists ia
    UNION
    SELECT a.id, a.name_key
      FROM artists a
     WHERE a.name_key IN (SELECT name_key FROM legacy)
),
ownership_candidates AS (
    SELECT a.id AS artist_id,
           l.user_id,
           COALESCE(l.created_at, NOW()) AS created_at
      FROM legacy l
      JOIN all_artist_rows a ON a.name_key = l.name_key
),
inserted_ownerships AS (
    INSERT INTO artist_ownerships (artist_id, user_id, role, status, created_at)
    SELECT c.artist_id, c.user_id, 'owner', 'active', c.created_at
      FROM ownership_candidates c
     WHERE NOT EXISTS (
               SELECT 1
                 FROM artist_ownerships o
                WHERE o.artist_id = c.artist_id
                  AND o.status = 'active'
                  AND o.revoked_at IS NULL
           )
    ON CONFLICT DO NOTHING
    RETURNING artist_id, user_id, role, status, created_at, revoked_at
),
active_ownerships AS (
    SELECT io.artist_id, io.user_id, io.role, io.status, io.created_at, io.revoked_at
      FROM inserted_ownerships io
    UNION
    SELECT o.artist_id, o.user_id, o.role, o.status, o.created_at, o.revoked_at
      FROM artist_ownerships o
     WHERE o.status = 'active'
       AND o.revoked_at IS NULL
),
ensured_accounts AS (
    INSERT INTO artist_accounts (artist_id, status)
    SELECT DISTINCT o.artist_id, 'active'
      FROM active_ownerships o
    ON CONFLICT (artist_id) DO UPDATE
      SET status = 'active',
          updated_at = NOW()
    RETURNING id, artist_id
),
all_accounts AS (
    SELECT ea.id, ea.artist_id
      FROM ensured_accounts ea
    UNION
    SELECT aa.id, aa.artist_id
      FROM artist_accounts aa
     WHERE aa.artist_id IN (SELECT artist_id FROM active_ownerships)
)
INSERT INTO artist_account_members (account_id, user_id, role, status, created_at, revoked_at)
SELECT aa.id, o.user_id, COALESCE(NULLIF(o.role, ''), 'owner'), o.status, o.created_at, o.revoked_at
  FROM active_ownerships o
  JOIN all_accounts aa ON aa.artist_id = o.artist_id
ON CONFLICT DO NOTHING;

INSERT INTO artist_uploaders (user_id, artist_name, is_active, created_at, updated_at)
SELECT DISTINCT ON (o.user_id)
       o.user_id,
       a.name,
       TRUE,
       COALESCE(o.created_at, NOW()),
       NOW()
  FROM artist_ownerships o
  JOIN artists a ON a.id = o.artist_id
 WHERE o.status = 'active'
   AND o.revoked_at IS NULL
 ORDER BY o.user_id, o.created_at DESC NULLS LAST, o.artist_id DESC
ON CONFLICT (user_id) DO UPDATE
  SET artist_name = EXCLUDED.artist_name,
      is_active = TRUE,
      updated_at = NOW();

CREATE TABLE IF NOT EXISTS artist_claim_requests (
    id SERIAL PRIMARY KEY,
    artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    note TEXT,
    review_reason TEXT,
    reviewed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_artist_claim_pending
    ON artist_claim_requests(artist_id, user_id)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_artist_claim_status_created
    ON artist_claim_requests(status, created_at DESC);

 ALTER TABLE songs
     ADD COLUMN IF NOT EXISTS has_ebap BOOLEAN NOT NULL DEFAULT FALSE,
     ADD COLUMN IF NOT EXISTS ebap_status VARCHAR(20) NOT NULL DEFAULT 'none',
     ADD COLUMN IF NOT EXISTS ebap_error TEXT;

 ALTER TABLE songs
     ADD COLUMN IF NOT EXISTS has_hls BOOLEAN NOT NULL DEFAULT FALSE,
     ADD COLUMN IF NOT EXISTS hls_status VARCHAR(20) NOT NULL DEFAULT 'none',
     ADD COLUMN IF NOT EXISTS hls_error TEXT;

 ALTER TABLE songs
     ADD COLUMN IF NOT EXISTS transcode_status VARCHAR(20) NOT NULL DEFAULT 'none',
     ADD COLUMN IF NOT EXISTS transcode_error TEXT,
     ADD COLUMN IF NOT EXISTS quality_variants JSONB;

 CREATE INDEX IF NOT EXISTS idx_songs_transcode_status ON songs (transcode_status, id);
 CREATE INDEX IF NOT EXISTS idx_songs_quality_variants ON songs (id) WHERE quality_variants IS NOT NULL;

 ALTER TABLE songs
     ADD COLUMN IF NOT EXISTS metadata_parse_status VARCHAR(20) NOT NULL DEFAULT 'none',
     ADD COLUMN IF NOT EXISTS metadata_parse_error TEXT,
     ADD COLUMN IF NOT EXISTS parsed_metadata JSONB;

 CREATE INDEX IF NOT EXISTS idx_songs_metadata_parse_status ON songs (metadata_parse_status, id);
 CREATE INDEX IF NOT EXISTS idx_songs_parsed_metadata ON songs USING gin(parsed_metadata) WHERE parsed_metadata IS NOT NULL;

 ALTER TABLE songs
     ADD COLUMN IF NOT EXISTS waveform_peaks JSONB,
     ADD COLUMN IF NOT EXISTS waveform_bars INTEGER,
     ADD COLUMN IF NOT EXISTS waveform_status VARCHAR(20) NOT NULL DEFAULT 'none',
     ADD COLUMN IF NOT EXISTS waveform_error TEXT;

 CREATE INDEX IF NOT EXISTS idx_songs_waveform_status ON songs (waveform_status, id)
     WHERE waveform_status IN ('pending', 'processing', 'failed');

-- Create playlists table
CREATE TABLE IF NOT EXISTS playlists (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    user_id INTEGER REFERENCES users (id) ON DELETE CASCADE,
    is_public BOOLEAN DEFAULT FALSE,
    cover_url VARCHAR(500),
    cover_path TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create playlist_tracks table (canonical)
CREATE TABLE IF NOT EXISTS playlist_tracks (
  id SERIAL PRIMARY KEY,
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(playlist_id, song_id)
);

-- Create likes table (standardized name)
CREATE TABLE IF NOT EXISTS likes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users (id) ON DELETE CASCADE,
    song_id INTEGER REFERENCES songs (id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, song_id)
);

-- Create dislikes table (permanent negative feedback)
CREATE TABLE IF NOT EXISTS dislikes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users (id) ON DELETE CASCADE,
    song_id INTEGER REFERENCES songs (id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, song_id)
);

-- Create listens table (standardized)
CREATE TABLE IF NOT EXISTS listens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    song_id INTEGER NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
    listened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create genres table
CREATE TABLE IF NOT EXISTS genres (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create song_genres junction table
CREATE TABLE IF NOT EXISTS song_genres (
    id SERIAL PRIMARY KEY,
    song_id INTEGER REFERENCES songs (id) ON DELETE CASCADE,
    genre_id INTEGER REFERENCES genres (id) ON DELETE CASCADE,
    UNIQUE (song_id, genre_id)
);

-- Create user_eq_settings table
CREATE TABLE IF NOT EXISTS user_eq_settings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT false,
  gains JSONB DEFAULT '[0,0,0,0,0,0,0,0,0,0]'::jsonb,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create user_settings table for profile and app settings
CREATE TABLE IF NOT EXISTS user_settings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  -- Display name (can differ from username)
  display_name VARCHAR(255),
  -- Audio settings
  audio_quality VARCHAR(20) DEFAULT 'auto' CHECK (audio_quality IN ('auto', 'low', 'medium', 'high', 'lossless')),
  autoplay_enabled BOOLEAN DEFAULT true,
  crossfade_seconds INTEGER DEFAULT 0 CHECK (crossfade_seconds >= 0 AND crossfade_seconds <= 12),
  normalize_volume BOOLEAN DEFAULT false,
  -- UI settings
  theme VARCHAR(20) DEFAULT 'dark' CHECK (theme IN ('dark', 'light', 'system')),
  show_lyrics BOOLEAN DEFAULT true,
  -- Privacy settings
  listening_history_enabled BOOLEAN DEFAULT true,
  show_activity BOOLEAN DEFAULT true,
  -- Notifications
  notifications_enabled BOOLEAN DEFAULT true,
  -- Listener chrome (mini bar, play button) — synced across devices
  listener_ui JSONB NOT NULL DEFAULT '{"v":1,"miniBarVariant":"floating","miniPlayStyle":"adaptive","updatedAt":0}'::jsonb,
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Social feed: backend-owned post state for listener social timeline
CREATE TABLE IF NOT EXISTS social_posts (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  body TEXT NOT NULL,
  kind VARCHAR(24) NOT NULL DEFAULT 'text' CHECK (kind IN ('text')),
  visibility VARCHAR(24) NOT NULL DEFAULT 'public' CHECK (visibility IN ('public')),
  status VARCHAR(24) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  likes_count INTEGER NOT NULL DEFAULT 0 CHECK (likes_count >= 0),
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
CREATE INDEX IF NOT EXISTS idx_social_post_likes_user_post
  ON social_post_likes (user_id, post_id);

-- Tables for ML Recommendations
CREATE TABLE IF NOT EXISTS user_models (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    behavior_vector FLOAT[],
    preferences JSONB,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    session_interactions INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_interactions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users (id) ON DELETE CASCADE,
    song_id INTEGER REFERENCES songs (id) ON DELETE CASCADE,
    interaction_type VARCHAR(50) NOT NULL, -- 'play', 'skip', 'like', 'complete'
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS song_features (
    id SERIAL PRIMARY KEY,
    song_id INTEGER REFERENCES songs (id) ON DELETE CASCADE UNIQUE,
    tempo FLOAT,
    energy FLOAT,
    valence FLOAT,
    danceability FLOAT,
    acousticness FLOAT,
    instrumentalness FLOAT,
    liveness FLOAT,
    speechiness FLOAT,
    loudness FLOAT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS genre_popularity (
    id SERIAL PRIMARY KEY,
    genre_name VARCHAR(100) NOT NULL,
    popularity_score FLOAT DEFAULT 0,
    trend_score FLOAT DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS artist_trends (
    id SERIAL PRIMARY KEY,
    artist_name VARCHAR(255) NOT NULL,
    play_count INTEGER DEFAULT 0,
    trend_score FLOAT DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_history (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users (id) ON DELETE CASCADE,
    song_id INTEGER REFERENCES songs (id) ON DELETE CASCADE,
    play_count INTEGER DEFAULT 1,
    liked BOOLEAN DEFAULT FALSE,
    last_played TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    total_play_time INTEGER DEFAULT 0,
    skip_count INTEGER DEFAULT 0,
    UNIQUE (user_id, song_id)
);

-- Service Sessions
CREATE TABLE IF NOT EXISTS service_sessions (
    id SERIAL PRIMARY KEY,
    service_name VARCHAR(100) NOT NULL,
    token_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- PERFORMANCE INDEXES
-- ============================================================================

-- Songs indexes (basic)
CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs (artist);
CREATE INDEX IF NOT EXISTS idx_songs_genre ON songs (genre);
CREATE INDEX IF NOT EXISTS idx_songs_uploader ON songs (uploader_id);
CREATE INDEX IF NOT EXISTS idx_songs_popularity ON songs (popularity DESC);
 CREATE INDEX IF NOT EXISTS idx_songs_ebap ON songs (id) WHERE has_ebap = TRUE;
 CREATE INDEX IF NOT EXISTS idx_songs_ebap_status ON songs (ebap_status, id);

 CREATE INDEX IF NOT EXISTS idx_songs_hls ON songs (id) WHERE has_hls = TRUE;
 CREATE INDEX IF NOT EXISTS idx_songs_hls_status ON songs (hls_status, id);

-- Songs composite indexes (for lookups and recommendations)
CREATE INDEX IF NOT EXISTS idx_songs_title_artist ON songs (LOWER(title), LOWER(artist));
CREATE INDEX IF NOT EXISTS idx_songs_artist_album ON songs (artist, album);
CREATE INDEX IF NOT EXISTS idx_songs_uploader_created ON songs (uploader_id, created_at DESC);

-- Playlist indexes
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'playlist_tracks'
          AND c.relkind IN ('r', 'p')
    ) THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist_id ON playlist_tracks (playlist_id)';
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_playlist_tracks_song_id ON playlist_tracks (song_id)';
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist_position ON playlist_tracks (playlist_id, position)';
    END IF;
END $$;

-- Likes indexes
CREATE INDEX IF NOT EXISTS idx_likes_user ON likes (user_id);
CREATE INDEX IF NOT EXISTS idx_likes_song ON likes (song_id);
CREATE INDEX IF NOT EXISTS idx_likes_user_song ON likes (user_id, song_id);

-- Dislikes indexes
CREATE INDEX IF NOT EXISTS idx_dislikes_user ON dislikes (user_id);
CREATE INDEX IF NOT EXISTS idx_dislikes_song ON dislikes (song_id);
CREATE INDEX IF NOT EXISTS idx_dislikes_user_song ON dislikes (user_id, song_id);

-- Listens indexes (for recommendations)
CREATE INDEX IF NOT EXISTS idx_listens_user_time ON listens (user_id, listened_at DESC);
CREATE INDEX IF NOT EXISTS idx_listens_song ON listens (song_id);
CREATE INDEX IF NOT EXISTS idx_listens_song_time ON listens (song_id, listened_at DESC);

-- User interactions indexes (ML/analytics)
CREATE INDEX IF NOT EXISTS idx_user_interactions_user_id ON user_interactions (user_id);
CREATE INDEX IF NOT EXISTS idx_user_interactions_timestamp ON user_interactions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_interactions_type ON user_interactions (interaction_type);
CREATE INDEX IF NOT EXISTS idx_user_interactions_user_type ON user_interactions (user_id, interaction_type);
CREATE INDEX IF NOT EXISTS idx_user_interactions_song_time ON user_interactions (song_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_interactions_composite ON user_interactions (user_id, created_at DESC, interaction_type);

-- User history indexes (recommendations)
CREATE INDEX IF NOT EXISTS idx_user_history_user_id ON user_history (user_id);
CREATE INDEX IF NOT EXISTS idx_user_history_last_played ON user_history (last_played DESC);
CREATE INDEX IF NOT EXISTS idx_user_history_composite ON user_history (user_id, last_played DESC, play_count);
CREATE INDEX IF NOT EXISTS idx_user_history_liked ON user_history (user_id, liked) WHERE liked = true;

-- Song features indexes (content-based filtering)
CREATE INDEX IF NOT EXISTS idx_song_features_tempo ON song_features (tempo);
CREATE INDEX IF NOT EXISTS idx_song_features_energy ON song_features (energy);
CREATE INDEX IF NOT EXISTS idx_song_features_valence ON song_features (valence);
CREATE INDEX IF NOT EXISTS idx_song_features_danceability ON song_features (danceability);

-- Service sessions indexes
CREATE INDEX IF NOT EXISTS idx_service_sessions_service_name ON service_sessions (service_name);
CREATE INDEX IF NOT EXISTS idx_service_sessions_expires_at ON service_sessions (expires_at);

-- EQ settings index
CREATE INDEX IF NOT EXISTS idx_user_eq_settings_user ON user_eq_settings (user_id);

-- User models index (ML)
CREATE INDEX IF NOT EXISTS idx_user_models_user ON user_models (user_id);
CREATE INDEX IF NOT EXISTS idx_user_models_last_updated ON user_models (last_updated DESC);

-- Insert basic genres
INSERT INTO
    genres (name)
VALUES ('Rock'),
    ('Pop'),
    ('Hip-Hop'),
    ('Electronic'),
    ('Jazz'),
    ('Classical'),
    ('Country'),
    ('R&B'),
    ('Reggae'),
    ('Folk'),
    ('Blues'),
    ('Funk'),
    ('Disco'),
    ('House'),
    ('Techno'),
    ('Dubstep'),
    ('Ambient'),
    ('Indie'),
    ('Alternative'),
    ('Punk') ON CONFLICT (name) DO NOTHING;

-- Триггер для обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_songs_updated_at ON songs;

CREATE TRIGGER update_songs_updated_at BEFORE UPDATE ON songs
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_playlists_updated_at ON playlists;

CREATE TRIGGER update_playlists_updated_at BEFORE UPDATE ON playlists
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Создание системного пользователя для библиотеки (если нет)
INSERT INTO
    users (
        id,
        email,
        username,
        created_at
    )
VALUES (
        1,
        'library@music.app',
        'Библиотека',
        NOW()
    ) ON CONFLICT (id) DO
UPDATE
SET
    username = 'Библиотека',
    email = 'library@music.app';

-- Убеждаемся что следующий автоинкремент будет с ID > 1
SELECT setval (
        'users_id_seq', GREATEST(
            (
                SELECT MAX(id)
                FROM users
            ), 1
        )
    );
