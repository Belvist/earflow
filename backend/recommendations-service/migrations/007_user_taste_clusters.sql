CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS user_taste_clusters (
  user_id INT NOT NULL,
  cluster_id SMALLINT NOT NULL,
  embedding vector(8) NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_taste_clusters_pk PRIMARY KEY (user_id, cluster_id),
  CONSTRAINT user_taste_clusters_cluster_id_chk CHECK (cluster_id >= 1 AND cluster_id <= 5),
  CONSTRAINT user_taste_clusters_weight_chk CHECK (weight > 0)
);

CREATE INDEX IF NOT EXISTS user_taste_clusters_user_id_idx
  ON user_taste_clusters (user_id);

CREATE INDEX IF NOT EXISTS user_taste_clusters_embedding_ivfflat
  ON user_taste_clusters USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
