-- Runtime consistency repair for known Earflow issues found by
-- scripts/audit-runtime-consistency.sql.
--
-- This script changes data. Run after a fresh Postgres backup.

BEGIN;

-- 1) Remove playlist rows that reference deleted/non-existent songs.
--    These rows cannot be played and break playlist consistency.
CREATE TEMP TABLE fixed_orphan_playlist_tracks AS
SELECT pt.id, pt.playlist_id, pt.song_id, pt.position
  FROM playlist_tracks pt
 WHERE NOT EXISTS (
       SELECT 1
         FROM songs s
        WHERE s.id = pt.song_id
   );

DELETE FROM playlist_tracks pt
 USING fixed_orphan_playlist_tracks f
 WHERE pt.id = f.id;

-- Re-number positions for playlists touched above.
WITH affected AS (
    SELECT DISTINCT playlist_id
      FROM fixed_orphan_playlist_tracks
),
ranked AS (
    SELECT pt.id,
           ROW_NUMBER() OVER (PARTITION BY pt.playlist_id ORDER BY pt.position, pt.id)::int AS new_position
      FROM playlist_tracks pt
      JOIN affected a ON a.playlist_id = pt.playlist_id
)
UPDATE playlist_tracks pt
   SET position = ranked.new_position
  FROM ranked
 WHERE pt.id = ranked.id
   AND pt.position <> ranked.new_position;

-- Recompute playlist cached counters and fallback cover for touched playlists.
WITH affected AS (
    SELECT DISTINCT playlist_id
      FROM fixed_orphan_playlist_tracks
),
stats AS (
    SELECT p.id AS playlist_id,
           COUNT(pt.id)::int AS track_count,
           (
             SELECT s.cover_path
               FROM playlist_tracks pt2
               JOIN songs s ON s.id = pt2.song_id
              WHERE pt2.playlist_id = p.id
              ORDER BY pt2.position, pt2.id
              LIMIT 1
           ) AS first_cover_path
      FROM playlists p
      JOIN affected a ON a.playlist_id = p.id
      LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
     GROUP BY p.id
)
UPDATE playlists p
   SET track_count = stats.track_count,
       cover_path = CASE
           WHEN stats.track_count = 0 THEN NULL
           WHEN p.cover_path IS NULL THEN stats.first_cover_path
           ELSE p.cover_path
       END,
       updated_at = NOW()
  FROM stats
 WHERE p.id = stats.playlist_id;

-- 2) Sync current artist ownerships back into legacy artist_uploaders.
--    Some artist-service catalog queries still read artist_uploaders.
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
      updated_at = NOW()
 WHERE artist_uploaders.is_active IS DISTINCT FROM TRUE
    OR lower(regexp_replace(btrim(artist_uploaders.artist_name), '\s+', ' ', 'g')) <>
       lower(regexp_replace(btrim(EXCLUDED.artist_name), '\s+', ' ', 'g'));

-- 3) Remove expired service sessions.
DELETE FROM service_sessions
 WHERE expires_at < NOW();

-- 4) Add missing FK protection for old deployments where playlist-service
--    created playlist_tracks without a songs FK.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'playlist_tracks_song_id_fkey'
           AND conrelid = 'playlist_tracks'::regclass
    ) THEN
        ALTER TABLE playlist_tracks
          ADD CONSTRAINT playlist_tracks_song_id_fkey
          FOREIGN KEY (song_id)
          REFERENCES songs(id)
          ON DELETE CASCADE;
    END IF;
END
$$;

-- Verification output.
SELECT 'deleted orphan playlist_tracks' AS check_name,
       COUNT(*)::bigint AS fixed_count
  FROM fixed_orphan_playlist_tracks;

SELECT 'playlist_tracks with missing song' AS check_name,
       COUNT(*)::bigint AS bad_count
  FROM playlist_tracks pt
 WHERE NOT EXISTS (SELECT 1 FROM songs s WHERE s.id = pt.song_id);

SELECT 'active ownerships missing legacy artist_uploaders sync' AS check_name,
       COUNT(*)::bigint AS bad_count
  FROM artist_ownerships o
  JOIN artists a ON a.id = o.artist_id
 WHERE o.status = 'active'
   AND o.revoked_at IS NULL
   AND NOT EXISTS (
       SELECT 1
         FROM artist_uploaders au
        WHERE au.user_id = o.user_id
          AND au.is_active = TRUE
          AND lower(regexp_replace(btrim(au.artist_name), '\s+', ' ', 'g')) = a.name_key
   );

SELECT 'expired service sessions still stored' AS check_name,
       COUNT(*)::bigint AS bad_count
  FROM service_sessions
 WHERE expires_at < NOW();

COMMIT;
