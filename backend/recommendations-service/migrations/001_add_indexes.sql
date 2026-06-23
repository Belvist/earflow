-- Migration: 001_add_indexes
-- Description: Add performance indexes for recommendations service
-- Date: 2024-01-01
-- Author: recommendations-service

-- ============================================
-- CRITICAL INDEXES FOR RECOMMENDATIONS SERVICE
-- ============================================

-- Index for user_history lookups (user_id, song_id is primary key candidate)
-- This should be UNIQUE if not already defined as primary key
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_user_history_user_song
ON user_history (user_id, song_id);

-- Index for songs popularity queries (used in fallback recommendations)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_songs_popularity_playcount_created
ON songs (popularity DESC, play_count DESC, created_at DESC);

-- Index for songs by id array lookups (used in fetchTracksByIds)
-- Note: Primary key index on id should already exist, this is for covering queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_songs_id_covering
ON songs (id) INCLUDE (title, artist, album, genre, popularity, play_count);

-- Index for user_interactions by user (for analytics)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_interactions_user_id
ON user_interactions (user_id);

-- Index for user_interactions by song (for analytics)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_interactions_song_id
ON user_interactions (song_id);

-- Composite index for user_interactions queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_interactions_user_song_type
ON user_interactions (user_id, song_id, interaction_type);

-- Index for user_history aggregations in offline worker
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_history_song_id
ON user_history (song_id);

-- Index for user_history liked songs
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_history_user_liked
ON user_history (user_id) WHERE liked = TRUE;

-- ============================================
-- PARTIAL INDEXES FOR COMMON QUERIES
-- ============================================

-- Partial index for recently played songs (last 30 days)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_history_recent
ON user_history (user_id, last_played DESC)
;

-- Partial index for popular songs (popularity > 50)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_songs_popular
ON songs (popularity DESC, play_count DESC)
WHERE popularity > 50;

-- ============================================
-- INDEXES FOR OFFLINE WORKER SQL QUERIES
-- ============================================

-- Index for song stats aggregation (groupby song_id)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_history_song_agg
ON user_history (song_id, play_count, liked, skip_count);

-- Index for user preferences (groupby artist/genre join)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_songs_artist_genre
ON songs (artist, genre) INCLUDE (id);

-- Index for active users query (HAVING COUNT >= N)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_history_user_count
ON user_history (user_id);

-- ============================================
-- INDEXES FOR USER_INTERACTIONS TIMESTAMP
-- ============================================

-- Index for timestamp-based queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_interactions_created
ON user_interactions (created_at DESC);

-- Index for user + timestamp range queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_interactions_user_created
ON user_interactions (user_id, created_at DESC);

-- ============================================
-- ANALYZE TABLES AFTER INDEX CREATION
-- ============================================

ANALYZE user_history;
ANALYZE user_interactions;
ANALYZE songs;
