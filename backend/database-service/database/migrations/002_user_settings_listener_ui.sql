-- Listener UI preferences (mini bar, play button) — synced per user across devices.
-- Apply: psql $DATABASE_URL -f backend/database-service/database/migrations/002_user_settings_listener_ui.sql

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS listener_ui JSONB NOT NULL DEFAULT '{"v":1,"miniBarVariant":"floating","miniPlayStyle":"adaptive","updatedAt":0}'::jsonb;

COMMENT ON COLUMN user_settings.listener_ui IS 'Earflow listener chrome prefs (schema v1): miniBarVariant, miniPlayStyle, updatedAt';
