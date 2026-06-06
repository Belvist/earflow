-- ==============================================================================
-- Recommendations Service - Additional Schema
-- Run this migration after 00-create-tables.sql
-- ==============================================================================

-- ==============================================================================
-- Recommendation Sessions Table
-- Tracks user recommendation sessions for analytics and debugging
-- ==============================================================================

CREATE TABLE IF NOT EXISTS recommendation_sessions (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(255) UNIQUE NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    source VARCHAR(50) NOT NULL DEFAULT 'global', -- 'personal', 'global', 'fallback'
    preferences JSONB,
    tracks_served INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP
);

-- Index for fast session lookups
CREATE INDEX IF NOT EXISTS idx_reco_sessions_session_id ON recommendation_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_reco_sessions_user_id ON recommendation_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_reco_sessions_expires ON recommendation_sessions(expires_at);

-- ==============================================================================
-- User Preferences Table
-- Stores computed user preferences for faster recommendations
-- ==============================================================================

CREATE TABLE IF NOT EXISTS user_preferences (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    favorite_genres JSONB DEFAULT '{}',
    favorite_artists JSONB DEFAULT '{}',
    listening_patterns JSONB DEFAULT '{}',
    computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_user_preferences_updated ON user_preferences(updated_at);

-- ==============================================================================
-- Additional Indexes for Recommendations Performance
-- ==============================================================================

-- Composite index for user history queries (offline worker)
CREATE INDEX IF NOT EXISTS idx_user_history_user_song 
    ON user_history(user_id, song_id);

-- Partial index for liked songs (frequently queried)
CREATE INDEX IF NOT EXISTS idx_user_history_liked 
    ON user_history(user_id, song_id) 
    WHERE liked = TRUE;

-- Covering index for songs (reduces table lookups)
CREATE INDEX IF NOT EXISTS idx_songs_reco_covering 
    ON songs(id, title, artist, album, genre, duration, popularity, play_count);

-- Index for recent user interactions (time-limited queries)
CREATE INDEX IF NOT EXISTS idx_user_interactions_recent 
    ON user_interactions(user_id, created_at DESC)
    WHERE created_at > NOW() - INTERVAL '12 months';

-- Index for user history with time filter
CREATE INDEX IF NOT EXISTS idx_user_history_recent 
    ON user_history(user_id, last_played DESC)
    WHERE last_played > NOW() - INTERVAL '12 months';

-- ==============================================================================
-- Materialized View for Daily Interaction Summary
-- Refresh periodically for analytics
-- ==============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS daily_interaction_summary AS
SELECT 
    date_trunc('day', created_at) AS day,
    interaction_type,
    COUNT(*) AS count,
    COUNT(DISTINCT user_id) AS unique_users,
    COUNT(DISTINCT song_id) AS unique_songs
FROM user_interactions
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY date_trunc('day', created_at), interaction_type
ORDER BY day DESC;

-- Create unique index for concurrent refresh
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_interaction_summary_day_type 
    ON daily_interaction_summary(day, interaction_type);

-- ==============================================================================
-- Function to Refresh Materialized Views
-- Call periodically (e.g., every hour via cron)
-- ==============================================================================

CREATE OR REPLACE FUNCTION refresh_recommendation_views()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY daily_interaction_summary;
END;
$$ LANGUAGE plpgsql;

-- ==============================================================================
-- Cleanup Function for Expired Sessions
-- Call periodically to clean up old sessions
-- ==============================================================================

CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM recommendation_sessions 
    WHERE expires_at < NOW() - INTERVAL '1 day';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ==============================================================================
-- Trigger to Update updated_at Timestamp
-- ==============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to user_preferences
DROP TRIGGER IF EXISTS trigger_user_preferences_updated_at ON user_preferences;
CREATE TRIGGER trigger_user_preferences_updated_at
    BEFORE UPDATE ON user_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to user_history
DROP TRIGGER IF EXISTS trigger_user_history_updated_at ON user_history;
-- Note: user_history doesn't have updated_at, using last_played instead

-- ==============================================================================
-- Grant Permissions (adjust as needed for your setup)
-- ==============================================================================

-- Ensure the application user can access all tables
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO your_app_user;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO your_app_user;

-- ==============================================================================
-- Analyze Tables for Query Optimizer
-- ==============================================================================

ANALYZE songs;
ANALYZE user_history;
ANALYZE user_interactions;
ANALYZE recommendation_sessions;
ANALYZE user_preferences;
