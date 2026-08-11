-- Migration: 011_pgvector_hnsw
-- Description: Switch pgvector ANN indexes from ivfflat to hnsw for faster queries and better incremental update behavior
-- NOTE:
--  - Requires pgvector >= 0.5.0 (HNSW support)
--  - Uses CONCURRENTLY to avoid blocking reads/writes

CREATE EXTENSION IF NOT EXISTS vector;

DO $$
DECLARE
  v TEXT;
  parts TEXT[];
  major_i INT;
  minor_i INT;
  patch_i INT;
  ver_num INT;
BEGIN
  SELECT extversion INTO v
  FROM pg_extension
  WHERE extname = 'vector';

  IF v IS NULL THEN
    RAISE EXCEPTION 'pgvector extension is not installed';
  END IF;

  parts := regexp_split_to_array(v, '\.');
  major_i := COALESCE(NULLIF(parts[1], '')::int, 0);
  minor_i := COALESCE(NULLIF(parts[2], '')::int, 0);
  patch_i := COALESCE(NULLIF(parts[3], '')::int, 0);

  ver_num := major_i * 10000 + minor_i * 100 + patch_i;

  IF ver_num < 500 THEN
    RAISE EXCEPTION 'pgvector % detected, but hnsw requires pgvector >= 0.5.0', v;
  END IF;
END $$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_songs_embedding_hnsw
  ON songs
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);

CREATE INDEX CONCURRENTLY IF NOT EXISTS user_taste_clusters_embedding_hnsw
  ON user_taste_clusters
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);

DROP INDEX CONCURRENTLY IF EXISTS idx_songs_embedding_ivfflat;
DROP INDEX CONCURRENTLY IF EXISTS user_taste_clusters_embedding_ivfflat;

ANALYZE songs;
ANALYZE user_taste_clusters;
