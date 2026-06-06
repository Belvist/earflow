CREATE TABLE IF NOT EXISTS user_taste_links (
  user_id int NOT NULL,
  neighbor_user_id int NOT NULL,
  weight real NOT NULL DEFAULT 0,
  updated_at timestamp NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, neighbor_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_taste_links_user_weight
  ON user_taste_links (user_id, weight DESC, updated_at DESC);

CREATE OR REPLACE FUNCTION reco_refresh_user_taste_links(p_user_id int, p_limit int DEFAULT 50)
RETURNS int AS $$
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
$$ LANGUAGE plpgsql;
