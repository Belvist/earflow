-- Read-only runtime consistency audit for Earflow.
-- Run against Postgres. It does not change data.

BEGIN;

CREATE TEMP TABLE runtime_consistency_audit (
    check_name TEXT NOT NULL,
    severity TEXT NOT NULL,
    bad_count BIGINT,
    details TEXT
) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp.audit_count(
    p_check_name TEXT,
    p_severity TEXT,
    p_sql TEXT,
    p_details TEXT
) RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    n BIGINT;
BEGIN
    EXECUTE p_sql INTO n;
    INSERT INTO runtime_consistency_audit(check_name, severity, bad_count, details)
    VALUES (p_check_name, p_severity, COALESCE(n, 0), p_details);
EXCEPTION
    WHEN undefined_table OR undefined_column THEN
        INSERT INTO runtime_consistency_audit(check_name, severity, bad_count, details)
        VALUES (p_check_name, 'SKIP', NULL, p_details || ' | skipped: ' || SQLERRM);
END;
$$;

SELECT pg_temp.audit_count(
    'artist_uploaders selected legacy rows without active ownership',
    'P0',
    $SQL$
    WITH selected_legacy AS (
        SELECT DISTINCT ON (lower(regexp_replace(btrim(au.artist_name), '\s+', ' ', 'g')))
               au.user_id,
               lower(regexp_replace(btrim(au.artist_name), '\s+', ' ', 'g')) AS name_key
          FROM artist_uploaders au
         WHERE au.is_active = TRUE
           AND btrim(COALESCE(au.artist_name, '')) <> ''
         ORDER BY lower(regexp_replace(btrim(au.artist_name), '\s+', ' ', 'g')),
                  au.created_at ASC NULLS LAST,
                  au.user_id ASC
    )
    SELECT COUNT(*)
      FROM selected_legacy au
     WHERE NOT EXISTS (
           SELECT 1
             FROM artists a
             JOIN artist_ownerships o ON o.artist_id = a.id
            WHERE a.name_key = au.name_key
              AND o.user_id = au.user_id
              AND o.status = 'active'
              AND o.revoked_at IS NULL
       )
    $SQL$,
    'Old artist_uploaders user is not recognized by current /api/artists/me source-of-truth.'
);

SELECT pg_temp.audit_count(
    'active artist ownerships without active artist account',
    'P0',
    $SQL$
    SELECT COUNT(*)
      FROM artist_ownerships o
     WHERE o.status = 'active'
       AND o.revoked_at IS NULL
       AND NOT EXISTS (
           SELECT 1
             FROM artist_accounts aa
            WHERE aa.artist_id = o.artist_id
              AND aa.status = 'active'
       )
    $SQL$,
    'Artist portal/account model is incomplete for an active ownership.'
);

SELECT pg_temp.audit_count(
    'active artist ownerships without active account member',
    'P0',
    $SQL$
    SELECT COUNT(*)
      FROM artist_ownerships o
      JOIN artist_accounts aa ON aa.artist_id = o.artist_id
     WHERE o.status = 'active'
       AND o.revoked_at IS NULL
       AND NOT EXISTS (
           SELECT 1
             FROM artist_account_members aam
            WHERE aam.account_id = aa.id
              AND aam.user_id = o.user_id
              AND aam.status = 'active'
              AND aam.revoked_at IS NULL
       )
    $SQL$,
    'Ownership exists, but team/account membership does not.'
);

SELECT pg_temp.audit_count(
    'approved artist claims without active ownership',
    'P0',
    $SQL$
    SELECT COUNT(*)
      FROM artist_claim_requests cr
     WHERE cr.status = 'approved'
       AND NOT EXISTS (
           SELECT 1
             FROM artist_ownerships o
            WHERE o.artist_id = cr.artist_id
              AND o.user_id = cr.user_id
              AND o.status = 'active'
              AND o.revoked_at IS NULL
       )
    $SQL$,
    'Moderation says approved, but runtime artist access is missing.'
);

SELECT pg_temp.audit_count(
    'active ownerships missing legacy artist_uploaders sync',
    'P1',
    $SQL$
    SELECT COUNT(*)
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
       )
    $SQL$,
    'Legacy artist_uploaders still used by some catalog queries in artist-service.'
);

SELECT pg_temp.audit_count(
    'duplicate active legacy artist_uploaders by artist name',
    'P1',
    $SQL$
    SELECT COUNT(*)
      FROM (
        SELECT lower(regexp_replace(btrim(artist_name), '\s+', ' ', 'g')) AS name_key
          FROM artist_uploaders
         WHERE is_active = TRUE
           AND btrim(COALESCE(artist_name, '')) <> ''
         GROUP BY lower(regexp_replace(btrim(artist_name), '\s+', ' ', 'g'))
        HAVING COUNT(*) > 1
      ) d
    $SQL$,
    'Multiple active legacy rows claim the same artist name; current ownership allows only one active owner.'
);

SELECT pg_temp.audit_count(
    'playlists with missing user',
    'P0',
    $SQL$
    SELECT COUNT(*)
      FROM playlists p
     WHERE p.user_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = p.user_id)
    $SQL$,
    'Playlist owner is missing.'
);

SELECT pg_temp.audit_count(
    'playlist_tracks with missing playlist',
    'P0',
    $SQL$
    SELECT COUNT(*)
      FROM playlist_tracks pt
     WHERE NOT EXISTS (SELECT 1 FROM playlists p WHERE p.id = pt.playlist_id)
    $SQL$,
    'Playlist track references a missing playlist.'
);

SELECT pg_temp.audit_count(
    'playlist_tracks with missing song',
    'P0',
    $SQL$
    SELECT COUNT(*)
      FROM playlist_tracks pt
     WHERE NOT EXISTS (SELECT 1 FROM songs s WHERE s.id = pt.song_id)
    $SQL$,
    'Playlist track references a missing song.'
);

SELECT pg_temp.audit_count(
    'playlist cached track_count mismatch',
    'P1',
    $SQL$
    SELECT COUNT(*)
      FROM playlists p
     WHERE COALESCE(p.track_count, 0) <> (
           SELECT COUNT(*)::int
             FROM playlist_tracks pt
            WHERE pt.playlist_id = p.id
       )
    $SQL$,
    'playlist-service maintains cached track_count, while other writers may bypass it.'
);

SELECT pg_temp.audit_count(
    'public playlists missing share_slug',
    'P1',
    $SQL$
    SELECT COUNT(*)
      FROM playlists
     WHERE is_public = TRUE
       AND (share_slug IS NULL OR length(btrim(share_slug)) = 0)
    $SQL$,
    'Public playlist cannot be opened by share route.'
);

SELECT pg_temp.audit_count(
    'songs with missing uploader user',
    'P0',
    $SQL$
    SELECT COUNT(*)
      FROM songs s
     WHERE s.uploader_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = s.uploader_id)
    $SQL$,
    'Song uploader user is missing.'
);

SELECT pg_temp.audit_count(
    'artist-owned songs whose artist text mismatches owner artist name',
    'P1',
    $SQL$
    SELECT COUNT(*)
      FROM songs s
      JOIN artist_ownerships o ON o.user_id = s.uploader_id
       AND o.status = 'active'
       AND o.revoked_at IS NULL
      JOIN artists a ON a.id = o.artist_id
     WHERE lower(regexp_replace(btrim(COALESCE(s.artist, '')), '\s+', ' ', 'g')) <> a.name_key
    $SQL$,
    'Upload ownership and song.artist disagree; can break artist pages/catalog attribution.'
);

SELECT pg_temp.audit_count(
    'playlist tracks pointing to unavailable songs',
    'P2',
    $SQL$
    SELECT COUNT(*)
      FROM playlist_tracks pt
      JOIN songs s ON s.id = pt.song_id
     WHERE COALESCE(s.is_available, TRUE) = FALSE
    $SQL$,
    'Unavailable tracks may remain visible in playlists unless filtered everywhere.'
);

SELECT pg_temp.audit_count(
    'likes and dislikes both present for same user/song',
    'P1',
    $SQL$
    SELECT COUNT(*)
      FROM likes l
      JOIN dislikes d ON d.user_id = l.user_id AND d.song_id = l.song_id
    $SQL$,
    'User feedback has conflicting positive and negative state.'
);

SELECT pg_temp.audit_count(
    'likes with missing user or song',
    'P1',
    $SQL$
    SELECT COUNT(*)
      FROM likes l
     WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = l.user_id)
        OR NOT EXISTS (SELECT 1 FROM songs s WHERE s.id = l.song_id)
    $SQL$,
    'Like references missing user/song.'
);

SELECT pg_temp.audit_count(
    'dislikes with missing user or song',
    'P1',
    $SQL$
    SELECT COUNT(*)
      FROM dislikes d
     WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = d.user_id)
        OR NOT EXISTS (SELECT 1 FROM songs s WHERE s.id = d.song_id)
    $SQL$,
    'Dislike references missing user/song.'
);

SELECT pg_temp.audit_count(
    'listens with missing user or song',
    'P1',
    $SQL$
    SELECT COUNT(*)
      FROM listens l
     WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = l.user_id)
        OR NOT EXISTS (SELECT 1 FROM songs s WHERE s.id = l.song_id)
    $SQL$,
    'Listen references missing user/song.'
);

SELECT pg_temp.audit_count(
    'user_history with missing user or song',
    'P1',
    $SQL$
    SELECT COUNT(*)
      FROM user_history h
     WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = h.user_id)
        OR NOT EXISTS (SELECT 1 FROM songs s WHERE s.id = h.song_id)
    $SQL$,
    'Recommendations history references missing user/song.'
);

SELECT pg_temp.audit_count(
    'user_interactions with missing user or song',
    'P1',
    $SQL$
    SELECT COUNT(*)
      FROM user_interactions i
     WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = i.user_id)
        OR (i.song_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM songs s WHERE s.id = i.song_id))
    $SQL$,
    'Recommendations interactions reference missing user/song.'
);

SELECT pg_temp.audit_count(
    'song_features with missing song',
    'P1',
    $SQL$
    SELECT COUNT(*)
      FROM song_features sf
     WHERE NOT EXISTS (SELECT 1 FROM songs s WHERE s.id = sf.song_id)
    $SQL$,
    'Feature extraction row references missing song.'
);

SELECT pg_temp.audit_count(
    'lyrics with missing song',
    'P2',
    $SQL$
    SELECT COUNT(*)
      FROM lyrics l
     WHERE NOT EXISTS (SELECT 1 FROM songs s WHERE s.id = l.song_id)
    $SQL$,
    'Lyrics row references missing song.'
);

SELECT pg_temp.audit_count(
    'lyrics_reports with missing user or song',
    'P2',
    $SQL$
    SELECT COUNT(*)
      FROM lyrics_reports r
     WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = r.user_id)
        OR NOT EXISTS (SELECT 1 FROM songs s WHERE s.id = r.song_id)
    $SQL$,
    'Lyrics report references missing user/song.'
);

SELECT pg_temp.audit_count(
    'active subscriptions duplicate users',
    'P1',
    $SQL$
    SELECT COUNT(*)
      FROM (
        SELECT user_id
          FROM subscriptions
         WHERE status = 'active'
         GROUP BY user_id
        HAVING COUNT(*) > 1
      ) d
    $SQL$,
    'More than one active subscription for one user.'
);

SELECT pg_temp.audit_count(
    'subscriptions with missing user',
    'P1',
    $SQL$
    SELECT COUNT(*)
      FROM subscriptions s
     WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = s.user_id)
    $SQL$,
    'Subscription references missing user.'
);

SELECT pg_temp.audit_count(
    'search outbox jobs older than 15 minutes',
    'P1',
    $SQL$
    SELECT COUNT(*)
      FROM search_outbox_queue
     WHERE next_attempt_at <= NOW() - INTERVAL '15 minutes'
    $SQL$,
    'Search index may lag behind Postgres.'
);

SELECT pg_temp.audit_count(
    'search outbox jobs with repeated attempts',
    'P2',
    $SQL$
    SELECT COUNT(*)
      FROM search_outbox_queue
     WHERE attempts >= 3
    $SQL$,
    'Search indexer is retrying some entities repeatedly.'
);

SELECT pg_temp.audit_count(
    'expired service sessions still stored',
    'P2',
    $SQL$
    SELECT COUNT(*)
      FROM service_sessions
     WHERE expires_at < NOW()
    $SQL$,
    'database-service cleanup may be stalled.'
);

SELECT *
  FROM runtime_consistency_audit
 ORDER BY CASE severity
            WHEN 'P0' THEN 0
            WHEN 'P1' THEN 1
            WHEN 'P2' THEN 2
            WHEN 'SKIP' THEN 9
            ELSE 8
          END,
          bad_count DESC NULLS LAST,
          check_name ASC;

ROLLBACK;
