\set ON_ERROR_STOP on
\pset pager off

\if :{?artist_id}
\else
\set artist_id ''
\endif
\if :{?artist_public_id}
\else
\set artist_public_id ''
\endif
\if :{?artist_name}
\else
\set artist_name ''
\endif
\if :{?scope}
\else
\set scope 'owned'
\endif
\if :{?confirm}
\else
\set confirm ''
\endif

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SET LOCAL idle_in_transaction_session_timeout = '16min';

CREATE TEMP TABLE _delete_artist_input ON COMMIT DROP AS
SELECT
    NULLIF(:'artist_id', '')::integer AS artist_id,
    lower(NULLIF(:'artist_public_id', '')) AS artist_public_id,
    NULLIF(:'artist_name', '') AS artist_name,
    lower(NULLIF(:'scope', '')) AS deletion_scope,
    NULLIF(:'confirm', '') AS confirmation;

DO $$
DECLARE
    selector_count integer;
    deletion_scope text;
    public_id text;
BEGIN
    SELECT
        ((artist_id IS NOT NULL)::integer + (COALESCE(artist_public_id, '') <> '')::integer + (COALESCE(artist_name, '') <> '')::integer),
        deletion_scope,
        COALESCE(artist_public_id, '')
      INTO selector_count, deletion_scope, public_id
      FROM _delete_artist_input;

    IF selector_count <> 1 THEN
        RAISE EXCEPTION 'Provide exactly one selector: artist_id, artist_public_id, or artist_name';
    END IF;

    IF deletion_scope NOT IN ('owned', 'all') THEN
        RAISE EXCEPTION 'scope must be owned or all';
    END IF;

    IF public_id <> '' AND public_id !~ '^[a-f0-9]{32}$' THEN
        RAISE EXCEPTION 'artist_public_id must be 32 lowercase/uppercase hex characters';
    END IF;
END $$;

CREATE TEMP TABLE _delete_artist_target ON COMMIT DROP AS
WITH input AS (
    SELECT
        artist_id,
        artist_public_id,
        artist_name,
        lower(regexp_replace(btrim(COALESCE(artist_name, '')), '\s+', ' ', 'g')) AS artist_name_key
      FROM _delete_artist_input
), matched AS (
    SELECT a.id, a.public_id, a.name, a.name_key
      FROM artists a
      JOIN input i ON (
           (i.artist_id IS NOT NULL AND a.id = i.artist_id)
        OR (COALESCE(i.artist_public_id, '') <> '' AND lower(a.public_id) = i.artist_public_id)
        OR (COALESCE(i.artist_name, '') <> '' AND a.name_key = i.artist_name_key)
      )
)
SELECT id, public_id, name, name_key
  FROM matched
UNION ALL
SELECT NULL::integer AS id,
       NULL::text AS public_id,
       i.artist_name AS name,
       i.artist_name_key AS name_key
  FROM input i
 WHERE COALESCE(i.artist_name, '') <> ''
   AND NOT EXISTS (SELECT 1 FROM matched);

DO $$
DECLARE
    target_count integer;
    input_name text;
BEGIN
    SELECT COUNT(*) INTO target_count FROM _delete_artist_target;
    SELECT artist_name INTO input_name FROM _delete_artist_input;

    IF target_count = 0 THEN
        RAISE EXCEPTION 'Artist not found';
    END IF;

    IF target_count > 1 THEN
        RAISE EXCEPTION 'Artist selector matched more than one row';
    END IF;

    IF EXISTS (SELECT 1 FROM _delete_artist_target WHERE COALESCE(name_key, '') = '') THEN
        RAISE EXCEPTION 'Artist name_key is empty';
    END IF;
END $$;

CREATE TEMP TABLE _delete_artist_owner_user_ids ON COMMIT DROP AS
WITH target AS (
    SELECT id, name_key FROM _delete_artist_target
), owners AS (
    SELECT o.user_id
      FROM artist_ownerships o
      JOIN target t ON t.id IS NOT NULL AND o.artist_id = t.id
     WHERE o.user_id IS NOT NULL
    UNION
    SELECT aam.user_id
      FROM artist_account_members aam
      JOIN artist_accounts aa ON aa.id = aam.account_id
      JOIN target t ON t.id IS NOT NULL AND aa.artist_id = t.id
     WHERE aam.user_id IS NOT NULL
    UNION
    SELECT a.created_by_user_id AS user_id
      FROM artists a
      JOIN target t ON t.id IS NOT NULL AND a.id = t.id
     WHERE a.created_by_user_id IS NOT NULL
    UNION
    SELECT au.user_id
      FROM artist_uploaders au
      JOIN target t ON lower(regexp_replace(btrim(COALESCE(au.artist_name, '')), '\s+', ' ', 'g')) = t.name_key
     WHERE au.is_active = TRUE
       AND au.user_id IS NOT NULL
)
SELECT DISTINCT user_id
  FROM owners
 WHERE user_id IS NOT NULL;

CREATE TEMP TABLE _delete_artist_song_ids (
    id integer PRIMARY KEY,
    file_path text,
    cover_path text,
    file_size bigint
) ON COMMIT DROP;

INSERT INTO _delete_artist_song_ids (id, file_path, cover_path, file_size)
SELECT DISTINCT s.id, s.file_path::text, s.cover_path::text, s.file_size
  FROM songs s
  JOIN _delete_artist_target t ON s.artist = t.name
 WHERE ((SELECT deletion_scope FROM _delete_artist_input) = 'all'
        OR s.uploader_id IN (SELECT user_id FROM _delete_artist_owner_user_ids))
ON CONFLICT (id) DO NOTHING;

INSERT INTO _delete_artist_song_ids (id, file_path, cover_path, file_size)
SELECT DISTINCT s.id, s.file_path::text, s.cover_path::text, s.file_size
  FROM songs s
  JOIN _delete_artist_target t ON lower(regexp_replace(btrim(COALESCE(s.artist, '')), '\s+', ' ', 'g')) = t.name_key
 WHERE ((SELECT deletion_scope FROM _delete_artist_input) = 'all'
        OR s.uploader_id IN (SELECT user_id FROM _delete_artist_owner_user_ids))
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
    has_artist_norm boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'songs'
           AND column_name = 'artist_norm'
    ) INTO has_artist_norm;

    IF has_artist_norm THEN
        EXECUTE $sql$
            INSERT INTO _delete_artist_song_ids (id, file_path, cover_path, file_size)
            SELECT DISTINCT s.id, s.file_path::text, s.cover_path::text, s.file_size
              FROM songs s
              JOIN _delete_artist_target t ON s.artist_norm = t.name_key
             WHERE ((SELECT deletion_scope FROM _delete_artist_input) = 'all'
                    OR s.uploader_id IN (SELECT user_id FROM _delete_artist_owner_user_ids))
            ON CONFLICT (id) DO NOTHING
        $sql$;
    END IF;
END $$;

INSERT INTO _delete_artist_song_ids (id, file_path, cover_path, file_size)
SELECT DISTINCT s.id, s.file_path::text, s.cover_path::text, s.file_size
  FROM songs s
  JOIN _delete_artist_target t ON EXISTS (
       SELECT 1
         FROM regexp_split_to_table(COALESCE(s.artist, ''), '\s*(?:;|,|&|\mfeat\.?\M|\mft\.?\M)\s*') AS part
        WHERE lower(regexp_replace(btrim(part), '\s+', ' ', 'g')) = t.name_key
  )
 WHERE ((SELECT deletion_scope FROM _delete_artist_input) = 'all'
        OR s.uploader_id IN (SELECT user_id FROM _delete_artist_owner_user_ids))
ON CONFLICT (id) DO NOTHING;

CREATE TEMP TABLE _delete_artist_counts (
    table_name text PRIMARY KEY,
    deleted_count bigint NOT NULL
) ON COMMIT DROP;

\echo Target artist
TABLE _delete_artist_target;
\echo Owner uploader ids
TABLE _delete_artist_owner_user_ids;
\echo Songs selected for deletion
SELECT COUNT(*)::bigint AS song_count,
       COALESCE(SUM(file_size), 0)::bigint AS total_file_size_bytes
  FROM _delete_artist_song_ids;
\echo First selected songs
SELECT s.id, s.title, s.artist, s.album, s.uploader_id, s.file_path
  FROM songs s
  JOIN _delete_artist_song_ids ids ON ids.id = s.id
 ORDER BY s.id
 LIMIT 30;
\echo Object keys selected for follow-up storage cleanup
SELECT id,
       NULLIF(regexp_replace(COALESCE(file_path, ''), '^/+', ''), '') AS audio_key,
       NULLIF(regexp_replace(COALESCE(cover_path, ''), '^/+', ''), '') AS cover_key
  FROM _delete_artist_song_ids
 ORDER BY id;

DO $$
DECLARE
    rel record;
    affected bigint;
BEGIN
    FOR rel IN
        SELECT c.table_schema, c.table_name
          FROM information_schema.columns c
          JOIN information_schema.tables t
            ON t.table_schema = c.table_schema
           AND t.table_name = c.table_name
         WHERE c.table_schema = 'public'
           AND c.column_name = 'song_id'
           AND c.table_name <> 'songs'
           AND t.table_type = 'BASE TABLE'
         ORDER BY table_name
    LOOP
        EXECUTE format(
            'DELETE FROM %I.%I child USING _delete_artist_song_ids ids WHERE child.song_id = ids.id',
            rel.table_schema,
            rel.table_name
        );
        GET DIAGNOSTICS affected = ROW_COUNT;
        INSERT INTO _delete_artist_counts (table_name, deleted_count)
        VALUES (rel.table_name, affected)
        ON CONFLICT (table_name) DO UPDATE SET deleted_count = EXCLUDED.deleted_count;
    END LOOP;
END $$;

DO $$
DECLARE
    affected bigint;
    deletion_scope text;
BEGIN
    SELECT deletion_scope INTO deletion_scope FROM _delete_artist_input;

    IF to_regclass('public.statistics_cache') IS NOT NULL THEN
        DELETE FROM statistics_cache sc
         USING _delete_artist_target t
         WHERE sc.entity_type = 'artist'
           AND lower(regexp_replace(btrim(COALESCE(sc.entity_value, '')), '\s+', ' ', 'g')) = t.name_key
           AND (deletion_scope = 'all' OR sc.uploader_id IN (SELECT user_id FROM _delete_artist_owner_user_ids));
        GET DIAGNOSTICS affected = ROW_COUNT;
        INSERT INTO _delete_artist_counts (table_name, deleted_count)
        VALUES ('statistics_cache', affected)
        ON CONFLICT (table_name) DO UPDATE SET deleted_count = _delete_artist_counts.deleted_count + EXCLUDED.deleted_count;
    END IF;

    IF to_regclass('public.artist_trends') IS NOT NULL THEN
        DELETE FROM artist_trends at
         USING _delete_artist_target t
         WHERE lower(regexp_replace(btrim(COALESCE(at.artist_name, '')), '\s+', ' ', 'g')) = t.name_key;
        GET DIAGNOSTICS affected = ROW_COUNT;
        INSERT INTO _delete_artist_counts (table_name, deleted_count)
        VALUES ('artist_trends', affected)
        ON CONFLICT (table_name) DO UPDATE SET deleted_count = _delete_artist_counts.deleted_count + EXCLUDED.deleted_count;
    END IF;

    IF to_regclass('public.analytics_events_raw') IS NOT NULL THEN
        DELETE FROM analytics_events_raw ar
         USING _delete_artist_song_ids ids
         WHERE ar.track_id = ids.id;
        GET DIAGNOSTICS affected = ROW_COUNT;
        INSERT INTO _delete_artist_counts (table_name, deleted_count)
        VALUES ('analytics_events_raw', affected)
        ON CONFLICT (table_name) DO UPDATE SET deleted_count = _delete_artist_counts.deleted_count + EXCLUDED.deleted_count;
    END IF;

    DELETE FROM artist_uploaders au
     USING _delete_artist_target t
     WHERE lower(regexp_replace(btrim(COALESCE(au.artist_name, '')), '\s+', ' ', 'g')) = t.name_key
       AND (deletion_scope = 'all' OR au.user_id IN (SELECT user_id FROM _delete_artist_owner_user_ids));
    GET DIAGNOSTICS affected = ROW_COUNT;
    INSERT INTO _delete_artist_counts (table_name, deleted_count)
    VALUES ('artist_uploaders', affected)
    ON CONFLICT (table_name) DO UPDATE SET deleted_count = _delete_artist_counts.deleted_count + EXCLUDED.deleted_count;

    DELETE FROM songs s
     USING _delete_artist_song_ids ids
     WHERE s.id = ids.id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    INSERT INTO _delete_artist_counts (table_name, deleted_count)
    VALUES ('songs', affected)
    ON CONFLICT (table_name) DO UPDATE SET deleted_count = _delete_artist_counts.deleted_count + EXCLUDED.deleted_count;

    DELETE FROM artists a
     USING _delete_artist_target t
     WHERE t.id IS NOT NULL
       AND a.id = t.id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    INSERT INTO _delete_artist_counts (table_name, deleted_count)
    VALUES ('artists', affected)
    ON CONFLICT (table_name) DO UPDATE SET deleted_count = _delete_artist_counts.deleted_count + EXCLUDED.deleted_count;

    IF to_regprocedure('public.refresh_statistics_cache()') IS NOT NULL THEN
        SELECT refresh_statistics_cache() INTO affected;
        INSERT INTO _delete_artist_counts (table_name, deleted_count)
        VALUES ('statistics_cache_refresh', COALESCE(affected, 0))
        ON CONFLICT (table_name) DO UPDATE SET deleted_count = EXCLUDED.deleted_count;
    END IF;
END $$;

\echo Delete counters inside transaction
SELECT table_name, deleted_count
  FROM _delete_artist_counts
 ORDER BY table_name;

\echo Remaining matching songs inside transaction
SELECT COUNT(*)::bigint AS remaining_matching_songs
  FROM songs s
  JOIN _delete_artist_target t ON EXISTS (
       SELECT 1
         FROM regexp_split_to_table(COALESCE(s.artist, ''), '\s*(?:;|,|&|\mfeat\.?\M|\mft\.?\M)\s*') AS part
        WHERE lower(regexp_replace(btrim(part), '\s+', ' ', 'g')) = t.name_key
  )
 WHERE ((SELECT deletion_scope FROM _delete_artist_input) = 'all'
        OR s.uploader_id IN (SELECT user_id FROM _delete_artist_owner_user_ids));

SELECT CASE WHEN (SELECT confirmation FROM _delete_artist_input) = 'DELETE' THEN 'true' ELSE 'false' END AS do_commit \gset

\if :do_commit
COMMIT;
\echo Committed artist deletion
\else
ROLLBACK;
\echo Rolled back dry-run. Re-run with -v confirm=DELETE to commit.
\endif
