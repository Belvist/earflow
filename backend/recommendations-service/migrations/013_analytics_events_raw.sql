CREATE TABLE IF NOT EXISTS analytics_events_raw (
  event_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL DEFAULT 1,
  event_time TIMESTAMPTZ NOT NULL,
  ingest_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id INTEGER NOT NULL,
  session_id TEXT,
  playback_session_id TEXT,
  track_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  progress NUMERIC(4,3),
  context JSONB,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_raw_user_time
ON analytics_events_raw (user_id, event_time DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_events_raw_track_time
ON analytics_events_raw (track_id, event_time DESC);

ALTER TABLE user_interactions
  ADD COLUMN IF NOT EXISTS event_id TEXT;

ALTER TABLE user_interactions
  ADD COLUMN IF NOT EXISTS playback_session_id TEXT;

ALTER TABLE user_interactions
  ADD COLUMN IF NOT EXISTS event_time TIMESTAMPTZ;
