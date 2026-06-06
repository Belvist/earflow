-- Migration: 010_discover_precompute

ALTER TABLE songs ADD COLUMN IF NOT EXISTS genre_norm TEXT;
ALTER TABLE songs ADD COLUMN IF NOT EXISTS artist_norm TEXT;

UPDATE songs SET genre_norm = lower(trim(genre)) WHERE genre_norm IS NULL AND genre IS NOT NULL;
UPDATE songs SET artist_norm = lower(trim(artist)) WHERE artist_norm IS NULL AND artist IS NOT NULL;

CREATE OR REPLACE FUNCTION songs_set_norm_cols()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_songs_set_norm_cols ON songs;
CREATE TRIGGER trg_songs_set_norm_cols
BEFORE INSERT OR UPDATE OF genre, artist ON songs
FOR EACH ROW EXECUTE FUNCTION songs_set_norm_cols();

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_songs_genre_norm ON songs(genre_norm);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_songs_artist_norm ON songs(artist_norm);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_songs_uploader_genre_norm ON songs(uploader_id, genre_norm);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_songs_uploader_artist_norm ON songs(uploader_id, artist_norm);

CREATE TABLE IF NOT EXISTS song_mood_scores (
  song_id INT PRIMARY KEY REFERENCES songs(id) ON DELETE CASCADE,
  score_workout DOUBLE PRECISION,
  score_focus DOUBLE PRECISION,
  score_chill DOUBLE PRECISION,
  score_party DOUBLE PRECISION,
  score_happy DOUBLE PRECISION,
  score_sad DOUBLE PRECISION,
  score_sleep DOUBLE PRECISION,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_song_mood_scores_workout ON song_mood_scores(score_workout DESC, song_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_song_mood_scores_focus ON song_mood_scores(score_focus DESC, song_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_song_mood_scores_chill ON song_mood_scores(score_chill DESC, song_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_song_mood_scores_party ON song_mood_scores(score_party DESC, song_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_song_mood_scores_happy ON song_mood_scores(score_happy DESC, song_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_song_mood_scores_sad ON song_mood_scores(score_sad DESC, song_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_song_mood_scores_sleep ON song_mood_scores(score_sleep DESC, song_id);

CREATE OR REPLACE FUNCTION refresh_song_mood_scores(p_song_id INT DEFAULT NULL)
RETURNS INTEGER AS $$
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
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_refresh_song_mood_scores()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM refresh_song_mood_scores(NEW.song_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_song_features_refresh_mood_scores ON song_features;
CREATE TRIGGER trg_song_features_refresh_mood_scores
AFTER INSERT OR UPDATE OF tempo, energy, valence, danceability, speechiness ON song_features
FOR EACH ROW EXECUTE FUNCTION trg_refresh_song_mood_scores();

CREATE TABLE IF NOT EXISTS user_daily_recommendations (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  song_id INT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  rank INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, song_id)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_daily_recommendations_user_rank ON user_daily_recommendations(user_id, rank);

CREATE TABLE IF NOT EXISTS statistics_cache (
  entity_type TEXT NOT NULL,
  uploader_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_value TEXT NOT NULL,
  track_count INT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (entity_type, uploader_id, entity_value)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_statistics_cache_type_uploader_count ON statistics_cache(entity_type, uploader_id, track_count DESC, entity_value);

CREATE OR REPLACE FUNCTION refresh_statistics_cache()
RETURNS INTEGER AS $$
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
$$ LANGUAGE plpgsql;
