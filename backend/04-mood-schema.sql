CREATE TABLE IF NOT EXISTS song_moods (
    id            SERIAL PRIMARY KEY,
    song_id       INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    mood          VARCHAR(64) NOT NULL,
    confidence    REAL NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
    source        VARCHAR(32) NOT NULL DEFAULT 'auto',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_song_moods_song_mood ON song_moods(song_id, mood);
CREATE INDEX IF NOT EXISTS idx_song_moods_mood ON song_moods(mood);

CREATE TABLE IF NOT EXISTS user_mood_profile (
    id            SERIAL PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    mood_vector   JSONB NOT NULL DEFAULT '{}',
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_mood_profile_user ON user_mood_profile(user_id);

INSERT INTO song_moods (song_id, mood, confidence, source)
SELECT s.id, 
       CASE 
           WHEN s.genre ILIKE '%rock%' OR s.genre ILIKE '%metal%' THEN 'energetic'
           WHEN s.genre ILIKE '%jazz%' OR s.genre ILIKE '%classical%' THEN 'calm'
           WHEN s.genre ILIKE '%pop%' OR s.genre ILIKE '%dance%' THEN 'happy'
           WHEN s.genre ILIKE '%blues%' OR s.genre ILIKE '%sad%' THEN 'melancholic'
           ELSE 'neutral'
       END,
       0.6,
       'genre_heuristic'
FROM songs s
WHERE NOT EXISTS (SELECT 1 FROM song_moods sm WHERE sm.song_id = s.id)
ON CONFLICT (song_id, mood) DO NOTHING;
