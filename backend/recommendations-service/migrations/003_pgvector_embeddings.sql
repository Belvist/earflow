-- Migration: 003_pgvector_embeddings
-- Description: Adds pgvector embeddings for songs based on song_features and creates ANN index
-- NOTE: Requires pgvector extension installed in PostgreSQL

-- Enable extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to songs (8D: tempo + 7 audio features)
ALTER TABLE songs
  ADD COLUMN IF NOT EXISTS embedding vector(8);

-- Normalize tempo to [0..1] in a stable way, and clamp all values
CREATE OR REPLACE FUNCTION reco_clamp01(v double precision)
RETURNS double precision AS $$
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
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION reco_tempo_norm(tempo double precision)
RETURNS double precision AS $$
DECLARE
  t double precision;
BEGIN
  t := COALESCE(tempo, 120);
  -- clamp tempo to [50..200] then map to [0..1]
  IF t < 50 THEN t := 50; END IF;
  IF t > 200 THEN t := 200; END IF;
  RETURN (t - 50) / 150;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION reco_song_embedding(
  tempo double precision,
  energy double precision,
  valence double precision,
  danceability double precision,
  acousticness double precision,
  instrumentalness double precision,
  liveness double precision,
  speechiness double precision
)
RETURNS vector(8) AS $$
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
$$ LANGUAGE plpgsql IMMUTABLE;

-- Trigger to keep songs.embedding in sync with song_features
CREATE OR REPLACE FUNCTION reco_song_features_sync_embedding()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_song_features_sync_embedding ON song_features;
CREATE TRIGGER trg_song_features_sync_embedding
AFTER INSERT OR UPDATE OF tempo, energy, valence, danceability, acousticness, instrumentalness, liveness, speechiness
ON song_features
FOR EACH ROW
EXECUTE FUNCTION reco_song_features_sync_embedding();

-- Backfill embeddings for existing rows
UPDATE songs s
SET embedding = reco_song_embedding(
  sf.tempo,
  sf.energy,
  sf.valence,
  sf.danceability,
  sf.acousticness,
  sf.instrumentalness,
  sf.liveness,
  sf.speechiness
)
FROM song_features sf
WHERE sf.song_id = s.id;

-- ANN index for cosine distance (<=>)
-- NOTE: ivfflat needs ANALYZE to be effective
CREATE INDEX IF NOT EXISTS idx_songs_embedding_ivfflat
ON songs
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

ANALYZE songs;
