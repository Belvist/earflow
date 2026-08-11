CREATE EXTENSION IF NOT EXISTS vector;

CREATE OR REPLACE FUNCTION reco_user_embedding_from_clusters(p_user_id int)
RETURNS vector AS $$
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
$$ LANGUAGE SQL STABLE PARALLEL SAFE;

CREATE OR REPLACE FUNCTION reco_apply_feedback_to_taste_clusters(
  p_user_id int,
  p_track_embedding vector,
  p_alpha real,
  p_direction int,
  p_max_clusters int DEFAULT 5,
  p_new_cluster_dist_threshold real DEFAULT 0.25
)
RETURNS smallint AS $$
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
$$ LANGUAGE plpgsql;
