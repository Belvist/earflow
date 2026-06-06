CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE user_models
  ADD COLUMN IF NOT EXISTS embedding vector(8);

ALTER TABLE user_interactions
  ADD COLUMN IF NOT EXISTS session_id VARCHAR(200);

ALTER TABLE user_interactions
  ADD COLUMN IF NOT EXISTS duration_ms INTEGER DEFAULT 0;

ALTER TABLE user_interactions
  ADD COLUMN IF NOT EXISTS progress NUMERIC(4,3);
