BEGIN;

ALTER TABLE songs
  ADD COLUMN IF NOT EXISTS transcode_status VARCHAR(20) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS transcode_error TEXT,
  ADD COLUMN IF NOT EXISTS quality_variants JSONB;

CREATE INDEX IF NOT EXISTS idx_songs_transcode_status ON songs (transcode_status, id);
CREATE INDEX IF NOT EXISTS idx_songs_quality_variants ON songs (id) WHERE quality_variants IS NOT NULL;

COMMIT;
