-- Migration: 014_songs_available_popularity_index
-- Description: Partial index for loadPopularIds CTE scan.
-- Without this, Postgres may choose Seq Scan on songs when
-- filtering COALESCE(is_available, true) = true and sorting by popularity.
-- The partial index pre-filters available songs, reducing scan size by
-- the fraction of unavailable tracks (typically 5-20%) and allowing
-- index-only scans for the ORDER BY + LIMIT inside the CTE.

CREATE INDEX IF NOT EXISTS idx_songs_avail_pop_pc
    ON songs (popularity DESC NULLS LAST, play_count DESC NULLS LAST)
    WHERE is_available IS DISTINCT FROM false;

ANALYZE songs;
