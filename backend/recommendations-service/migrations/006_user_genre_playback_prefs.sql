CREATE TABLE IF NOT EXISTS user_genre_playback_prefs (
  user_id INT NOT NULL,
  genre TEXT NOT NULL,
  playback_rate REAL NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_genre_playback_prefs_pk PRIMARY KEY (user_id, genre),
  CONSTRAINT user_genre_playback_rate_range_chk CHECK (playback_rate >= 0.5 AND playback_rate <= 2.0),
  CONSTRAINT user_genre_playback_genre_len_chk CHECK (char_length(genre) > 0 AND char_length(genre) <= 100)
);

CREATE INDEX IF NOT EXISTS user_genre_playback_prefs_user_id_idx
  ON user_genre_playback_prefs (user_id);
