-- Idempotent recovery for legacy artists stored only in artist_uploaders.
-- Run against the production Postgres database after taking a backup.

BEGIN;

WITH legacy AS (
    SELECT DISTINCT ON (lower(regexp_replace(btrim(au.artist_name), '\s+', ' ', 'g')))
           au.user_id,
           btrim(au.artist_name) AS artist_name,
           lower(regexp_replace(btrim(au.artist_name), '\s+', ' ', 'g')) AS name_key,
           au.created_at
      FROM artist_uploaders au
      JOIN users u ON u.id = au.user_id
     WHERE au.is_active = TRUE
       AND btrim(COALESCE(au.artist_name, '')) <> ''
     ORDER BY lower(regexp_replace(btrim(au.artist_name), '\s+', ' ', 'g')), au.created_at ASC NULLS LAST, au.user_id ASC
),
artist_rows AS (
    INSERT INTO artists (name, name_key, created_by_user_id, is_verified, created_at, updated_at)
    SELECT l.artist_name, l.name_key, l.user_id, TRUE, COALESCE(l.created_at, NOW()), NOW()
      FROM legacy l
    ON CONFLICT (name_key) DO UPDATE
      SET updated_at = NOW()
    RETURNING id, name_key
),
all_artist_rows AS (
    SELECT ia.id, ia.name_key
      FROM artist_rows ia
    UNION
    SELECT a.id, a.name_key
      FROM artists a
     WHERE a.name_key IN (SELECT name_key FROM legacy)
),
ownership_candidates AS (
    SELECT a.id AS artist_id,
           l.user_id,
           COALESCE(l.created_at, NOW()) AS created_at
      FROM legacy l
      JOIN all_artist_rows a ON a.name_key = l.name_key
),
inserted_ownerships AS (
    INSERT INTO artist_ownerships (artist_id, user_id, role, status, created_at)
    SELECT c.artist_id, c.user_id, 'owner', 'active', c.created_at
      FROM ownership_candidates c
     WHERE NOT EXISTS (
               SELECT 1
                 FROM artist_ownerships o
                WHERE o.artist_id = c.artist_id
                  AND o.status = 'active'
                  AND o.revoked_at IS NULL
           )
    ON CONFLICT DO NOTHING
    RETURNING artist_id, user_id, role, status, created_at, revoked_at
),
active_ownerships AS (
    SELECT io.artist_id, io.user_id, io.role, io.status, io.created_at, io.revoked_at
      FROM inserted_ownerships io
    UNION
    SELECT o.artist_id, o.user_id, o.role, o.status, o.created_at, o.revoked_at
      FROM artist_ownerships o
     WHERE o.status = 'active'
       AND o.revoked_at IS NULL
),
ensured_accounts AS (
    INSERT INTO artist_accounts (artist_id, status)
    SELECT DISTINCT o.artist_id, 'active'
      FROM active_ownerships o
    ON CONFLICT (artist_id) DO UPDATE
      SET status = 'active',
          updated_at = NOW()
    RETURNING id, artist_id
),
all_accounts AS (
    SELECT ea.id, ea.artist_id
      FROM ensured_accounts ea
    UNION
    SELECT aa.id, aa.artist_id
      FROM artist_accounts aa
     WHERE aa.artist_id IN (SELECT artist_id FROM active_ownerships)
)
INSERT INTO artist_account_members (account_id, user_id, role, status, created_at, revoked_at)
SELECT aa.id, o.user_id, COALESCE(NULLIF(o.role, ''), 'owner'), o.status, o.created_at, o.revoked_at
  FROM active_ownerships o
  JOIN all_accounts aa ON aa.artist_id = o.artist_id
ON CONFLICT DO NOTHING;

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
      updated_at = NOW();

COMMIT;

-- Verification queries: first three counts should be 0.
WITH selected_legacy AS (
    SELECT DISTINCT ON (lower(regexp_replace(btrim(au.artist_name), '\s+', ' ', 'g')))
           au.user_id,
           btrim(au.artist_name) AS artist_name,
           lower(regexp_replace(btrim(au.artist_name), '\s+', ' ', 'g')) AS name_key
      FROM artist_uploaders au
     WHERE au.is_active = TRUE
       AND btrim(COALESCE(au.artist_name, '')) <> ''
     ORDER BY lower(regexp_replace(btrim(au.artist_name), '\s+', ' ', 'g')), au.created_at ASC NULLS LAST, au.user_id ASC
)
SELECT COUNT(*) AS selected_legacy_artist_uploaders_without_active_ownership
  FROM selected_legacy au
 WHERE NOT EXISTS (
       SELECT 1
         FROM artists a
         JOIN artist_ownerships o ON o.artist_id = a.id
        WHERE a.name_key = au.name_key
          AND o.user_id = au.user_id
          AND o.status = 'active'
          AND o.revoked_at IS NULL
   );

SELECT COUNT(*) AS active_ownerships_without_artist_account
  FROM artist_ownerships o
 WHERE o.status = 'active'
   AND o.revoked_at IS NULL
   AND NOT EXISTS (
       SELECT 1
         FROM artist_accounts aa
        WHERE aa.artist_id = o.artist_id
          AND aa.status = 'active'
   );

SELECT COUNT(*) AS active_ownerships_without_active_member
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
   );

SELECT COUNT(*) AS migrated_artist_ownerships
  FROM artist_ownerships o
  JOIN artists a ON a.id = o.artist_id
 WHERE o.status = 'active'
   AND o.revoked_at IS NULL
   AND EXISTS (
       SELECT 1
         FROM artist_uploaders au
        WHERE au.user_id = o.user_id
          AND au.is_active = TRUE
          AND lower(regexp_replace(btrim(au.artist_name), '\s+', ' ', 'g')) = a.name_key
   );

SELECT lower(regexp_replace(btrim(artist_name), '\s+', ' ', 'g')) AS name_key,
       COUNT(*) AS active_legacy_rows
  FROM artist_uploaders
 WHERE is_active = TRUE
   AND btrim(COALESCE(artist_name, '')) <> ''
 GROUP BY lower(regexp_replace(btrim(artist_name), '\s+', ' ', 'g'))
HAVING COUNT(*) > 1
 ORDER BY active_legacy_rows DESC, name_key ASC;
