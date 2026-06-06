-- ============================================================================
-- RECOMMENDED INDEXES FOR ARTIST ANALYTICS MODULE
-- ============================================================================
-- Status: NOT APPLIED — review before running in production.
-- Risk level: LOW — all CREATE INDEX IF NOT EXISTS, no table locks on concurrent.
-- Run with: psql -f recommended_analytics_indexes.sql
-- For zero-downtime: use CREATE INDEX CONCURRENTLY (requires outside transaction).
-- ============================================================================

-- 1. user_interactions(song_id, interaction_type, created_at)
-- Used by: getTopTracks (play events per song), getDailyStreamTrend (daily plays),
--          getListenerEngagement, getSourceBreakdown
-- Existing idx_user_interactions_song_time covers (song_id, created_at DESC) but
-- does NOT include interaction_type — the planner cannot use it for
-- "WHERE interaction_type = 'play'" without a recheck.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ui_song_type_time
    ON user_interactions (song_id, interaction_type, created_at DESC);

-- 2. user_interactions(interaction_type, song_id)
-- Used by: getSourceBreakdown (GROUP BY interaction_type with song JOIN),
--          getListenerEngagement (FILTER by interaction_type)
-- The existing idx_user_interactions_type is single-column (interaction_type) —
-- adding song_id lets the planner do index-only joins.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ui_type_song
    ON user_interactions (interaction_type, song_id);

-- 3. likes(song_id) — already exists as idx_likes_song, skip.
-- 4. dislikes(song_id) — missing.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dislikes_song
    ON dislikes (song_id);

-- 5. playlist_tracks(song_id) — already exists as idx_playlist_tracks_song_id, skip.

-- 6. songs(artist, is_available, id) — partial covering index for artist-level queries.
-- buildArtistMatchSql uses regexp_split_to_table(artist, ...) so a B-tree on artist
-- helps only for equality after normalization; still, it aids the IS_AVAILABLE filter.
-- idx_songs_artist already exists but does NOT include is_available.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_songs_artist_available
    ON songs (artist, id)
    WHERE is_available = TRUE;

-- 7. After applying, run ANALYZE to update planner statistics:
-- ANALYZE user_interactions;
-- ANALYZE songs;
-- ANALYZE likes;
-- ANALYZE dislikes;
-- ANALYZE playlist_tracks;
