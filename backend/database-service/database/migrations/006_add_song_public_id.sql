-- Add public_id to songs: opaque token for public URL exposure (TrackSync step 1).
-- Apply: psql $DATABASE_URL -f backend/database-service/database/migrations/006_add_song_public_id.sql

ALTER TABLE songs
  ADD COLUMN IF NOT EXISTS public_id TEXT UNIQUE DEFAULT encode(gen_random_bytes(8), 'hex');

UPDATE songs
SET public_id = encode(gen_random_bytes(8), 'hex')
WHERE public_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_songs_public_id ON songs(public_id);

COMMENT ON COLUMN songs.public_id IS 'Opaque public identifier for Earflow share URLs — replaces numeric DB id in external paths.';
