-- Waveform backfill: mark existing tracks without peaks for processing.
-- One-time migration for tracks uploaded before waveform_peaks column was added.
-- Run via: docker exec music-postgres psql -U $DB_USER -d $DB_NAME -f /tmp/backfill-waveform-status.sql

BEGIN;

SELECT count(*) AS tracks_to_backfill
FROM songs
WHERE waveform_peaks IS NULL
  AND is_available = true
  AND (waveform_status IS NULL OR waveform_status IS DISTINCT FROM 'pending');

UPDATE songs
SET waveform_status = 'pending',
    updated_at = NOW()
WHERE waveform_peaks IS NULL
  AND is_available = true
  AND (waveform_status IS NULL OR waveform_status IS DISTINCT FROM 'pending');

COMMIT;
