ALTER TABLE user_interactions
  ALTER COLUMN session_id TYPE TEXT;

ALTER TABLE recommendation_sessions
  ALTER COLUMN id TYPE TEXT;
