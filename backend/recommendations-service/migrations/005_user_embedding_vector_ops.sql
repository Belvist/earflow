CREATE EXTENSION IF NOT EXISTS vector;

CREATE OR REPLACE FUNCTION reco_scale_vector(v vector, s real)
RETURNS vector AS $$
  SELECT array_to_vector(
    ARRAY(
      SELECT (x * s)::real
      FROM unnest(v::real[]) WITH ORDINALITY AS t(x, ord)
      ORDER BY ord
    ),
    vector_dims(v),
    true
  );
$$ LANGUAGE SQL IMMUTABLE STRICT PARALLEL SAFE;

CREATE OR REPLACE FUNCTION reco_blend_user_embedding(old_embedding vector, track_embedding vector, alpha real)
RETURNS vector AS $$
  SELECT CASE
    WHEN track_embedding IS NULL THEN old_embedding
    WHEN alpha <= 0 OR alpha >= 1 THEN old_embedding
    WHEN old_embedding IS NULL THEN l2_normalize(track_embedding)
    ELSE l2_normalize(
      reco_scale_vector(old_embedding, (1 - alpha)::real) +
      reco_scale_vector(track_embedding, alpha)
    )
  END;
$$ LANGUAGE SQL IMMUTABLE PARALLEL SAFE;

CREATE OR REPLACE FUNCTION reco_repel_user_embedding(old_embedding vector, track_embedding vector, alpha real)
RETURNS vector AS $$
  SELECT CASE
    WHEN track_embedding IS NULL THEN old_embedding
    WHEN alpha <= 0 OR alpha >= 1 THEN old_embedding
    WHEN old_embedding IS NULL THEN old_embedding
    WHEN vector_norm(old_embedding - reco_scale_vector(track_embedding, alpha)) > 0 THEN
      l2_normalize(old_embedding - reco_scale_vector(track_embedding, alpha))
    ELSE old_embedding
  END;
$$ LANGUAGE SQL IMMUTABLE PARALLEL SAFE;
