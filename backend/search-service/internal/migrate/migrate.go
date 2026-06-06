package migrate

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Migrator struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Migrator {
	return &Migrator{pool: pool}
}

func (m *Migrator) Apply(ctx context.Context) error {
	_, err := m.pool.Exec(ctx, schemaSQL)
	return err
}

const schemaSQL = `
CREATE TABLE IF NOT EXISTS search_outbox_queue (
  entity_type TEXT NOT NULL,
  entity_id BIGINT NOT NULL,
  op TEXT NOT NULL,
  hints JSONB,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_search_outbox_next_attempt ON search_outbox_queue (next_attempt_at, updated_at);

CREATE OR REPLACE FUNCTION search_enqueue(_entity_type TEXT, _entity_id BIGINT, _op TEXT, _hints JSONB)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO search_outbox_queue(entity_type, entity_id, op, hints, next_attempt_at, updated_at)
  VALUES (_entity_type, _entity_id, _op, _hints, NOW(), NOW())
  ON CONFLICT (entity_type, entity_id)
  DO UPDATE SET
    op = EXCLUDED.op,
    hints = COALESCE(EXCLUDED.hints, search_outbox_queue.hints),
    next_attempt_at = NOW(),
    updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION search_outbox_song_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  _hints JSONB;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    PERFORM search_enqueue('song', OLD.id, 'delete', NULL);
    RETURN OLD;
  END IF;

  _hints := NULL;
  IF (TG_OP = 'UPDATE') THEN
    IF (COALESCE(OLD.artist, '') <> COALESCE(NEW.artist, '')) OR (COALESCE(OLD.album, '') <> COALESCE(NEW.album, '')) THEN
      _hints := jsonb_build_object('prev_artist', OLD.artist, 'prev_album', OLD.album);
    END IF;
  END IF;

  PERFORM search_enqueue('song', NEW.id, 'upsert', _hints);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_search_outbox_songs ON songs;
CREATE TRIGGER trg_search_outbox_songs
AFTER INSERT OR UPDATE OR DELETE ON songs
FOR EACH ROW EXECUTE FUNCTION search_outbox_song_trigger();

CREATE OR REPLACE FUNCTION search_outbox_artist_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM search_enqueue('artist', NEW.id, 'upsert', NULL);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_search_outbox_artists ON artists;
CREATE TRIGGER trg_search_outbox_artists
AFTER INSERT OR UPDATE ON artists
FOR EACH ROW EXECUTE FUNCTION search_outbox_artist_trigger();

CREATE OR REPLACE FUNCTION search_outbox_album_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM search_enqueue('album', NEW.id, 'upsert', NULL);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_search_outbox_albums ON albums;
CREATE TRIGGER trg_search_outbox_albums
AFTER INSERT OR UPDATE ON albums
FOR EACH ROW EXECUTE FUNCTION search_outbox_album_trigger();
`
