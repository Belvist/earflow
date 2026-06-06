\pset pager off
\pset null 'NULL'

BEGIN;

CREATE TEMP TABLE reco_event_audit (
  id BIGSERIAL,
  section TEXT NOT NULL,
  metric TEXT NOT NULL,
  value TEXT,
  details TEXT
);

CREATE OR REPLACE FUNCTION pg_temp.audit_scalar(
  p_section TEXT,
  p_metric TEXT,
  p_sql TEXT,
  p_details TEXT DEFAULT NULL
) RETURNS void AS $$
DECLARE
  v TEXT;
BEGIN
  EXECUTE p_sql INTO v;
  INSERT INTO reco_event_audit(section, metric, value, details)
  VALUES (p_section, p_metric, COALESCE(v, 'NULL'), p_details);
EXCEPTION
  WHEN undefined_table OR undefined_column OR undefined_function THEN
    INSERT INTO reco_event_audit(section, metric, value, details)
    VALUES (p_section, p_metric, 'SKIP', SQLERRM);
END;
$$ LANGUAGE plpgsql;

SELECT pg_temp.audit_scalar(
  '01_tables',
  'presence',
  $SQL$
  SELECT jsonb_object_agg(name, present ORDER BY name)::text
  FROM (
    VALUES
      ('analytics_events_raw', to_regclass('analytics_events_raw') IS NOT NULL),
      ('user_interactions', to_regclass('user_interactions') IS NOT NULL),
      ('user_history', to_regclass('user_history') IS NOT NULL),
      ('user_models', to_regclass('user_models') IS NOT NULL),
      ('user_taste_clusters', to_regclass('user_taste_clusters') IS NOT NULL),
      ('user_taste_links', to_regclass('user_taste_links') IS NOT NULL),
      ('songs', to_regclass('songs') IS NOT NULL),
      ('song_features', to_regclass('song_features') IS NOT NULL),
      ('likes', to_regclass('likes') IS NOT NULL),
      ('dislikes', to_regclass('dislikes') IS NOT NULL)
  ) AS t(name, present)
  $SQL$
);

SELECT pg_temp.audit_scalar(
  '01_tables',
  'row_counts',
  $SQL$
  SELECT jsonb_build_object(
    'analytics_events_raw', (SELECT count(*) FROM analytics_events_raw),
    'user_interactions', (SELECT count(*) FROM user_interactions),
    'user_history', (SELECT count(*) FROM user_history),
    'user_models', (SELECT count(*) FROM user_models),
    'user_taste_clusters', (SELECT count(*) FROM user_taste_clusters),
    'user_taste_links', (SELECT count(*) FROM user_taste_links),
    'songs', (SELECT count(*) FROM songs),
    'song_features', (SELECT count(*) FROM song_features),
    'likes', (SELECT count(*) FROM likes),
    'dislikes', (SELECT count(*) FROM dislikes)
  )::text
  $SQL$
);

SELECT pg_temp.audit_scalar(
  '02_volume',
  'raw_events_by_action_24h',
  $SQL$
  SELECT COALESCE(jsonb_object_agg(action, cnt ORDER BY action)::text, '{}')
  FROM (
    SELECT action, count(*) AS cnt
    FROM analytics_events_raw
    WHERE event_time >= now() - interval '24 hours'
    GROUP BY action
  ) s
  $SQL$
);

SELECT pg_temp.audit_scalar(
  '02_volume',
  'normalized_interactions_by_action_24h',
  $SQL$
  SELECT COALESCE(jsonb_object_agg(interaction_type, cnt ORDER BY interaction_type)::text, '{}')
  FROM (
    SELECT interaction_type, count(*) AS cnt
    FROM user_interactions
    WHERE COALESCE(event_time, created_at) >= now() - interval '24 hours'
    GROUP BY interaction_type
  ) s
  $SQL$
);

SELECT pg_temp.audit_scalar(
  '02_volume',
  'raw_vs_normalized_24h',
  $SQL$
  SELECT jsonb_build_object(
    'raw_24h', (SELECT count(*) FROM analytics_events_raw WHERE event_time >= now() - interval '24 hours'),
    'normalized_24h', (SELECT count(*) FROM user_interactions WHERE COALESCE(event_time, created_at) >= now() - interval '24 hours'),
    'raw_7d', (SELECT count(*) FROM analytics_events_raw WHERE event_time >= now() - interval '7 days'),
    'normalized_7d', (SELECT count(*) FROM user_interactions WHERE COALESCE(event_time, created_at) >= now() - interval '7 days')
  )::text
  $SQL$,
  'raw and normalized should be close; large gaps mean dedupe/drop/invalid writes'
);

SELECT pg_temp.audit_scalar(
  '03_event_quality',
  'legacy_event_id_ratio_24h',
  $SQL$
  SELECT jsonb_build_object(
    'total', count(*),
    'legacy_event_id', count(*) FILTER (WHERE event_id LIKE 'legacy:%'),
    'ratio', round((count(*) FILTER (WHERE event_id LIKE 'legacy:%'))::numeric / GREATEST(count(*), 1), 4)
  )::text
  FROM analytics_events_raw
  WHERE event_time >= now() - interval '24 hours'
  $SQL$,
  'legacy event_id means frontend did not send stable eventId'
);

SELECT pg_temp.audit_scalar(
  '03_event_quality',
  'rapid_duplicate_fingerprints_24h',
  $SQL$
  WITH ordered AS (
    SELECT
      user_id,
      track_id,
      action,
      event_time,
      lag(event_time) OVER (
        PARTITION BY user_id, track_id, action
        ORDER BY event_time
      ) AS prev_event_time
    FROM analytics_events_raw
    WHERE event_time >= now() - interval '24 hours'
  )
  SELECT jsonb_build_object(
    'within_2s', count(*) FILTER (WHERE prev_event_time IS NOT NULL AND event_time - prev_event_time <= interval '2 seconds'),
    'within_10s', count(*) FILTER (WHERE prev_event_time IS NOT NULL AND event_time - prev_event_time <= interval '10 seconds')
  )::text
  FROM ordered
  $SQL$,
  'high values mean the frontend is spamming the same semantic event'
);

SELECT pg_temp.audit_scalar(
  '03_event_quality',
  'noisy_semantics_24h',
  $SQL$
  SELECT jsonb_build_object(
    'skip_near_complete_progress_092', count(*) FILTER (WHERE action = 'skip' AND progress >= 0.92),
    'complete_low_progress_lt_080', count(*) FILTER (WHERE action = 'complete' AND progress IS NOT NULL AND progress < 0.80),
    'play_duration_lt_1s', count(*) FILTER (WHERE action = 'play' AND COALESCE(duration_ms, 0) < 1000),
    'future_events_gt_5m', count(*) FILTER (WHERE event_time > now() + interval '5 minutes'),
    'late_ingest_old_event_gt_30d', count(*) FILTER (WHERE event_time < now() - interval '30 days' AND ingest_time >= now() - interval '24 hours'),
    'missing_session_id', count(*) FILTER (WHERE session_id IS NULL OR session_id = ''),
    'missing_playback_session_id', count(*) FILTER (WHERE playback_session_id IS NULL OR playback_session_id = '')
  )::text
  FROM analytics_events_raw
  WHERE event_time >= now() - interval '24 hours'
  $SQL$
);

SELECT pg_temp.audit_scalar(
  '03_event_quality',
  'top_noisy_users_24h',
  $SQL$
  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.events DESC)::text, '[]')
  FROM (
    SELECT
      user_id,
      count(*) AS events,
      count(DISTINCT track_id) AS distinct_tracks,
      round(count(*)::numeric / GREATEST(count(DISTINCT track_id), 1), 2) AS events_per_track
    FROM analytics_events_raw
    WHERE event_time >= now() - interval '24 hours'
    GROUP BY user_id
    ORDER BY events DESC
    LIMIT 20
  ) s
  $SQL$
);

SELECT pg_temp.audit_scalar(
  '03_event_quality',
  'top_repeated_track_actions_24h',
  $SQL$
  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.events DESC)::text, '[]')
  FROM (
    SELECT user_id, track_id, action, count(*) AS events
    FROM analytics_events_raw
    WHERE event_time >= now() - interval '24 hours'
    GROUP BY user_id, track_id, action
    HAVING count(*) > 5
    ORDER BY events DESC
    LIMIT 20
  ) s
  $SQL$
);

SELECT pg_temp.audit_scalar(
  '04_feedback_meaning',
  'action_stats_7d',
  $SQL$
  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.action)::text, '[]')
  FROM (
    SELECT
      action,
      count(*) AS events,
      round(avg(progress)::numeric, 3) AS avg_progress,
      round((avg(duration_ms) / 1000.0)::numeric, 2) AS avg_duration_sec,
      count(*) FILTER (WHERE progress IS NULL) AS null_progress
    FROM analytics_events_raw
    WHERE event_time >= now() - interval '7 days'
    GROUP BY action
  ) s
  $SQL$
);

SELECT pg_temp.audit_scalar(
  '04_feedback_meaning',
  'history_totals',
  $SQL$
  SELECT jsonb_build_object(
    'history_play_count_sum', (SELECT COALESCE(sum(play_count), 0) FROM user_history),
    'history_skip_count_sum', (SELECT COALESCE(sum(skip_count), 0) FROM user_history),
    'interactions_play_or_complete', (SELECT count(*) FROM user_interactions WHERE interaction_type IN ('play', 'complete')),
    'interactions_skip_or_dislike', (SELECT count(*) FROM user_interactions WHERE interaction_type IN ('skip', 'dislike')),
    'history_rows_with_negative_counts', (SELECT count(*) FROM user_history WHERE COALESCE(play_count, 0) < 0 OR COALESCE(skip_count, 0) < 0 OR COALESCE(total_play_time, 0) < 0)
  )::text
  $SQL$,
  'history is aggregated; this is a sanity check, not exact event replay'
);

SELECT pg_temp.audit_scalar(
  '05_learning_readiness',
  'song_embedding_coverage',
  $SQL$
  SELECT jsonb_build_object(
    'songs_total', count(*),
    'available_songs', count(*) FILTER (WHERE COALESCE(is_available, true) = true),
    'with_embedding', count(*) FILTER (WHERE embedding IS NOT NULL),
    'available_with_embedding', count(*) FILTER (WHERE COALESCE(is_available, true) = true AND embedding IS NOT NULL),
    'coverage_ratio', round((count(*) FILTER (WHERE embedding IS NOT NULL))::numeric / GREATEST(count(*), 1), 4)
  )::text
  FROM songs
  $SQL$
);

SELECT pg_temp.audit_scalar(
  '05_learning_readiness',
  'user_model_coverage',
  $SQL$
  SELECT jsonb_build_object(
    'user_models_total', (SELECT count(*) FROM user_models),
    'user_models_with_embedding', (SELECT count(*) FROM user_models WHERE embedding IS NOT NULL),
    'taste_clusters_total', (SELECT count(*) FROM user_taste_clusters),
    'users_with_taste_clusters', (SELECT count(DISTINCT user_id) FROM user_taste_clusters),
    'active_7d_users', (SELECT count(DISTINCT user_id) FROM user_history WHERE last_played >= now() - interval '7 days'),
    'active_7d_users_without_model_embedding', (
      SELECT count(*)
      FROM (
        SELECT DISTINCT uh.user_id
        FROM user_history uh
        LEFT JOIN user_models um ON um.user_id = uh.user_id AND um.embedding IS NOT NULL
        WHERE uh.last_played >= now() - interval '7 days'
          AND um.user_id IS NULL
      ) q
    )
  )::text
  $SQL$
);

SELECT pg_temp.audit_scalar(
  '05_learning_readiness',
  'taste_link_coverage',
  $SQL$
  SELECT jsonb_build_object(
    'taste_links_total', (SELECT count(*) FROM user_taste_links),
    'users_with_links', (SELECT count(DISTINCT user_id) FROM user_taste_links),
    'active_7d_users_without_links', (
      SELECT count(*)
      FROM (
        SELECT DISTINCT uh.user_id
        FROM user_history uh
        LEFT JOIN user_taste_links utl ON utl.user_id = uh.user_id
        WHERE uh.last_played >= now() - interval '7 days'
          AND utl.user_id IS NULL
      ) q
    )
  )::text
  $SQL$
);

SELECT pg_temp.audit_scalar(
  '06_freshness',
  'last_updates',
  $SQL$
  SELECT jsonb_build_object(
    'raw_last_event_time', (SELECT max(event_time) FROM analytics_events_raw),
    'raw_last_ingest_time', (SELECT max(ingest_time) FROM analytics_events_raw),
    'interaction_last_event_time', (SELECT max(event_time) FROM user_interactions),
    'history_last_played', (SELECT max(last_played) FROM user_history),
    'user_model_last_updated', (SELECT max(last_updated) FROM user_models),
    'taste_cluster_last_updated', (SELECT max(updated_at) FROM user_taste_clusters),
    'taste_link_last_updated', (SELECT max(updated_at) FROM user_taste_links)
  )::text
  $SQL$
);

SELECT section, metric, value, details
FROM reco_event_audit
ORDER BY id;

ROLLBACK;
