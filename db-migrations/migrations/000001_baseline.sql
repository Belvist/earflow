-- ============================================================================
-- Earflow db-migrations baseline (canonical schema)
-- Generated from verified reconstruction of production schema (pg15, pgvector).
-- Provenance: db-migrations/legacy/ (bootstrap + service runners merged).
--
-- Intentionally EXCLUDED (confirmed dead legacy objects, keep out of baseline):
--   tables:    equalizer_presets, listening_history, user_song_likes
--   view:      playlist_songs (+ INSTEAD OF triggers playlist_songs_view_ins/del)
--   functions: cleanup_expired_sessions, refresh_recommendation_views
--   matview:   daily_interaction_summary
-- Cleanup of those objects on production is a separate draft migration
-- (000002_cleanup_legacy_prod.sql, NOT applied yet).
-- ============================================================================

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


--
-- Name: cleanup_expired_reco_sessions(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_expired_reco_sessions() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM recommendation_sessions WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;


--
-- Name: cleanup_expired_sessions(); Type: FUNCTION; Schema: public; Owner: -
--

--
-- Name: reco_apply_feedback_to_taste_clusters(integer, public.vector, real, integer, integer, real); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reco_apply_feedback_to_taste_clusters(p_user_id integer, p_track_embedding public.vector, p_alpha real, p_direction integer, p_max_clusters integer DEFAULT 5, p_new_cluster_dist_threshold real DEFAULT 0.25) RETURNS smallint
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_cluster_id smallint;
  v_existing_count int;
  v_min_dist real;
  v_candidate_id smallint;
BEGIN
  IF p_user_id IS NULL OR p_user_id <= 0 THEN
    RETURN NULL;
  END IF;
  IF p_track_embedding IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_alpha IS NULL OR p_alpha <= 0 OR p_alpha >= 1 THEN
    RETURN NULL;
  END IF;
  IF p_direction IS NULL OR (p_direction <> 1 AND p_direction <> -1) THEN
    RETURN NULL;
  END IF;

  INSERT INTO user_models (user_id, last_updated)
  VALUES (p_user_id, NOW())
  ON CONFLICT (user_id) DO NOTHING;

  PERFORM 1
  FROM user_models
  WHERE user_id = p_user_id
  FOR UPDATE;

  SELECT COUNT(*) INTO v_existing_count
  FROM user_taste_clusters
  WHERE user_id = p_user_id;

  IF v_existing_count = 0 THEN
    INSERT INTO user_taste_clusters (user_id, cluster_id, embedding, weight, updated_at)
    VALUES (p_user_id, 1, l2_normalize(p_track_embedding), 1, NOW())
    ON CONFLICT (user_id, cluster_id) DO NOTHING;

    v_cluster_id := 1;
  ELSE
    SELECT c.cluster_id, (c.embedding <=> p_track_embedding)::real
    INTO v_cluster_id, v_min_dist
    FROM user_taste_clusters c
    WHERE c.user_id = p_user_id
    ORDER BY c.embedding <=> p_track_embedding
    LIMIT 1
    FOR UPDATE;

    IF v_existing_count < LEAST(GREATEST(p_max_clusters, 1), 5) AND v_min_dist IS NOT NULL AND v_min_dist > p_new_cluster_dist_threshold THEN
      SELECT MIN(t.cid) INTO v_candidate_id
      FROM (
        SELECT generate_series(1, LEAST(GREATEST(p_max_clusters, 1), 5))::smallint AS cid
      ) t
      LEFT JOIN user_taste_clusters c
        ON c.user_id = p_user_id AND c.cluster_id = t.cid
      WHERE c.cluster_id IS NULL;

      IF v_candidate_id IS NOT NULL THEN
        INSERT INTO user_taste_clusters (user_id, cluster_id, embedding, weight, updated_at)
        VALUES (p_user_id, v_candidate_id, l2_normalize(p_track_embedding), 1, NOW())
        ON CONFLICT (user_id, cluster_id) DO NOTHING;

        v_cluster_id := v_candidate_id;
      END IF;
    END IF;
  END IF;

  UPDATE user_taste_clusters utc
  SET
    embedding = CASE
      WHEN p_direction = -1 THEN reco_repel_user_embedding(utc.embedding, p_track_embedding, p_alpha)
      ELSE reco_blend_user_embedding(utc.embedding, p_track_embedding, p_alpha)
    END,
    weight = (utc.weight * (1 - p_alpha) + 1.0 * p_alpha),
    updated_at = NOW()
  WHERE utc.user_id = p_user_id
    AND utc.cluster_id = v_cluster_id;

  UPDATE user_models um
  SET embedding = reco_user_embedding_from_clusters(p_user_id),
      last_updated = NOW()
  WHERE um.user_id = p_user_id;

  RETURN v_cluster_id;
END;
$$;


--
-- Name: reco_blend_user_embedding(public.vector, public.vector, real); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reco_blend_user_embedding(old_embedding public.vector, track_embedding public.vector, alpha real) RETURNS public.vector
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  SELECT CASE
    WHEN track_embedding IS NULL THEN old_embedding
    WHEN alpha <= 0 OR alpha >= 1 THEN old_embedding
    WHEN old_embedding IS NULL THEN l2_normalize(track_embedding)
    ELSE l2_normalize(
      reco_scale_vector(old_embedding, (1 - alpha)::real) +
      reco_scale_vector(track_embedding, alpha)
    )
  END;
$$;


--
-- Name: reco_clamp01(double precision); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reco_clamp01(v double precision) RETURNS double precision
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
  IF v IS NULL THEN
    RETURN 0.5;
  END IF;
  IF v < 0 THEN
    RETURN 0;
  END IF;
  IF v > 1 THEN
    RETURN 1;
  END IF;
  RETURN v;
END;
$$;


--
-- Name: reco_refresh_user_taste_links(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reco_refresh_user_taste_links(p_user_id integer, p_limit integer DEFAULT 50) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_limit int;
  v_updated int;
BEGIN
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);

  IF p_user_id IS NULL OR p_user_id <= 0 THEN
    RETURN 0;
  END IF;

  DELETE FROM user_taste_links
  WHERE user_id = p_user_id;

  WITH me AS (
    SELECT embedding
    FROM user_models
    WHERE user_id = p_user_id
      AND embedding IS NOT NULL
  ),
  neigh AS (
    SELECT um.user_id AS neighbor_user_id,
           (1.0 - (um.embedding <=> (SELECT embedding FROM me)))::real AS weight
    FROM me
    JOIN user_models um ON um.user_id <> p_user_id
    WHERE um.embedding IS NOT NULL
    ORDER BY um.embedding <=> (SELECT embedding FROM me)
    LIMIT v_limit
  )
  INSERT INTO user_taste_links (user_id, neighbor_user_id, weight, updated_at)
  SELECT p_user_id, n.neighbor_user_id, n.weight, NOW()
  FROM neigh n
  ON CONFLICT (user_id, neighbor_user_id)
  DO UPDATE SET
    weight = EXCLUDED.weight,
    updated_at = NOW();

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN COALESCE(v_updated, 0);
END;
$$;


--
-- Name: reco_repel_user_embedding(public.vector, public.vector, real); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reco_repel_user_embedding(old_embedding public.vector, track_embedding public.vector, alpha real) RETURNS public.vector
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  SELECT CASE
    WHEN track_embedding IS NULL THEN old_embedding
    WHEN alpha <= 0 OR alpha >= 1 THEN old_embedding
    WHEN old_embedding IS NULL THEN old_embedding
    WHEN vector_norm(old_embedding - reco_scale_vector(track_embedding, alpha)) > 0 THEN
      l2_normalize(old_embedding - reco_scale_vector(track_embedding, alpha))
    ELSE old_embedding
  END;
$$;


--
-- Name: reco_scale_vector(public.vector, real); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reco_scale_vector(v public.vector, s real) RETURNS public.vector
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    AS $$
  SELECT array_to_vector(
    ARRAY(
      SELECT (x * s)::real
      FROM unnest(v::real[]) WITH ORDINALITY AS t(x, ord)
      ORDER BY ord
    ),
    vector_dims(v),
    true
  );
$$;


--
-- Name: reco_song_embedding(double precision, double precision, double precision, double precision, double precision, double precision, double precision, double precision); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reco_song_embedding(tempo double precision, energy double precision, valence double precision, danceability double precision, acousticness double precision, instrumentalness double precision, liveness double precision, speechiness double precision) RETURNS public.vector
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
  v vector(8);
BEGIN
  v := (
    '[' ||
    reco_tempo_norm(tempo) || ',' ||
    reco_clamp01(energy) || ',' ||
    reco_clamp01(valence) || ',' ||
    reco_clamp01(danceability) || ',' ||
    reco_clamp01(acousticness) || ',' ||
    reco_clamp01(instrumentalness) || ',' ||
    reco_clamp01(liveness) || ',' ||
    reco_clamp01(speechiness) ||
    ']'
  )::vector(8);
  RETURN v;
END;
$$;


--
-- Name: reco_song_features_sync_embedding(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reco_song_features_sync_embedding() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE songs
  SET embedding = reco_song_embedding(
    NEW.tempo,
    NEW.energy,
    NEW.valence,
    NEW.danceability,
    NEW.acousticness,
    NEW.instrumentalness,
    NEW.liveness,
    NEW.speechiness
  )
  WHERE id = NEW.song_id;

  RETURN NEW;
END;
$$;


--
-- Name: reco_tempo_norm(double precision); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reco_tempo_norm(tempo double precision) RETURNS double precision
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
  t double precision;
BEGIN
  t := COALESCE(tempo, 120);
  -- clamp tempo to [50..200] then map to [0..1]
  IF t < 50 THEN t := 50; END IF;
  IF t > 200 THEN t := 200; END IF;
  RETURN (t - 50) / 150;
END;
$$;


--
-- Name: reco_user_embedding_from_clusters(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reco_user_embedding_from_clusters(p_user_id integer) RETURNS public.vector
    LANGUAGE sql STABLE PARALLEL SAFE
    AS $$
  WITH c AS (
    SELECT embedding, weight
    FROM user_taste_clusters
    WHERE user_id = p_user_id
  ),
  s AS (
    SELECT
      sum(reco_scale_vector(embedding, weight)) AS sum_vec,
      sum(weight)::real AS sum_w
    FROM c
  )
  SELECT CASE
    WHEN (SELECT sum_w FROM s) IS NULL OR (SELECT sum_w FROM s) <= 0 THEN NULL
    WHEN (SELECT sum_vec FROM s) IS NULL THEN NULL
    ELSE l2_normalize(reco_scale_vector((SELECT sum_vec FROM s), (1.0::real / (SELECT sum_w FROM s))))
  END;
$$;


--
-- Name: refresh_recommendation_views(); Type: FUNCTION; Schema: public; Owner: -
--

--
-- Name: refresh_song_mood_scores(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_song_mood_scores(p_song_id integer DEFAULT NULL::integer) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  affected_rows INTEGER := 0;
BEGIN
  INSERT INTO song_mood_scores (
    song_id,
    score_workout,
    score_focus,
    score_chill,
    score_party,
    score_happy,
    score_sad,
    score_sleep,
    updated_at
  )
  SELECT
    s.id,
    -(1.6*power(f.energy - 0.86, 2) + 1.1*power(LEAST(1, GREATEST(0, (f.tempo - 60) / 140)) - 0.78, 2) + 1.0*power(f.danceability - 0.62, 2) + 0.6*power(f.valence - 0.55, 2) + 0.3*power(f.speechiness - 0.15, 2)) AS score_workout,
    -(1.6*power(f.speechiness - 0.08, 2) + 1.1*power(f.energy - 0.55, 2) + 0.9*power(LEAST(1, GREATEST(0, (f.tempo - 60) / 140)) - 0.45, 2) + 0.6*power(f.danceability - 0.45, 2) + 0.4*power(f.valence - 0.5, 2)) AS score_focus,
    -(1.5*power(f.energy - 0.35, 2) + 1.1*power(LEAST(1, GREATEST(0, (f.tempo - 60) / 140)) - 0.35, 2) + 0.9*power(f.valence - 0.55, 2) + 0.6*power(f.danceability - 0.5, 2) + 0.4*power(f.speechiness - 0.12, 2)) AS score_chill,
    -(1.4*power(f.danceability - 0.78, 2) + 1.2*power(f.energy - 0.82, 2) + 0.9*power(LEAST(1, GREATEST(0, (f.tempo - 60) / 140)) - 0.72, 2) + 0.8*power(f.valence - 0.7, 2) + 0.4*power(f.speechiness - 0.2, 2)) AS score_party,
    -(1.6*power(f.valence - 0.86, 2) + 1.2*power(f.energy - 0.7, 2) + 0.9*power(f.danceability - 0.62, 2) + 0.7*power(LEAST(1, GREATEST(0, (f.tempo - 60) / 140)) - 0.62, 2) + 0.4*power(f.speechiness - 0.18, 2)) AS score_happy,
    -(1.7*power(f.valence - 0.18, 2) + 1.1*power(f.energy - 0.35, 2) + 0.7*power(LEAST(1, GREATEST(0, (f.tempo - 60) / 140)) - 0.38, 2) + 0.6*power(f.danceability - 0.4, 2) + 0.4*power(f.speechiness - 0.16, 2)) AS score_sad,
    -(1.8*power(f.energy - 0.2, 2) + 1.3*power(LEAST(1, GREATEST(0, (f.tempo - 60) / 140)) - 0.22, 2) + 0.9*power(f.speechiness - 0.06, 2) + 0.6*power(f.valence - 0.4, 2) + 0.5*power(f.danceability - 0.25, 2)) AS score_sleep,
    NOW()
  FROM songs s
  JOIN song_features f ON f.song_id = s.id
  WHERE (p_song_id IS NULL OR s.id = p_song_id)
    AND f.energy IS NOT NULL
    AND f.valence IS NOT NULL
    AND f.danceability IS NOT NULL
    AND f.speechiness IS NOT NULL
    AND f.tempo IS NOT NULL
  ON CONFLICT (song_id) DO UPDATE SET
    score_workout = EXCLUDED.score_workout,
    score_focus = EXCLUDED.score_focus,
    score_chill = EXCLUDED.score_chill,
    score_party = EXCLUDED.score_party,
    score_happy = EXCLUDED.score_happy,
    score_sad = EXCLUDED.score_sad,
    score_sleep = EXCLUDED.score_sleep,
    updated_at = EXCLUDED.updated_at;

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RETURN affected_rows;
END;
$$;


--
-- Name: refresh_statistics_cache(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_statistics_cache() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  affected_rows INTEGER := 0;
BEGIN
  TRUNCATE TABLE statistics_cache;

  INSERT INTO statistics_cache (entity_type, uploader_id, entity_value, track_count, updated_at)
  SELECT
    'genre'::text,
    s.uploader_id,
    s.genre_norm,
    COUNT(*)::int,
    NOW()
  FROM songs s
  WHERE s.uploader_id IS NOT NULL
    AND s.genre_norm IS NOT NULL
    AND length(trim(s.genre_norm)) > 0
    AND COALESCE(s.is_available, true) = true
  GROUP BY s.uploader_id, s.genre_norm;

  INSERT INTO statistics_cache (entity_type, uploader_id, entity_value, track_count, updated_at)
  SELECT
    'artist'::text,
    s.uploader_id,
    s.artist_norm,
    COUNT(*)::int,
    NOW()
  FROM songs s
  WHERE s.uploader_id IS NOT NULL
    AND s.artist_norm IS NOT NULL
    AND length(trim(s.artist_norm)) > 0
    AND COALESCE(s.is_available, true) = true
  GROUP BY s.uploader_id, s.artist_norm;

  INSERT INTO statistics_cache (entity_type, uploader_id, entity_value, track_count, updated_at)
  SELECT
    'year'::text,
    s.uploader_id,
    s.year::text,
    COUNT(*)::int,
    NOW()
  FROM songs s
  WHERE s.uploader_id IS NOT NULL
    AND s.year IS NOT NULL
    AND s.year > 0
    AND COALESCE(s.is_available, true) = true
  GROUP BY s.uploader_id, s.year;

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RETURN affected_rows;
END;
$$;


--
-- Name: search_enqueue(text, bigint, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_enqueue(_entity_type text, _entity_id bigint, _op text, _hints jsonb) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO search_outbox_queue(entity_type, entity_id, op, hints, next_attempt_at, updated_at)
  VALUES (_entity_type, _entity_id, _op, _hints, NOW(), NOW())
  ON CONFLICT (entity_type, entity_id)
  DO UPDATE SET
    op = EXCLUDED.op,
    hints = COALESCE(EXCLUDED.hints, search_outbox_queue.hints),
    next_attempt_at = NOW(),
    updated_at = NOW();
END;
$$;


--
-- Name: search_outbox_album_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_outbox_album_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM search_enqueue('album', NEW.id, 'upsert', NULL);
  RETURN NEW;
END;
$$;


--
-- Name: search_outbox_artist_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_outbox_artist_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM search_enqueue('artist', NEW.id, 'upsert', NULL);
  RETURN NEW;
END;
$$;


--
-- Name: search_outbox_song_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_outbox_song_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  _hints JSONB;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    PERFORM search_enqueue('song', OLD.id, 'delete', NULL);
    RETURN OLD;
  END IF;

  _hints := NULL;
  IF (TG_OP = 'UPDATE') THEN
    IF (COALESCE(OLD.artist, '') <> COALESCE(NEW.artist, '')) OR (COALESCE(OLD.album, '') <> COALESCE(NEW.album, '')) THEN
      _hints := jsonb_build_object('prev_artist', OLD.artist, 'prev_album', OLD.album);
    END IF;
  END IF;

  PERFORM search_enqueue('song', NEW.id, 'upsert', _hints);
  RETURN NEW;
END;
$$;


--
-- Name: songs_set_norm_cols(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.songs_set_norm_cols() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.genre IS NULL THEN
    NEW.genre_norm := NULL;
  ELSE
    NEW.genre_norm := lower(trim(NEW.genre));
  END IF;

  IF NEW.artist IS NULL THEN
    NEW.artist_norm := NULL;
  ELSE
    NEW.artist_norm := lower(trim(NEW.artist));
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: trg_refresh_song_mood_scores(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_refresh_song_mood_scores() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM refresh_song_mood_scores(NEW.song_id);
  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: albums; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.albums (
    id integer NOT NULL,
    public_id text DEFAULT encode(public.gen_random_bytes(16), 'hex'::text) NOT NULL,
    artist_id integer NOT NULL,
    name character varying(255) NOT NULL,
    name_key character varying(255) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: albums_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.albums_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: albums_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.albums_id_seq OWNED BY public.albums.id;


--
-- Name: analytics_events_raw; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_events_raw (
    event_id text NOT NULL,
    schema_version integer DEFAULT 1 NOT NULL,
    event_time timestamp with time zone NOT NULL,
    ingest_time timestamp with time zone DEFAULT now() NOT NULL,
    user_id integer NOT NULL,
    session_id text,
    playback_session_id text,
    track_id integer NOT NULL,
    action text NOT NULL,
    duration_ms integer DEFAULT 0 NOT NULL,
    progress numeric(4,3),
    context jsonb,
    metadata jsonb
);


--
-- Name: artist_account_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artist_account_members (
    id integer NOT NULL,
    account_id integer NOT NULL,
    user_id integer NOT NULL,
    role character varying(32) DEFAULT 'owner'::character varying NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    revoked_at timestamp without time zone
);


--
-- Name: artist_account_members_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.artist_account_members_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: artist_account_members_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.artist_account_members_id_seq OWNED BY public.artist_account_members.id;


--
-- Name: artist_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artist_accounts (
    id integer NOT NULL,
    artist_id integer NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: artist_accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.artist_accounts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: artist_accounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.artist_accounts_id_seq OWNED BY public.artist_accounts.id;


--
-- Name: artist_claim_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artist_claim_requests (
    id integer NOT NULL,
    artist_id integer NOT NULL,
    user_id integer NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    note text,
    review_reason text,
    reviewed_by_user_id integer,
    reviewed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: artist_claim_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.artist_claim_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: artist_claim_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.artist_claim_requests_id_seq OWNED BY public.artist_claim_requests.id;


--
-- Name: artist_ownerships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artist_ownerships (
    id integer NOT NULL,
    artist_id integer NOT NULL,
    user_id integer NOT NULL,
    role character varying(32) DEFAULT 'owner'::character varying NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    revoked_at timestamp without time zone
);


--
-- Name: artist_ownerships_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.artist_ownerships_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: artist_ownerships_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.artist_ownerships_id_seq OWNED BY public.artist_ownerships.id;


--
-- Name: artist_trends; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artist_trends (
    id integer NOT NULL,
    artist_name character varying(255) NOT NULL,
    play_count integer DEFAULT 0,
    trend_score double precision DEFAULT 0,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: artist_trends_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.artist_trends_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: artist_trends_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.artist_trends_id_seq OWNED BY public.artist_trends.id;


--
-- Name: artist_uploaders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artist_uploaders (
    user_id integer NOT NULL,
    artist_name character varying(255) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: artists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artists (
    id integer NOT NULL,
    public_id text DEFAULT encode(public.gen_random_bytes(16), 'hex'::text) NOT NULL,
    name character varying(255) NOT NULL,
    name_key character varying(255) NOT NULL,
    created_by_user_id integer,
    is_verified boolean DEFAULT false NOT NULL,
    hero_cover_path text,
    bio text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    country character varying(100),
    mbid character varying(36),
    popular boolean DEFAULT false NOT NULL,
    avatar_cover_path text,
    banner_cover_path text
);


--
-- Name: artists_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.artists_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: artists_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.artists_id_seq OWNED BY public.artists.id;


--
-- Name: auth_devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_devices (
    auth_device_id text NOT NULL,
    sid text NOT NULL,
    user_id bigint NOT NULL,
    public_key_spki text NOT NULL,
    device_epoch bigint DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    user_agent text,
    CONSTRAINT auth_devices_device_epoch_check CHECK ((device_epoch >= 1)),
    CONSTRAINT auth_devices_id_len CHECK (((char_length(auth_device_id) >= 20) AND (char_length(auth_device_id) <= 128)))
);


--
-- Name: TABLE auth_devices; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.auth_devices IS 'SoT PoP device keys bound to sid.';


--
-- Name: auth_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_sessions (
    sid text NOT NULL,
    user_id bigint NOT NULL,
    refresh_jti text,
    session_epoch bigint DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    ip inet,
    user_agent text,
    CONSTRAINT auth_sessions_session_epoch_check CHECK ((session_epoch >= 1)),
    CONSTRAINT auth_sessions_sid_len CHECK (((char_length(sid) >= 20) AND (char_length(sid) <= 128)))
);


--
-- Name: TABLE auth_sessions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.auth_sessions IS 'SoT browser session (sid). Redis mp:sess is cache; epoch for PEND-SEC-012.';


--
-- Name: user_interactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_interactions (
    id integer NOT NULL,
    user_id integer,
    song_id integer,
    interaction_type character varying(50) NOT NULL,
    metadata jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    "timestamp" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    session_id text,
    duration_ms integer DEFAULT 0,
    progress numeric(4,3),
    event_id text,
    playback_session_id text,
    event_time timestamp with time zone
);


--
-- Name: dislikes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dislikes (
    id integer NOT NULL,
    user_id integer NOT NULL,
    song_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: dislikes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dislikes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dislikes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dislikes_id_seq OWNED BY public.dislikes.id;


--
-- Name: genre_popularity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.genre_popularity (
    id integer NOT NULL,
    genre_name character varying(100) NOT NULL,
    popularity_score double precision DEFAULT 0,
    trend_score double precision DEFAULT 0,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: genre_popularity_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.genre_popularity_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: genre_popularity_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.genre_popularity_id_seq OWNED BY public.genre_popularity.id;


--
-- Name: genres; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.genres (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: genres_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.genres_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: genres_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.genres_id_seq OWNED BY public.genres.id;


--
-- Name: likes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.likes (
    id integer NOT NULL,
    user_id integer NOT NULL,
    song_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: likes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.likes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: likes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.likes_id_seq OWNED BY public.likes.id;


--
-- Name: listens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listens (
    id integer NOT NULL,
    user_id integer NOT NULL,
    song_id integer NOT NULL,
    listened_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: listens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.listens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: listens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.listens_id_seq OWNED BY public.listens.id;


--
-- Name: lyrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lyrics (
    id integer NOT NULL,
    song_id integer NOT NULL,
    language character varying(5) DEFAULT 'ru'::character varying,
    plain_text text,
    synced_lines jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by integer,
    updated_by integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    source character varying(32),
    external_provider character varying(32),
    external_id text,
    external_fetched_at timestamp with time zone
);


--
-- Name: lyrics_external_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lyrics_external_cache (
    song_id integer NOT NULL,
    provider character varying(32) NOT NULL,
    status character varying(16) NOT NULL,
    last_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    retry_after_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: lyrics_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.lyrics_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: lyrics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.lyrics_id_seq OWNED BY public.lyrics.id;


--
-- Name: lyrics_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lyrics_reports (
    id integer NOT NULL,
    song_id integer NOT NULL,
    user_id integer NOT NULL,
    reason text NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    resolved_at timestamp with time zone
);


--
-- Name: lyrics_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.lyrics_reports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: lyrics_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.lyrics_reports_id_seq OWNED BY public.lyrics_reports.id;


--
-- Name: playlist_tracks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.playlist_tracks (
    id integer NOT NULL,
    playlist_id integer NOT NULL,
    song_id integer NOT NULL,
    "position" integer NOT NULL,
    added_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    added_by integer
);


--
-- Name: playlist_tracks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.playlist_tracks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: playlist_tracks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.playlist_tracks_id_seq OWNED BY public.playlist_tracks.id;


--
-- Name: playlists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.playlists (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    user_id integer,
    is_public boolean DEFAULT false,
    cover_url character varying(500),
    cover_path text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    share_slug character varying(64),
    is_smart boolean DEFAULT false,
    smart_rules jsonb,
    track_count integer DEFAULT 0,
    total_duration integer DEFAULT 0,
    play_count integer DEFAULT 0
);


--
-- Name: playlists_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.playlists_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: playlists_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.playlists_id_seq OWNED BY public.playlists.id;


--
-- Name: queue_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.queue_state (
    user_id integer NOT NULL,
    current_index integer DEFAULT 0,
    shuffle_enabled boolean DEFAULT false,
    shuffle_order jsonb,
    repeat_mode character varying(10) DEFAULT 'off'::character varying,
    source_type character varying(50),
    source_id integer,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: reco_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reco_migrations (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    applied_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: reco_migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reco_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reco_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reco_migrations_id_seq OWNED BY public.reco_migrations.id;


--
-- Name: recommendation_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recommendation_sessions (
    id text NOT NULL,
    session_id character varying(255) NOT NULL,
    user_id integer,
    source character varying(50) DEFAULT 'global'::character varying NOT NULL,
    preferences jsonb,
    tracks_served integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    last_accessed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamp without time zone
);


--
-- Name: recommendation_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.recommendation_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: recommendation_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.recommendation_sessions_id_seq OWNED BY public.recommendation_sessions.id;


--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refresh_tokens (
    jti text NOT NULL,
    sid text NOT NULL,
    user_id bigint NOT NULL,
    session_epoch bigint DEFAULT 1 NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT refresh_tokens_session_epoch_check CHECK ((session_epoch >= 1))
);


--
-- Name: TABLE refresh_tokens; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.refresh_tokens IS 'SoT refresh rotation by jti.';


--
-- Name: search_outbox_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.search_outbox_queue (
    entity_type text NOT NULL,
    entity_id bigint NOT NULL,
    op text NOT NULL,
    hints jsonb,
    attempts integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    locked_at timestamp with time zone,
    locked_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: security_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.security_events (
    id bigint NOT NULL,
    user_id bigint,
    sid text,
    auth_device_id text,
    event_type text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE security_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.security_events IS 'Append-only audit trail (login, revoke, proof failures).';


--
-- Name: security_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.security_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: security_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.security_events_id_seq OWNED BY public.security_events.id;


--
-- Name: service_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_sessions (
    id integer NOT NULL,
    service_name character varying(100) NOT NULL,
    token_hash character varying(255) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamp without time zone NOT NULL,
    last_used timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: service_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.service_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: service_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.service_sessions_id_seq OWNED BY public.service_sessions.id;


--
-- Name: social_post_likes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.social_post_likes (
    post_id bigint NOT NULL,
    user_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: social_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.social_posts (
    id bigint NOT NULL,
    user_id integer NOT NULL,
    title text,
    body text NOT NULL,
    kind character varying(24) DEFAULT 'text'::character varying NOT NULL,
    visibility character varying(24) DEFAULT 'public'::character varying NOT NULL,
    status character varying(24) DEFAULT 'active'::character varying NOT NULL,
    likes_count integer DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    CONSTRAINT social_posts_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 2000))),
    CONSTRAINT social_posts_kind_check CHECK (((kind)::text = 'text'::text)),
    CONSTRAINT social_posts_likes_count_check CHECK ((likes_count >= 0)),
    CONSTRAINT social_posts_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'deleted'::character varying])::text[]))),
    CONSTRAINT social_posts_title_check CHECK (((title IS NULL) OR (char_length(title) <= 120))),
    CONSTRAINT social_posts_visibility_check CHECK (((visibility)::text = 'public'::text))
);


--
-- Name: social_posts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.social_posts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: social_posts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.social_posts_id_seq OWNED BY public.social_posts.id;


--
-- Name: song_features; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.song_features (
    id integer NOT NULL,
    song_id integer,
    tempo double precision,
    energy double precision,
    valence double precision,
    danceability double precision,
    acousticness double precision,
    instrumentalness double precision,
    liveness double precision,
    speechiness double precision,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: song_features_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.song_features_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: song_features_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.song_features_id_seq OWNED BY public.song_features.id;


--
-- Name: song_genres; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.song_genres (
    id integer NOT NULL,
    song_id integer,
    genre_id integer
);


--
-- Name: song_genres_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.song_genres_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: song_genres_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.song_genres_id_seq OWNED BY public.song_genres.id;


--
-- Name: song_mood_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.song_mood_scores (
    song_id integer NOT NULL,
    score_workout double precision,
    score_focus double precision,
    score_chill double precision,
    score_party double precision,
    score_happy double precision,
    score_sad double precision,
    score_sleep double precision,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: song_moods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.song_moods (
    id integer NOT NULL,
    song_id integer NOT NULL,
    mood character varying(64) NOT NULL,
    confidence real DEFAULT 0.5 NOT NULL,
    source character varying(32) DEFAULT 'auto'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT song_moods_confidence_check CHECK (((confidence >= (0)::double precision) AND (confidence <= (1)::double precision)))
);


--
-- Name: song_moods_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.song_moods_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: song_moods_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.song_moods_id_seq OWNED BY public.song_moods.id;


--
-- Name: songs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.songs (
    id integer NOT NULL,
    title character varying(255) NOT NULL,
    artist character varying(255) NOT NULL,
    album character varying(255),
    duration integer,
    genre character varying(100),
    year integer,
    release_date date,
    file_path character varying(500) NOT NULL,
    audio_url character varying(500),
    cover character varying(500),
    cover_path text,
    file_size bigint,
    mime_type character varying(100),
    file_hash character varying(64),
    uploader_id integer,
    popularity integer DEFAULT 0,
    play_count integer DEFAULT 0,
    is_available boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    has_ebap boolean DEFAULT false NOT NULL,
    ebap_status character varying(20) DEFAULT 'none'::character varying NOT NULL,
    ebap_error text,
    has_hls boolean DEFAULT false NOT NULL,
    hls_status character varying(20) DEFAULT 'none'::character varying NOT NULL,
    hls_error text,
    transcode_status character varying(20) DEFAULT 'none'::character varying NOT NULL,
    transcode_error text,
    quality_variants jsonb,
    metadata_parse_status character varying(20) DEFAULT 'none'::character varying NOT NULL,
    metadata_parse_error text,
    parsed_metadata jsonb,
    waveform_peaks jsonb,
    waveform_bars integer,
    waveform_status character varying(20) DEFAULT 'none'::character varying NOT NULL,
    waveform_error text,
    public_id text DEFAULT encode(public.gen_random_bytes(8), 'hex'::text),
    bpm integer,
    key character varying(10),
    mood character varying(50),
    energy numeric(3,2),
    danceability numeric(3,2),
    embedding public.vector(8),
    genre_norm text,
    artist_norm text,
    CONSTRAINT songs_danceability_range CHECK (((danceability IS NULL) OR ((danceability >= (0)::numeric) AND (danceability <= (1)::numeric)))),
    CONSTRAINT songs_energy_range CHECK (((energy IS NULL) OR ((energy >= (0)::numeric) AND (energy <= (1)::numeric))))
);


--
-- Name: COLUMN songs.public_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.songs.public_id IS 'Opaque public identifier for Earflow share URLs — replaces numeric DB id in external paths.';


--
-- Name: songs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.songs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: songs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.songs_id_seq OWNED BY public.songs.id;


--
-- Name: statistics_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.statistics_cache (
    entity_type text NOT NULL,
    uploader_id integer NOT NULL,
    entity_value text NOT NULL,
    track_count integer NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: subscription_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_plans (
    id integer NOT NULL,
    slug character varying(64) NOT NULL,
    name character varying(128) NOT NULL,
    price_cents integer NOT NULL,
    currency character(3) DEFAULT 'RUB'::bpchar NOT NULL,
    "interval" character varying(16) DEFAULT 'month'::character varying NOT NULL,
    features jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subscription_plans_price_cents_check CHECK ((price_cents >= 0))
);


--
-- Name: subscription_plans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.subscription_plans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: subscription_plans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.subscription_plans_id_seq OWNED BY public.subscription_plans.id;


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    plan_id integer NOT NULL,
    status character varying(32) DEFAULT 'active'::character varying NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    cancelled_at timestamp with time zone,
    provider character varying(32),
    provider_id character varying(256),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.subscriptions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: subscriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.subscriptions_id_seq OWNED BY public.subscriptions.id;


--
-- Name: user_daily_recommendations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_daily_recommendations (
    user_id integer NOT NULL,
    song_id integer NOT NULL,
    rank integer NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: user_eq_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_eq_settings (
    id integer NOT NULL,
    user_id integer NOT NULL,
    enabled boolean DEFAULT false,
    gains jsonb DEFAULT '[0, 0, 0, 0, 0, 0, 0, 0, 0, 0]'::jsonb,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: user_eq_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_eq_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_eq_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_eq_settings_id_seq OWNED BY public.user_eq_settings.id;


--
-- Name: user_genre_playback_prefs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_genre_playback_prefs (
    user_id integer NOT NULL,
    genre text NOT NULL,
    playback_rate real NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_genre_playback_genre_len_chk CHECK (((char_length(genre) > 0) AND (char_length(genre) <= 100))),
    CONSTRAINT user_genre_playback_rate_range_chk CHECK (((playback_rate >= (0.5)::double precision) AND (playback_rate <= (2.0)::double precision)))
);


--
-- Name: user_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_history (
    id integer NOT NULL,
    user_id integer,
    song_id integer,
    play_count integer DEFAULT 1,
    liked boolean DEFAULT false,
    last_played timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    total_play_time integer DEFAULT 0,
    skip_count integer DEFAULT 0,
    first_played timestamp with time zone DEFAULT now()
);


--
-- Name: user_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_history_id_seq OWNED BY public.user_history.id;


--
-- Name: user_interactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_interactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_interactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_interactions_id_seq OWNED BY public.user_interactions.id;


--
-- Name: user_models; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_models (
    id integer NOT NULL,
    user_id integer,
    behavior_vector double precision[],
    preferences jsonb,
    last_updated timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    embedding public.vector(8)
);


--
-- Name: user_models_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_models_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_models_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_models_id_seq OWNED BY public.user_models.id;


--
-- Name: user_mood_profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_mood_profile (
    id integer NOT NULL,
    user_id integer NOT NULL,
    mood_vector jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_mood_profile_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_mood_profile_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_mood_profile_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_mood_profile_id_seq OWNED BY public.user_mood_profile.id;


--
-- Name: user_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_preferences (
    id integer NOT NULL,
    user_id integer,
    favorite_genres jsonb DEFAULT '{}'::jsonb,
    favorite_artists jsonb DEFAULT '{}'::jsonb,
    listening_patterns jsonb DEFAULT '{}'::jsonb,
    computed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: user_preferences_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_preferences_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_preferences_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_preferences_id_seq OWNED BY public.user_preferences.id;


--
-- Name: user_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_queue (
    id integer NOT NULL,
    user_id integer NOT NULL,
    song_id integer NOT NULL,
    "position" integer NOT NULL,
    source_type character varying(50) DEFAULT 'manual'::character varying,
    source_id integer,
    added_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: user_queue_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_queue_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_queue_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_queue_id_seq OWNED BY public.user_queue.id;


--
-- Name: user_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_settings (
    id integer NOT NULL,
    user_id integer NOT NULL,
    display_name character varying(255),
    audio_quality character varying(20) DEFAULT 'auto'::character varying,
    autoplay_enabled boolean DEFAULT true,
    crossfade_seconds integer DEFAULT 0,
    normalize_volume boolean DEFAULT false,
    theme character varying(20) DEFAULT 'dark'::character varying,
    show_lyrics boolean DEFAULT true,
    listening_history_enabled boolean DEFAULT true,
    show_activity boolean DEFAULT true,
    notifications_enabled boolean DEFAULT true,
    listener_ui jsonb DEFAULT '{"v": 1, "updatedAt": 0, "miniPlayStyle": "adaptive", "miniBarVariant": "floating"}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT user_settings_audio_quality_check CHECK (((audio_quality)::text = ANY ((ARRAY['auto'::character varying, 'low'::character varying, 'medium'::character varying, 'high'::character varying, 'lossless'::character varying])::text[]))),
    CONSTRAINT user_settings_crossfade_seconds_check CHECK (((crossfade_seconds >= 0) AND (crossfade_seconds <= 12))),
    CONSTRAINT user_settings_theme_check CHECK (((theme)::text = ANY ((ARRAY['dark'::character varying, 'light'::character varying, 'system'::character varying])::text[])))
);


--
-- Name: COLUMN user_settings.listener_ui; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_settings.listener_ui IS 'Earflow listener chrome prefs (schema v1): miniBarVariant, miniPlayStyle, updatedAt';


--
-- Name: user_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_settings_id_seq OWNED BY public.user_settings.id;


--
-- Name: user_taste_clusters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_taste_clusters (
    user_id integer NOT NULL,
    cluster_id smallint NOT NULL,
    embedding public.vector(8) NOT NULL,
    weight real DEFAULT 1 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_taste_clusters_cluster_id_chk CHECK (((cluster_id >= 1) AND (cluster_id <= 5))),
    CONSTRAINT user_taste_clusters_weight_chk CHECK ((weight > (0)::double precision))
);


--
-- Name: user_taste_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_taste_links (
    user_id integer NOT NULL,
    neighbor_user_id integer NOT NULL,
    weight real DEFAULT 0 NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    email character varying(255),
    email_hash text,
    username character varying(255) NOT NULL,
    password_hash character varying(255),
    first_name character varying(255),
    last_name character varying(255),
    avatar_url character varying(500),
    is_premium boolean DEFAULT false,
    is_admin boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    photo_url character varying(500),
    last_login timestamp without time zone,
    salt character varying(255),
    email_encrypted text,
    metadata text,
    telegram_id bigint,
    mfa_enabled boolean DEFAULT false NOT NULL,
    mfa_secret_encrypted text,
    mfa_recovery_codes text,
    mfa_enabled_at timestamp without time zone
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: albums id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.albums ALTER COLUMN id SET DEFAULT nextval('public.albums_id_seq'::regclass);


--
-- Name: artist_account_members id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_account_members ALTER COLUMN id SET DEFAULT nextval('public.artist_account_members_id_seq'::regclass);


--
-- Name: artist_accounts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_accounts ALTER COLUMN id SET DEFAULT nextval('public.artist_accounts_id_seq'::regclass);


--
-- Name: artist_claim_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_claim_requests ALTER COLUMN id SET DEFAULT nextval('public.artist_claim_requests_id_seq'::regclass);


--
-- Name: artist_ownerships id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_ownerships ALTER COLUMN id SET DEFAULT nextval('public.artist_ownerships_id_seq'::regclass);


--
-- Name: artist_trends id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_trends ALTER COLUMN id SET DEFAULT nextval('public.artist_trends_id_seq'::regclass);


--
-- Name: artists id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artists ALTER COLUMN id SET DEFAULT nextval('public.artists_id_seq'::regclass);


--
-- Name: dislikes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dislikes ALTER COLUMN id SET DEFAULT nextval('public.dislikes_id_seq'::regclass);


--
-- Name: genre_popularity id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genre_popularity ALTER COLUMN id SET DEFAULT nextval('public.genre_popularity_id_seq'::regclass);


--
-- Name: genres id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genres ALTER COLUMN id SET DEFAULT nextval('public.genres_id_seq'::regclass);


--
-- Name: likes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.likes ALTER COLUMN id SET DEFAULT nextval('public.likes_id_seq'::regclass);


--
-- Name: listens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listens ALTER COLUMN id SET DEFAULT nextval('public.listens_id_seq'::regclass);


--
-- Name: lyrics id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lyrics ALTER COLUMN id SET DEFAULT nextval('public.lyrics_id_seq'::regclass);


--
-- Name: lyrics_reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lyrics_reports ALTER COLUMN id SET DEFAULT nextval('public.lyrics_reports_id_seq'::regclass);


--
-- Name: playlist_tracks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playlist_tracks ALTER COLUMN id SET DEFAULT nextval('public.playlist_tracks_id_seq'::regclass);


--
-- Name: playlists id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playlists ALTER COLUMN id SET DEFAULT nextval('public.playlists_id_seq'::regclass);


--
-- Name: reco_migrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reco_migrations ALTER COLUMN id SET DEFAULT nextval('public.reco_migrations_id_seq'::regclass);


--
-- Name: recommendation_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_sessions ALTER COLUMN id SET DEFAULT nextval('public.recommendation_sessions_id_seq'::regclass);


--
-- Name: security_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_events ALTER COLUMN id SET DEFAULT nextval('public.security_events_id_seq'::regclass);


--
-- Name: service_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_sessions ALTER COLUMN id SET DEFAULT nextval('public.service_sessions_id_seq'::regclass);


--
-- Name: social_posts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_posts ALTER COLUMN id SET DEFAULT nextval('public.social_posts_id_seq'::regclass);


--
-- Name: song_features id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.song_features ALTER COLUMN id SET DEFAULT nextval('public.song_features_id_seq'::regclass);


--
-- Name: song_genres id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.song_genres ALTER COLUMN id SET DEFAULT nextval('public.song_genres_id_seq'::regclass);


--
-- Name: song_moods id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.song_moods ALTER COLUMN id SET DEFAULT nextval('public.song_moods_id_seq'::regclass);


--
-- Name: songs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.songs ALTER COLUMN id SET DEFAULT nextval('public.songs_id_seq'::regclass);


--
-- Name: subscription_plans id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_plans ALTER COLUMN id SET DEFAULT nextval('public.subscription_plans_id_seq'::regclass);


--
-- Name: subscriptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions ALTER COLUMN id SET DEFAULT nextval('public.subscriptions_id_seq'::regclass);


--
-- Name: user_eq_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_eq_settings ALTER COLUMN id SET DEFAULT nextval('public.user_eq_settings_id_seq'::regclass);


--
-- Name: user_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_history ALTER COLUMN id SET DEFAULT nextval('public.user_history_id_seq'::regclass);


--
-- Name: user_interactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_interactions ALTER COLUMN id SET DEFAULT nextval('public.user_interactions_id_seq'::regclass);


--
-- Name: user_models id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_models ALTER COLUMN id SET DEFAULT nextval('public.user_models_id_seq'::regclass);


--
-- Name: user_mood_profile id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_mood_profile ALTER COLUMN id SET DEFAULT nextval('public.user_mood_profile_id_seq'::regclass);


--
-- Name: user_preferences id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_preferences ALTER COLUMN id SET DEFAULT nextval('public.user_preferences_id_seq'::regclass);


--
-- Name: user_queue id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_queue ALTER COLUMN id SET DEFAULT nextval('public.user_queue_id_seq'::regclass);


--
-- Name: user_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings ALTER COLUMN id SET DEFAULT nextval('public.user_settings_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: albums albums_artist_id_name_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.albums
    ADD CONSTRAINT albums_artist_id_name_key_key UNIQUE (artist_id, name_key);


--
-- Name: albums albums_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.albums
    ADD CONSTRAINT albums_pkey PRIMARY KEY (id);


--
-- Name: analytics_events_raw analytics_events_raw_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events_raw
    ADD CONSTRAINT analytics_events_raw_pkey PRIMARY KEY (event_id);


--
-- Name: artist_account_members artist_account_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_account_members
    ADD CONSTRAINT artist_account_members_pkey PRIMARY KEY (id);


--
-- Name: artist_accounts artist_accounts_artist_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_accounts
    ADD CONSTRAINT artist_accounts_artist_id_key UNIQUE (artist_id);


--
-- Name: artist_accounts artist_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_accounts
    ADD CONSTRAINT artist_accounts_pkey PRIMARY KEY (id);


--
-- Name: artist_claim_requests artist_claim_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_claim_requests
    ADD CONSTRAINT artist_claim_requests_pkey PRIMARY KEY (id);


--
-- Name: artist_ownerships artist_ownerships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_ownerships
    ADD CONSTRAINT artist_ownerships_pkey PRIMARY KEY (id);


--
-- Name: artist_trends artist_trends_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_trends
    ADD CONSTRAINT artist_trends_pkey PRIMARY KEY (id);


--
-- Name: artist_uploaders artist_uploaders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_uploaders
    ADD CONSTRAINT artist_uploaders_pkey PRIMARY KEY (user_id);


--
-- Name: artists artists_name_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artists
    ADD CONSTRAINT artists_name_key_key UNIQUE (name_key);


--
-- Name: artists artists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artists
    ADD CONSTRAINT artists_pkey PRIMARY KEY (id);


--
-- Name: auth_devices auth_devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_devices
    ADD CONSTRAINT auth_devices_pkey PRIMARY KEY (auth_device_id);


--
-- Name: auth_sessions auth_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_pkey PRIMARY KEY (sid);


--
-- Name: dislikes dislikes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dislikes
    ADD CONSTRAINT dislikes_pkey PRIMARY KEY (id);


--
-- Name: dislikes dislikes_user_id_song_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dislikes
    ADD CONSTRAINT dislikes_user_id_song_id_key UNIQUE (user_id, song_id);


--
-- Name: genre_popularity genre_popularity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genre_popularity
    ADD CONSTRAINT genre_popularity_pkey PRIMARY KEY (id);


--
-- Name: genres genres_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genres
    ADD CONSTRAINT genres_name_key UNIQUE (name);


--
-- Name: genres genres_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genres
    ADD CONSTRAINT genres_pkey PRIMARY KEY (id);


--
-- Name: likes likes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.likes
    ADD CONSTRAINT likes_pkey PRIMARY KEY (id);


--
-- Name: likes likes_user_id_song_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.likes
    ADD CONSTRAINT likes_user_id_song_id_key UNIQUE (user_id, song_id);


--
-- Name: listens listens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listens
    ADD CONSTRAINT listens_pkey PRIMARY KEY (id);


--
-- Name: lyrics_external_cache lyrics_external_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lyrics_external_cache
    ADD CONSTRAINT lyrics_external_cache_pkey PRIMARY KEY (song_id);


--
-- Name: lyrics lyrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lyrics
    ADD CONSTRAINT lyrics_pkey PRIMARY KEY (id);


--
-- Name: lyrics_reports lyrics_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lyrics_reports
    ADD CONSTRAINT lyrics_reports_pkey PRIMARY KEY (id);


--
-- Name: lyrics_reports lyrics_reports_song_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lyrics_reports
    ADD CONSTRAINT lyrics_reports_song_id_user_id_key UNIQUE (song_id, user_id);


--
-- Name: lyrics lyrics_song_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lyrics
    ADD CONSTRAINT lyrics_song_id_key UNIQUE (song_id);


--
-- Name: playlist_tracks playlist_tracks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playlist_tracks
    ADD CONSTRAINT playlist_tracks_pkey PRIMARY KEY (id);


--
-- Name: playlist_tracks playlist_tracks_playlist_id_song_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playlist_tracks
    ADD CONSTRAINT playlist_tracks_playlist_id_song_id_key UNIQUE (playlist_id, song_id);


--
-- Name: playlists playlists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playlists
    ADD CONSTRAINT playlists_pkey PRIMARY KEY (id);


--
-- Name: playlists playlists_share_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playlists
    ADD CONSTRAINT playlists_share_slug_key UNIQUE (share_slug);


--
-- Name: queue_state queue_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_state
    ADD CONSTRAINT queue_state_pkey PRIMARY KEY (user_id);


--
-- Name: reco_migrations reco_migrations_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reco_migrations
    ADD CONSTRAINT reco_migrations_name_key UNIQUE (name);


--
-- Name: reco_migrations reco_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reco_migrations
    ADD CONSTRAINT reco_migrations_pkey PRIMARY KEY (id);


--
-- Name: recommendation_sessions recommendation_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_sessions
    ADD CONSTRAINT recommendation_sessions_pkey PRIMARY KEY (id);


--
-- Name: recommendation_sessions recommendation_sessions_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_sessions
    ADD CONSTRAINT recommendation_sessions_session_id_key UNIQUE (session_id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (jti);


--
-- Name: search_outbox_queue search_outbox_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_outbox_queue
    ADD CONSTRAINT search_outbox_queue_pkey PRIMARY KEY (entity_type, entity_id);


--
-- Name: security_events security_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_events
    ADD CONSTRAINT security_events_pkey PRIMARY KEY (id);


--
-- Name: service_sessions service_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_sessions
    ADD CONSTRAINT service_sessions_pkey PRIMARY KEY (id);


--
-- Name: social_post_likes social_post_likes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_post_likes
    ADD CONSTRAINT social_post_likes_pkey PRIMARY KEY (post_id, user_id);


--
-- Name: social_posts social_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_posts
    ADD CONSTRAINT social_posts_pkey PRIMARY KEY (id);


--
-- Name: song_features song_features_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.song_features
    ADD CONSTRAINT song_features_pkey PRIMARY KEY (id);


--
-- Name: song_features song_features_song_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.song_features
    ADD CONSTRAINT song_features_song_id_key UNIQUE (song_id);


--
-- Name: song_genres song_genres_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.song_genres
    ADD CONSTRAINT song_genres_pkey PRIMARY KEY (id);


--
-- Name: song_genres song_genres_song_id_genre_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.song_genres
    ADD CONSTRAINT song_genres_song_id_genre_id_key UNIQUE (song_id, genre_id);


--
-- Name: song_mood_scores song_mood_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.song_mood_scores
    ADD CONSTRAINT song_mood_scores_pkey PRIMARY KEY (song_id);


--
-- Name: song_moods song_moods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.song_moods
    ADD CONSTRAINT song_moods_pkey PRIMARY KEY (id);


--
-- Name: songs songs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.songs
    ADD CONSTRAINT songs_pkey PRIMARY KEY (id);


--
-- Name: songs songs_public_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.songs
    ADD CONSTRAINT songs_public_id_key UNIQUE (public_id);


--
-- Name: statistics_cache statistics_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statistics_cache
    ADD CONSTRAINT statistics_cache_pkey PRIMARY KEY (entity_type, uploader_id, entity_value);


--
-- Name: subscription_plans subscription_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_plans
    ADD CONSTRAINT subscription_plans_pkey PRIMARY KEY (id);


--
-- Name: subscription_plans subscription_plans_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_plans
    ADD CONSTRAINT subscription_plans_slug_key UNIQUE (slug);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: user_daily_recommendations user_daily_recommendations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_daily_recommendations
    ADD CONSTRAINT user_daily_recommendations_pkey PRIMARY KEY (user_id, song_id);


--
-- Name: user_eq_settings user_eq_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_eq_settings
    ADD CONSTRAINT user_eq_settings_pkey PRIMARY KEY (id);


--
-- Name: user_eq_settings user_eq_settings_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_eq_settings
    ADD CONSTRAINT user_eq_settings_user_id_key UNIQUE (user_id);


--
-- Name: user_genre_playback_prefs user_genre_playback_prefs_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_genre_playback_prefs
    ADD CONSTRAINT user_genre_playback_prefs_pk PRIMARY KEY (user_id, genre);


--
-- Name: user_history user_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_history
    ADD CONSTRAINT user_history_pkey PRIMARY KEY (id);


--
-- Name: user_history user_history_user_id_song_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_history
    ADD CONSTRAINT user_history_user_id_song_id_key UNIQUE (user_id, song_id);


--
-- Name: user_interactions user_interactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_interactions
    ADD CONSTRAINT user_interactions_pkey PRIMARY KEY (id);


--
-- Name: user_models user_models_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_models
    ADD CONSTRAINT user_models_pkey PRIMARY KEY (id);


--
-- Name: user_models user_models_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_models
    ADD CONSTRAINT user_models_user_id_key UNIQUE (user_id);


--
-- Name: user_mood_profile user_mood_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_mood_profile
    ADD CONSTRAINT user_mood_profile_pkey PRIMARY KEY (id);


--
-- Name: user_mood_profile user_mood_profile_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_mood_profile
    ADD CONSTRAINT user_mood_profile_user_id_key UNIQUE (user_id);


--
-- Name: user_preferences user_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_pkey PRIMARY KEY (id);


--
-- Name: user_preferences user_preferences_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_user_id_key UNIQUE (user_id);


--
-- Name: user_queue user_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_queue
    ADD CONSTRAINT user_queue_pkey PRIMARY KEY (id);


--
-- Name: user_queue user_queue_user_id_position_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_queue
    ADD CONSTRAINT user_queue_user_id_position_key UNIQUE (user_id, "position");


--
-- Name: user_settings user_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_pkey PRIMARY KEY (id);


--
-- Name: user_settings user_settings_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_user_id_key UNIQUE (user_id);


--
-- Name: user_taste_clusters user_taste_clusters_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_taste_clusters
    ADD CONSTRAINT user_taste_clusters_pk PRIMARY KEY (user_id, cluster_id);


--
-- Name: user_taste_links user_taste_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_taste_links
    ADD CONSTRAINT user_taste_links_pkey PRIMARY KEY (user_id, neighbor_user_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_albums_artist_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_albums_artist_id ON public.albums USING btree (artist_id);


--
-- Name: idx_albums_artist_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_albums_artist_key ON public.albums USING btree (artist_id, name_key);


--
-- Name: idx_albums_public_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_albums_public_id ON public.albums USING btree (public_id);


--
-- Name: idx_analytics_events_raw_track_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_analytics_events_raw_track_time ON public.analytics_events_raw USING btree (track_id, event_time DESC);


--
-- Name: idx_analytics_events_raw_user_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_analytics_events_raw_user_time ON public.analytics_events_raw USING btree (user_id, event_time DESC);


--
-- Name: idx_artist_claim_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_artist_claim_status_created ON public.artist_claim_requests USING btree (status, created_at DESC);


--
-- Name: idx_artist_ownerships_user_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_artist_ownerships_user_active ON public.artist_ownerships USING btree (user_id) WHERE (((status)::text = 'active'::text) AND (revoked_at IS NULL));


--
-- Name: idx_artists_mbid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_artists_mbid ON public.artists USING btree (mbid) WHERE (mbid IS NOT NULL);


--
-- Name: idx_artists_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_artists_name_key ON public.artists USING btree (name_key);


--
-- Name: idx_artists_popular_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_artists_popular_updated ON public.artists USING btree (updated_at DESC, id DESC) WHERE (popular = true);


--
-- Name: idx_artists_public_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_artists_public_id ON public.artists USING btree (public_id);


--
-- Name: idx_auth_devices_sid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_devices_sid ON public.auth_devices USING btree (sid);


--
-- Name: idx_auth_devices_user_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_devices_user_active ON public.auth_devices USING btree (user_id) WHERE (revoked_at IS NULL);


--
-- Name: idx_auth_sessions_user_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_sessions_user_active ON public.auth_sessions USING btree (user_id) WHERE (revoked_at IS NULL);


--
-- Name: idx_dislikes_song; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dislikes_song ON public.dislikes USING btree (song_id);


--
-- Name: idx_dislikes_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dislikes_user ON public.dislikes USING btree (user_id);


--
-- Name: idx_dislikes_user_song; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dislikes_user_song ON public.dislikes USING btree (user_id, song_id);


--
-- Name: idx_dislikes_user_song_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dislikes_user_song_created ON public.dislikes USING btree (user_id, song_id, created_at DESC);


--
-- Name: idx_likes_song; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_likes_song ON public.likes USING btree (song_id);


--
-- Name: idx_likes_song_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_likes_song_user ON public.likes USING btree (song_id, user_id);


--
-- Name: INDEX idx_likes_song_user; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_likes_song_user IS 'Оптимизация collaborative filtering';


--
-- Name: idx_likes_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_likes_user ON public.likes USING btree (user_id);


--
-- Name: idx_likes_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_likes_user_created ON public.likes USING btree (user_id, created_at DESC);


--
-- Name: idx_likes_user_song; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_likes_user_song ON public.likes USING btree (user_id, song_id);


--
-- Name: idx_listens_song; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listens_song ON public.listens USING btree (song_id);


--
-- Name: idx_listens_song_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listens_song_time ON public.listens USING btree (song_id, listened_at DESC);


--
-- Name: idx_listens_user_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listens_user_time ON public.listens USING btree (user_id, listened_at DESC);


--
-- Name: idx_lyrics_plain_text; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lyrics_plain_text ON public.lyrics USING gin (to_tsvector('russian'::regconfig, plain_text));


--
-- Name: idx_lyrics_song_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lyrics_song_id ON public.lyrics USING btree (song_id);


--
-- Name: idx_playlist_tracks_playlist_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_playlist_tracks_playlist_id ON public.playlist_tracks USING btree (playlist_id);


--
-- Name: idx_playlist_tracks_playlist_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_playlist_tracks_playlist_position ON public.playlist_tracks USING btree (playlist_id, "position");


--
-- Name: idx_playlist_tracks_song_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_playlist_tracks_song_id ON public.playlist_tracks USING btree (song_id);


--
-- Name: idx_playlists_share_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_playlists_share_slug ON public.playlists USING btree (share_slug) WHERE (share_slug IS NOT NULL);


--
-- Name: idx_playlists_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_playlists_user_id ON public.playlists USING btree (user_id);


--
-- Name: idx_reco_sessions_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reco_sessions_expires ON public.recommendation_sessions USING btree (expires_at);


--
-- Name: idx_reco_sessions_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reco_sessions_session_id ON public.recommendation_sessions USING btree (session_id);


--
-- Name: idx_reco_sessions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reco_sessions_user ON public.recommendation_sessions USING btree (user_id);


--
-- Name: idx_reco_sessions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reco_sessions_user_id ON public.recommendation_sessions USING btree (user_id);


--
-- Name: idx_refresh_tokens_sid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refresh_tokens_sid ON public.refresh_tokens USING btree (sid);


--
-- Name: idx_refresh_tokens_user_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refresh_tokens_user_active ON public.refresh_tokens USING btree (user_id) WHERE (revoked_at IS NULL);


--
-- Name: idx_search_outbox_next_attempt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_search_outbox_next_attempt ON public.search_outbox_queue USING btree (next_attempt_at, updated_at);


--
-- Name: idx_security_events_type_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_security_events_type_created ON public.security_events USING btree (event_type, created_at DESC);


--
-- Name: idx_security_events_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_security_events_user_created ON public.security_events USING btree (user_id, created_at DESC);


--
-- Name: idx_service_sessions_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_sessions_expires_at ON public.service_sessions USING btree (expires_at);


--
-- Name: idx_service_sessions_service_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_sessions_service_name ON public.service_sessions USING btree (service_name);


--
-- Name: idx_social_post_likes_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_social_post_likes_user ON public.social_post_likes USING btree (user_id, created_at DESC);


--
-- Name: idx_social_post_likes_user_post; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_social_post_likes_user_post ON public.social_post_likes USING btree (user_id, post_id);


--
-- Name: idx_social_posts_feed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_social_posts_feed ON public.social_posts USING btree (created_at DESC, id DESC) WHERE (((status)::text = 'active'::text) AND ((visibility)::text = 'public'::text));


--
-- Name: idx_social_posts_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_social_posts_user ON public.social_posts USING btree (user_id, created_at DESC, id DESC);


--
-- Name: idx_song_features_danceability; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_song_features_danceability ON public.song_features USING btree (danceability);


--
-- Name: idx_song_features_danceability_energy; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_song_features_danceability_energy ON public.song_features USING btree (danceability, energy);


--
-- Name: idx_song_features_energy; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_song_features_energy ON public.song_features USING btree (energy);


--
-- Name: idx_song_features_energy_valence; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_song_features_energy_valence ON public.song_features USING btree (energy, valence);


--
-- Name: idx_song_features_tempo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_song_features_tempo ON public.song_features USING btree (tempo);


--
-- Name: idx_song_features_valence; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_song_features_valence ON public.song_features USING btree (valence);


--
-- Name: idx_song_mood_scores_chill; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_song_mood_scores_chill ON public.song_mood_scores USING btree (score_chill DESC, song_id);


--
-- Name: idx_song_mood_scores_focus; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_song_mood_scores_focus ON public.song_mood_scores USING btree (score_focus DESC, song_id);


--
-- Name: idx_song_mood_scores_happy; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_song_mood_scores_happy ON public.song_mood_scores USING btree (score_happy DESC, song_id);


--
-- Name: idx_song_mood_scores_party; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_song_mood_scores_party ON public.song_mood_scores USING btree (score_party DESC, song_id);


--
-- Name: idx_song_mood_scores_sad; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_song_mood_scores_sad ON public.song_mood_scores USING btree (score_sad DESC, song_id);


--
-- Name: idx_song_mood_scores_sleep; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_song_mood_scores_sleep ON public.song_mood_scores USING btree (score_sleep DESC, song_id);


--
-- Name: idx_song_mood_scores_workout; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_song_mood_scores_workout ON public.song_mood_scores USING btree (score_workout DESC, song_id);


--
-- Name: idx_song_moods_mood; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_song_moods_mood ON public.song_moods USING btree (mood);


--
-- Name: idx_song_moods_song_mood; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_song_moods_song_mood ON public.song_moods USING btree (song_id, mood);


--
-- Name: idx_songs_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_songs_active ON public.songs USING btree (id) WHERE (play_count > 0);


--
-- Name: idx_songs_artist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_songs_artist ON public.songs USING btree (artist);


--
-- Name: idx_songs_artist_album; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_songs_artist_album ON public.songs USING btree (artist, album);


--
-- Name: idx_songs_artist_genre; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_songs_artist_genre ON public.songs USING btree (artist, genre) INCLUDE (id);


--
-- Name: idx_songs_artist_norm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_songs_artist_norm ON public.songs USING btree (artist_norm);


--
-- Name: idx_songs_artist_popularity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_songs_artist_popularity ON public.songs USING btree (artist, popularity DESC NULLS LAST) WHERE (artist IS NOT NULL);


--
-- Name: idx_songs_avail_pop_pc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_songs_avail_pop_pc ON public.songs USING btree (popularity DESC NULLS LAST, play_count DESC NULLS LAST) WHERE (is_available IS DISTINCT FROM false);


--
-- Name: idx_songs_ebap; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_songs_ebap ON public.songs USING btree (id) WHERE (has_ebap = true);


--
-- Name: idx_songs_ebap_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_songs_ebap_status ON public.songs USING btree (ebap_status, id);


--
-- Name: idx_songs_embedding_hnsw; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_songs_embedding_hnsw ON public.songs USING hnsw (embedding public.vector_cosine_ops) WITH (m='16', ef_construction='200');


--
-- Name: idx_songs_genre; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_songs_genre ON public.songs USING btree (genre);


--
-- Name: idx_songs_genre_norm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_songs_genre_norm ON public.songs USING btree (genre_norm);


--
-- Name: idx_songs_genre_popularity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_songs_genre_popularity ON public.songs USING btree (genre, popularity DESC NULLS LAST) WHERE (genre IS NOT NULL);


--
-- Name: idx_songs_hls; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_songs_hls ON public.songs USING btree (id) WHERE (has_hls = true);


--
-- Name: idx_songs_hls_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_songs_hls_status ON public.songs USING btree (hls_status, id);


--
-- Name: idx_songs_id_covering; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_songs_id_covering ON public.songs USING btree (id) INCLUDE (title, artist, album, genre, popularity, play_count);


--
-- Name: idx_songs_is_available; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_songs_is_available ON public.songs USING btree (is_available) WHERE (is_available = false);


--
-- Name: idx_songs_metadata_parse_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_songs_metadata_parse_status ON public.songs USING btree (metadata_parse_status, id);


--
-- Name: idx_songs_parsed_metadata; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_songs_parsed_metadata ON public.songs USING gin (parsed_metadata) WHERE (parsed_metadata IS NOT NULL);


--
-- Name: idx_songs_popular; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_songs_popular ON public.songs USING btree (popularity DESC, play_count DESC) WHERE (popularity > 50);


--
-- Name: idx_songs_popularity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_songs_popularity ON public.songs USING btree (popularity DESC);


--
-- Name: idx_songs_popularity_play_count; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_songs_popularity_play_count ON public.songs USING btree (popularity DESC NULLS LAST, play_count DESC NULLS LAST);


--
-- Name: INDEX idx_songs_popularity_play_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_songs_popularity_play_count IS 'Оптимизация глобального топа рекомендаций';


--
-- Name: idx_songs_popularity_playcount_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_songs_popularity_playcount_created ON public.songs USING btree (popularity DESC, play_count DESC, created_at DESC);


--
-- Name: idx_songs_public_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_songs_public_id ON public.songs USING btree (public_id);


--
-- Name: idx_songs_quality_variants; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_songs_quality_variants ON public.songs USING btree (id) WHERE (quality_variants IS NOT NULL);


--
-- Name: idx_songs_reco_covering; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_songs_reco_covering ON public.songs USING btree (id, title, artist, album, genre, duration, popularity, play_count);


--
-- Name: idx_songs_search_text; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_songs_search_text ON public.songs USING gin (to_tsvector('russian'::regconfig, (((COALESCE(title, ''::character varying))::text || ' '::text) || (COALESCE(artist, ''::character varying))::text)));


--
-- Name: idx_songs_title_artist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_songs_title_artist ON public.songs USING btree (lower((title)::text), lower((artist)::text));


--
-- Name: idx_songs_transcode_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_songs_transcode_status ON public.songs USING btree (transcode_status, id);


--
-- Name: idx_songs_uploader; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_songs_uploader ON public.songs USING btree (uploader_id);


--
-- Name: idx_songs_uploader_artist_norm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_songs_uploader_artist_norm ON public.songs USING btree (uploader_id, artist_norm);


--
-- Name: idx_songs_uploader_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_songs_uploader_created ON public.songs USING btree (uploader_id, created_at DESC);


--
-- Name: idx_songs_uploader_genre_norm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_songs_uploader_genre_norm ON public.songs USING btree (uploader_id, genre_norm);


--
-- Name: idx_songs_waveform_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_songs_waveform_status ON public.songs USING btree (waveform_status, id) WHERE ((waveform_status)::text = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'failed'::character varying])::text[]));


--
-- Name: idx_songs_with_covers; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_songs_with_covers ON public.songs USING btree (id) WHERE ((cover_path IS NOT NULL) OR (cover IS NOT NULL));


--
-- Name: idx_statistics_cache_type_uploader_count; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_statistics_cache_type_uploader_count ON public.statistics_cache USING btree (entity_type, uploader_id, track_count DESC, entity_value);


--
-- Name: idx_subscriptions_active_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_subscriptions_active_user ON public.subscriptions USING btree (user_id) WHERE ((status)::text = 'active'::text);


--
-- Name: idx_subscriptions_provider_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_provider_id ON public.subscriptions USING btree (provider_id) WHERE (provider_id IS NOT NULL);


--
-- Name: idx_subscriptions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_user_id ON public.subscriptions USING btree (user_id);


--
-- Name: idx_user_daily_recommendations_user_rank; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_daily_recommendations_user_rank ON public.user_daily_recommendations USING btree (user_id, rank);


--
-- Name: idx_user_eq_settings_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_eq_settings_user ON public.user_eq_settings USING btree (user_id);


--
-- Name: idx_user_history_composite; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_history_composite ON public.user_history USING btree (user_id, last_played DESC, play_count);


--
-- Name: idx_user_history_last_played; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_history_last_played ON public.user_history USING btree (last_played);


--
-- Name: idx_user_history_liked; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_history_liked ON public.user_history USING btree (user_id, song_id) WHERE (liked = true);


--
-- Name: idx_user_history_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_history_recent ON public.user_history USING btree (user_id, last_played DESC);


--
-- Name: idx_user_history_song_agg; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_history_song_agg ON public.user_history USING btree (song_id, play_count, liked, skip_count);


--
-- Name: idx_user_history_song_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_history_song_id ON public.user_history USING btree (song_id);


--
-- Name: idx_user_history_song_plays; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_history_song_plays ON public.user_history USING btree (song_id, play_count DESC);


--
-- Name: idx_user_history_user_count; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_history_user_count ON public.user_history USING btree (user_id);


--
-- Name: idx_user_history_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_history_user_id ON public.user_history USING btree (user_id);


--
-- Name: idx_user_history_user_last_played; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_history_user_last_played ON public.user_history USING btree (user_id, last_played DESC);


--
-- Name: INDEX idx_user_history_user_last_played; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_user_history_user_last_played IS 'Оптимизация персональных рекомендаций';


--
-- Name: idx_user_history_user_liked; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_history_user_liked ON public.user_history USING btree (user_id) WHERE (liked = true);


--
-- Name: idx_user_history_user_song; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_history_user_song ON public.user_history USING btree (user_id, song_id);


--
-- Name: idx_user_interactions_composite; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_interactions_composite ON public.user_interactions USING btree (user_id, created_at DESC, interaction_type);


--
-- Name: idx_user_interactions_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_interactions_created ON public.user_interactions USING btree (created_at DESC);


--
-- Name: idx_user_interactions_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_interactions_recent ON public.user_interactions USING btree (song_id, created_at DESC);


--
-- Name: idx_user_interactions_song_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_interactions_song_id ON public.user_interactions USING btree (song_id);


--
-- Name: idx_user_interactions_song_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_interactions_song_time ON public.user_interactions USING btree (song_id, created_at DESC);


--
-- Name: idx_user_interactions_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_interactions_timestamp ON public.user_interactions USING btree (created_at);


--
-- Name: idx_user_interactions_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_interactions_type ON public.user_interactions USING btree (interaction_type);


--
-- Name: idx_user_interactions_type_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_interactions_type_time ON public.user_interactions USING btree (interaction_type, created_at DESC);


--
-- Name: idx_user_interactions_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_interactions_user_created ON public.user_interactions USING btree (user_id, created_at DESC);


--
-- Name: idx_user_interactions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_interactions_user_id ON public.user_interactions USING btree (user_id);


--
-- Name: idx_user_interactions_user_song_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_interactions_user_song_type ON public.user_interactions USING btree (user_id, song_id, interaction_type);


--
-- Name: idx_user_interactions_user_time_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_interactions_user_time_type ON public.user_interactions USING btree (user_id, created_at DESC, interaction_type);


--
-- Name: idx_user_interactions_user_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_interactions_user_type ON public.user_interactions USING btree (user_id, interaction_type);


--
-- Name: idx_user_models_last_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_models_last_updated ON public.user_models USING btree (last_updated DESC);


--
-- Name: idx_user_models_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_models_user ON public.user_models USING btree (user_id);


--
-- Name: idx_user_mood_profile_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_mood_profile_user ON public.user_mood_profile USING btree (user_id);


--
-- Name: idx_user_preferences_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_preferences_updated ON public.user_preferences USING btree (updated_at);


--
-- Name: idx_user_preferences_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_preferences_user_id ON public.user_preferences USING btree (user_id);


--
-- Name: idx_user_queue_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_queue_user_id ON public.user_queue USING btree (user_id);


--
-- Name: idx_user_taste_links_user_weight; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_taste_links_user_weight ON public.user_taste_links USING btree (user_id, weight DESC, updated_at DESC);


--
-- Name: idx_users_email_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_users_email_hash ON public.users USING btree (email_hash) WHERE (email_hash IS NOT NULL);


--
-- Name: idx_users_telegram_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_users_telegram_id ON public.users USING btree (telegram_id) WHERE (telegram_id IS NOT NULL);


--
-- Name: uniq_artist_account_member_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_artist_account_member_active ON public.artist_account_members USING btree (account_id, user_id) WHERE (((status)::text = 'active'::text) AND (revoked_at IS NULL));


--
-- Name: uniq_artist_active_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_artist_active_owner ON public.artist_ownerships USING btree (artist_id) WHERE (((status)::text = 'active'::text) AND (revoked_at IS NULL));


--
-- Name: uniq_artist_claim_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_artist_claim_pending ON public.artist_claim_requests USING btree (artist_id, user_id) WHERE ((status)::text = 'pending'::text);


--
-- Name: user_genre_playback_prefs_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_genre_playback_prefs_user_id_idx ON public.user_genre_playback_prefs USING btree (user_id);


--
-- Name: user_taste_clusters_embedding_hnsw; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_taste_clusters_embedding_hnsw ON public.user_taste_clusters USING hnsw (embedding public.vector_cosine_ops) WITH (m='16', ef_construction='200');


--
-- Name: user_taste_clusters_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_taste_clusters_user_id_idx ON public.user_taste_clusters USING btree (user_id);


--
-- Name: albums trg_search_outbox_albums; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_search_outbox_albums AFTER INSERT OR UPDATE ON public.albums FOR EACH ROW EXECUTE FUNCTION public.search_outbox_album_trigger();


--
-- Name: artists trg_search_outbox_artists; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_search_outbox_artists AFTER INSERT OR UPDATE ON public.artists FOR EACH ROW EXECUTE FUNCTION public.search_outbox_artist_trigger();


--
-- Name: songs trg_search_outbox_songs; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_search_outbox_songs AFTER INSERT OR DELETE OR UPDATE ON public.songs FOR EACH ROW EXECUTE FUNCTION public.search_outbox_song_trigger();


--
-- Name: song_features trg_song_features_refresh_mood_scores; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_song_features_refresh_mood_scores AFTER INSERT OR UPDATE OF tempo, energy, valence, danceability, speechiness ON public.song_features FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_song_mood_scores();


--
-- Name: song_features trg_song_features_sync_embedding; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_song_features_sync_embedding AFTER INSERT OR UPDATE OF tempo, energy, valence, danceability, acousticness, instrumentalness, liveness, speechiness ON public.song_features FOR EACH ROW EXECUTE FUNCTION public.reco_song_features_sync_embedding();


--
-- Name: songs trg_songs_set_norm_cols; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_songs_set_norm_cols BEFORE INSERT OR UPDATE OF genre, artist ON public.songs FOR EACH ROW EXECUTE FUNCTION public.songs_set_norm_cols();


--
-- Name: user_preferences trigger_user_preferences_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_user_preferences_updated_at BEFORE UPDATE ON public.user_preferences FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: playlists update_playlists_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_playlists_updated_at BEFORE UPDATE ON public.playlists FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: songs update_songs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_songs_updated_at BEFORE UPDATE ON public.songs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: albums albums_artist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.albums
    ADD CONSTRAINT albums_artist_id_fkey FOREIGN KEY (artist_id) REFERENCES public.artists(id) ON DELETE CASCADE;


--
-- Name: artist_account_members artist_account_members_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_account_members
    ADD CONSTRAINT artist_account_members_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.artist_accounts(id) ON DELETE CASCADE;


--
-- Name: artist_account_members artist_account_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_account_members
    ADD CONSTRAINT artist_account_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: artist_accounts artist_accounts_artist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_accounts
    ADD CONSTRAINT artist_accounts_artist_id_fkey FOREIGN KEY (artist_id) REFERENCES public.artists(id) ON DELETE CASCADE;


--
-- Name: artist_claim_requests artist_claim_requests_artist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_claim_requests
    ADD CONSTRAINT artist_claim_requests_artist_id_fkey FOREIGN KEY (artist_id) REFERENCES public.artists(id) ON DELETE CASCADE;


--
-- Name: artist_claim_requests artist_claim_requests_reviewed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_claim_requests
    ADD CONSTRAINT artist_claim_requests_reviewed_by_user_id_fkey FOREIGN KEY (reviewed_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: artist_claim_requests artist_claim_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_claim_requests
    ADD CONSTRAINT artist_claim_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: artist_ownerships artist_ownerships_artist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_ownerships
    ADD CONSTRAINT artist_ownerships_artist_id_fkey FOREIGN KEY (artist_id) REFERENCES public.artists(id) ON DELETE CASCADE;


--
-- Name: artist_ownerships artist_ownerships_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_ownerships
    ADD CONSTRAINT artist_ownerships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: artist_uploaders artist_uploaders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artist_uploaders
    ADD CONSTRAINT artist_uploaders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: artists artists_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artists
    ADD CONSTRAINT artists_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: auth_devices auth_devices_sid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_devices
    ADD CONSTRAINT auth_devices_sid_fkey FOREIGN KEY (sid) REFERENCES public.auth_sessions(sid) ON DELETE CASCADE;


--
-- Name: auth_devices auth_devices_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_devices
    ADD CONSTRAINT auth_devices_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: auth_sessions auth_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: dislikes dislikes_song_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dislikes
    ADD CONSTRAINT dislikes_song_id_fkey FOREIGN KEY (song_id) REFERENCES public.songs(id) ON DELETE CASCADE;


--
-- Name: dislikes dislikes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dislikes
    ADD CONSTRAINT dislikes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: likes likes_song_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.likes
    ADD CONSTRAINT likes_song_id_fkey FOREIGN KEY (song_id) REFERENCES public.songs(id) ON DELETE CASCADE;


--
-- Name: likes likes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.likes
    ADD CONSTRAINT likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: listens listens_song_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listens
    ADD CONSTRAINT listens_song_id_fkey FOREIGN KEY (song_id) REFERENCES public.songs(id) ON DELETE CASCADE;


--
-- Name: listens listens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listens
    ADD CONSTRAINT listens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: playlist_tracks playlist_tracks_added_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playlist_tracks
    ADD CONSTRAINT playlist_tracks_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: playlist_tracks playlist_tracks_playlist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playlist_tracks
    ADD CONSTRAINT playlist_tracks_playlist_id_fkey FOREIGN KEY (playlist_id) REFERENCES public.playlists(id) ON DELETE CASCADE;


--
-- Name: playlist_tracks playlist_tracks_song_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playlist_tracks
    ADD CONSTRAINT playlist_tracks_song_id_fkey FOREIGN KEY (song_id) REFERENCES public.songs(id) ON DELETE CASCADE;


--
-- Name: playlists playlists_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playlists
    ADD CONSTRAINT playlists_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: recommendation_sessions recommendation_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_sessions
    ADD CONSTRAINT recommendation_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_sid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_sid_fkey FOREIGN KEY (sid) REFERENCES public.auth_sessions(sid) ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: security_events security_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_events
    ADD CONSTRAINT security_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: social_post_likes social_post_likes_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_post_likes
    ADD CONSTRAINT social_post_likes_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.social_posts(id) ON DELETE CASCADE;


--
-- Name: social_post_likes social_post_likes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_post_likes
    ADD CONSTRAINT social_post_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: social_posts social_posts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_posts
    ADD CONSTRAINT social_posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: song_features song_features_song_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.song_features
    ADD CONSTRAINT song_features_song_id_fkey FOREIGN KEY (song_id) REFERENCES public.songs(id) ON DELETE CASCADE;


--
-- Name: song_genres song_genres_genre_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.song_genres
    ADD CONSTRAINT song_genres_genre_id_fkey FOREIGN KEY (genre_id) REFERENCES public.genres(id) ON DELETE CASCADE;


--
-- Name: song_genres song_genres_song_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.song_genres
    ADD CONSTRAINT song_genres_song_id_fkey FOREIGN KEY (song_id) REFERENCES public.songs(id) ON DELETE CASCADE;


--
-- Name: song_mood_scores song_mood_scores_song_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.song_mood_scores
    ADD CONSTRAINT song_mood_scores_song_id_fkey FOREIGN KEY (song_id) REFERENCES public.songs(id) ON DELETE CASCADE;


--
-- Name: song_moods song_moods_song_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.song_moods
    ADD CONSTRAINT song_moods_song_id_fkey FOREIGN KEY (song_id) REFERENCES public.songs(id) ON DELETE CASCADE;


--
-- Name: songs songs_uploader_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.songs
    ADD CONSTRAINT songs_uploader_id_fkey FOREIGN KEY (uploader_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: statistics_cache statistics_cache_uploader_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.statistics_cache
    ADD CONSTRAINT statistics_cache_uploader_id_fkey FOREIGN KEY (uploader_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.subscription_plans(id);


--
-- Name: user_daily_recommendations user_daily_recommendations_song_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_daily_recommendations
    ADD CONSTRAINT user_daily_recommendations_song_id_fkey FOREIGN KEY (song_id) REFERENCES public.songs(id) ON DELETE CASCADE;


--
-- Name: user_daily_recommendations user_daily_recommendations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_daily_recommendations
    ADD CONSTRAINT user_daily_recommendations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_eq_settings user_eq_settings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_eq_settings
    ADD CONSTRAINT user_eq_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_history user_history_song_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_history
    ADD CONSTRAINT user_history_song_id_fkey FOREIGN KEY (song_id) REFERENCES public.songs(id) ON DELETE CASCADE;


--
-- Name: user_history user_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_history
    ADD CONSTRAINT user_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_interactions user_interactions_song_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_interactions
    ADD CONSTRAINT user_interactions_song_id_fkey FOREIGN KEY (song_id) REFERENCES public.songs(id) ON DELETE CASCADE;


--
-- Name: user_interactions user_interactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_interactions
    ADD CONSTRAINT user_interactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_models user_models_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_models
    ADD CONSTRAINT user_models_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_mood_profile user_mood_profile_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_mood_profile
    ADD CONSTRAINT user_mood_profile_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_preferences user_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_settings user_settings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


