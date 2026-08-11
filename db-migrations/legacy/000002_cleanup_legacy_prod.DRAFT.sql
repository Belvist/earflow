-- ============================================================================
-- DRAFT — NOT TO BE APPLIED without explicit sign-off.
-- 000002_cleanup_legacy_prod.sql
--
-- Removes legacy objects confirmed dead on production:
--   - equalizer_presets       (0 rows, no code refs; superseded by user_eq_settings)
--   - listening_history       (0 rows, no code refs; superseded by listens)
--   - user_song_likes         (0 rows, no code refs; superseded by likes)
--   - playlist_songs (view)   (no callers; INSTEAD OF triggers existed for legacy name)
--   - playlist_songs_view_ins / playlist_songs_view_del (trigger fns for that view)
--   - cleanup_expired_sessions (duplicate of canonical cleanup_expired_reco_sessions)
--   - refresh_recommendation_views + matview daily_interaction_summary (no callers)
--
-- Pre-conditions before applying (production):
--   1. Verify row counts still zero:  SELECT count(*) FROM equalizer_presets; etc.
--   2. Grep whole repo & gateway for any caller of these objects.
--   3. Take pg_dump backup of these objects (schema-only) as a safety net.
--   4. Confirm no service in k8s/local compose mounts creates them at startup.
--
-- This file intentionally uses plain DROP (not IF EXISTS guarded behaviour beyond
-- safety) — the runner is transactional, so partial failure rolls back.
-- ============================================================================

DROP VIEW IF EXISTS public.playlist_songs CASCADE;
DROP FUNCTION IF EXISTS public.playlist_songs_view_ins();
DROP FUNCTION IF EXISTS public.playlist_songs_view_del();

DROP TABLE IF EXISTS public.equalizer_presets;
DROP TABLE IF EXISTS public.listening_history;
DROP TABLE IF EXISTS public.user_song_likes;

DROP FUNCTION IF EXISTS public.cleanup_expired_sessions();
DROP FUNCTION IF EXISTS public.refresh_recommendation_views();
DROP MATERIALIZED VIEW IF EXISTS public.daily_interaction_summary;
