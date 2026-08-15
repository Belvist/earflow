package indexer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/earflow/music-platform/search-service/internal/meili"
	"github.com/earflow/music-platform/search-service/internal/textnorm"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/sync/errgroup"
)

type Config struct {
	DB           *pgxpool.Pool
	Meili        *meili.Client
	Logger       *slog.Logger
	NodeID       string
	Batch        int
	LockTTL      time.Duration
	BaseBackoff  time.Duration
	MaxBackoff   time.Duration
	Backfill     bool
	SetupIndexes bool
}

type Indexer struct {
	db           *pgxpool.Pool
	meili        *meili.Client
	logger       *slog.Logger
	nodeID       string
	batch        int
	lockTTL      time.Duration
	baseBackoff  time.Duration
	maxBackoff   time.Duration
	backfill     bool
	setupIndexes bool
}

const (
	searchSetupAdvisoryLockKey    int64 = 4316200101
	searchBackfillAdvisoryLockKey int64 = 4316200102
)

func New(cfg Config) *Indexer {
	return &Indexer{
		db:           cfg.DB,
		meili:        cfg.Meili,
		logger:       cfg.Logger,
		nodeID:       cfg.NodeID,
		batch:        cfg.Batch,
		lockTTL:      cfg.LockTTL,
		baseBackoff:  cfg.BaseBackoff,
		maxBackoff:   cfg.MaxBackoff,
		backfill:     cfg.Backfill,
		setupIndexes: cfg.SetupIndexes,
	}
}

func (i *Indexer) Run(ctx context.Context) error {
	if i.setupIndexes {
		unlock, ok, err := i.tryAdvisoryLock(ctx, searchSetupAdvisoryLockKey)
		if err != nil {
			i.logger.Error("meili settings lock failed", slog.String("err", err.Error()))
		} else if ok {
			if err := i.ensureIndexSettings(ctx); err != nil {
				i.logger.Error("meili settings failed", slog.String("err", err.Error()))
			}
			unlock(context.Background())
		} else {
			i.logger.Info("meili settings skipped; another search replica owns startup setup")
		}
	}

	if i.backfill {
		unlock, ok, err := i.tryAdvisoryLock(ctx, searchBackfillAdvisoryLockKey)
		if err != nil {
			i.logger.Error("backfill lock failed", slog.String("err", err.Error()))
		} else if ok {
			if err := i.backfillOnce(ctx); err != nil {
				i.logger.Error("backfill failed", slog.String("err", err.Error()))
			}
			unlock(context.Background())
		} else {
			i.logger.Info("backfill skipped; another search replica owns startup backfill")
		}
	}

	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			jobs, err := i.lockBatch(ctx)
			if err != nil {
				continue
			}
			if len(jobs) == 0 {
				continue
			}
			_ = i.processBatch(ctx, jobs)
		}
	}
}

func (i *Indexer) tryAdvisoryLock(ctx context.Context, key int64) (func(context.Context), bool, error) {
	conn, err := i.db.Acquire(ctx)
	if err != nil {
		return nil, false, err
	}

	tx, err := conn.Begin(ctx)
	if err != nil {
		conn.Release()
		return nil, false, err
	}

	var ok bool
	if err := tx.QueryRow(ctx, `SELECT pg_try_advisory_xact_lock($1)`, key).Scan(&ok); err != nil {
		_ = tx.Rollback(context.Background())
		conn.Release()
		return nil, false, err
	}
	if !ok {
		_ = tx.Rollback(context.Background())
		conn.Release()
		return func(context.Context) {}, false, nil
	}
	return func(unlockCtx context.Context) {
		if err := tx.Commit(unlockCtx); err != nil {
			_ = tx.Rollback(context.Background())
			i.logger.Warn("failed to release search advisory transaction lock", slog.Int64("key", key), slog.String("err", err.Error()))
		}
		conn.Release()
	}, true, nil
}

type job struct {
	EntityType string
	EntityID   int64
	Op         string
	Hints      map[string]any
	Attempts   int
}

func (i *Indexer) lockBatch(ctx context.Context) ([]job, error) {
	lockTTL := i.lockTTL
	if lockTTL <= 0 {
		lockTTL = 60 * time.Second
	}

	q := `
WITH cte AS (
  SELECT entity_type, entity_id
    FROM search_outbox_queue
   WHERE next_attempt_at <= NOW()
     AND (locked_at IS NULL OR locked_at < NOW() - $1::interval)
   ORDER BY updated_at ASC
   LIMIT $2
   FOR UPDATE SKIP LOCKED
)
UPDATE search_outbox_queue q
   SET locked_at = NOW(),
       locked_by = $3
  FROM cte
 WHERE q.entity_type = cte.entity_type AND q.entity_id = cte.entity_id
 RETURNING q.entity_type, q.entity_id, q.op, q.hints, q.attempts;
`
	interval := fmt.Sprintf("%d seconds", int(lockTTL.Seconds()))
	rows, err := i.db.Query(ctx, q, interval, i.batch, i.nodeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]job, 0, i.batch)
	for rows.Next() {
		var t string
		var id int64
		var op string
		var hintsBytes []byte
		var attempts int
		if err := rows.Scan(&t, &id, &op, &hintsBytes, &attempts); err != nil {
			continue
		}
		hints := map[string]any{}
		if len(hintsBytes) > 0 {
			_ = json.Unmarshal(hintsBytes, &hints)
		}
		out = append(out, job{EntityType: t, EntityID: id, Op: op, Hints: hints, Attempts: attempts})
	}
	return out, nil
}

func (i *Indexer) processBatch(ctx context.Context, jobs []job) error {
	g, ctx := errgroup.WithContext(ctx)
	for _, j := range jobs {
		jj := j
		g.Go(func() error {
			if err := i.processOne(ctx, jj); err != nil {
				i.releaseWithBackoff(ctx, jj, err)
				return nil
			}
			i.ack(ctx, jj)
			return nil
		})
	}
	_ = g.Wait()
	return nil
}

func (i *Indexer) processOne(ctx context.Context, j job) error {
	switch j.EntityType {
	case "song":
		return i.processSong(ctx, j)
	case "artist":
		return i.processArtist(ctx, j)
	case "album":
		return i.processAlbum(ctx, j)
	default:
		return nil
	}
}

func (i *Indexer) processSong(ctx context.Context, j job) error {
	if j.Op == "delete" {
		_, _ = i.meili.IndexTracks().DeleteDocument(strconv.FormatInt(j.EntityID, 10))
		if prevArtist, ok := j.Hints["prev_artist"].(string); ok {
			_ = i.reindexArtistByName(ctx, prevArtist)
		}
		if prevAlbum, ok := j.Hints["prev_album"].(string); ok {
			if prevArtist, ok2 := j.Hints["prev_artist"].(string); ok2 {
				_ = i.reindexAlbumByNames(ctx, prevArtist, prevAlbum)
			}
		}
		return nil
	}

	row, err := i.fetchSong(ctx, j.EntityID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			_, _ = i.meili.IndexTracks().DeleteDocument(strconv.FormatInt(j.EntityID, 10))
			return nil
		}
		return err
	}

	_, err = i.meili.IndexTracks().AddDocuments([]any{row})
	if err != nil {
		return err
	}

	_ = i.reindexArtistByName(ctx, row.Artist)
	if row.Album != "" {
		_ = i.reindexAlbumByNames(ctx, row.Artist, row.Album)
	}

	if prevArtist, ok := j.Hints["prev_artist"].(string); ok {
		if strings.TrimSpace(prevArtist) != "" && !strings.EqualFold(prevArtist, row.Artist) {
			_ = i.reindexArtistByName(ctx, prevArtist)
		}
	}
	if prevAlbum, ok := j.Hints["prev_album"].(string); ok {
		pa := ""
		if prevArtist, ok2 := j.Hints["prev_artist"].(string); ok2 {
			pa = prevArtist
		}
		if strings.TrimSpace(prevAlbum) != "" && strings.TrimSpace(pa) != "" {
			if !strings.EqualFold(prevAlbum, row.Album) || !strings.EqualFold(pa, row.Artist) {
				_ = i.reindexAlbumByNames(ctx, pa, prevAlbum)
			}
		}
	}

	return nil
}

type trackDoc struct {
	ID             int64   `json:"id"`
	PublicID       *string `json:"public_id,omitempty"`
	Title          string  `json:"title"`
	Artist         string  `json:"artist"`
	Album          string  `json:"album"`
	Duration       *int    `json:"duration"`
	Genre          *string `json:"genre"`
	Year           *int    `json:"year"`
	CoverPath      *string `json:"cover_path"`
	HasEbap        bool    `json:"has_ebap"`
	PlayCount      int     `json:"play_count"`
	Popularity     int     `json:"popularity"`
	SearchText     string  `json:"searchText"`
	TitleNorm      string  `json:"titleNorm"`
	ArtistNorm     string  `json:"artistNorm"`
	AlbumNorm      string  `json:"albumNorm"`
	GenreNorm      string  `json:"genreNorm,omitempty"`
	YearText       string  `json:"yearText,omitempty"`
	TitleTranslit  string  `json:"titleTranslit,omitempty"`
	ArtistTranslit string  `json:"artistTranslit,omitempty"`
	AlbumTranslit  string  `json:"albumTranslit,omitempty"`
	GenreTranslit  string  `json:"genreTranslit,omitempty"`
}

func (i *Indexer) fetchSong(ctx context.Context, id int64) (trackDoc, error) {
	q := `
SELECT id,
       public_id,
       title,
       artist,
       COALESCE(album, '') AS album,
       duration,
       genre,
       year,
       cover_path,
       COALESCE(has_ebap, false) AS has_ebap,
       COALESCE(play_count, 0) AS play_count,
       COALESCE(popularity, 0) AS popularity
  FROM songs
 WHERE id = $1
   AND COALESCE(is_available, true) = true
 LIMIT 1;
`
	var d trackDoc
	var duration *int
	var genre *string
	var year *int
	var cover *string
	if err := i.db.QueryRow(ctx, q, id).Scan(&d.ID, &d.PublicID, &d.Title, &d.Artist, &d.Album, &duration, &genre, &year, &cover, &d.HasEbap, &d.PlayCount, &d.Popularity); err != nil {
		return trackDoc{}, err
	}
	d.Duration = duration
	d.Genre = genre
	d.Year = year
	d.CoverPath = cover
	enrichTrackDoc(&d)
	return d, nil
}

func (i *Indexer) processArtist(ctx context.Context, j job) error {
	doc, err := i.buildArtistDocByID(ctx, j.EntityID)
	if err != nil {
		return nil
	}
	_, err = i.meili.IndexArtists().AddDocuments([]any{doc})
	return err
}

func (i *Indexer) buildArtistDocByID(ctx context.Context, id int64) (map[string]any, error) {
	q := `
SELECT a.id,
       a.public_id,
       a.name,
       a.is_verified,
       a.hero_cover_path
  FROM artists a
 WHERE a.id = $1
 LIMIT 1;
`
	var artistID int64
	var publicID *string
	var name string
	var verified bool
	var hero *string
	if err := i.db.QueryRow(ctx, q, id).Scan(&artistID, &publicID, &name, &verified, &hero); err != nil {
		return nil, err
	}

	meta, _ := i.artistStats(ctx, name)
	doc := map[string]any{
		"id":             normalizeKey(name),
		"artistName":     name,
		"artistPublicId": publicID,
		"isVerified":     verified,
		"heroCoverPath":  hero,
		"trackCount":     meta.trackCount,
	}
	if meta.totalPlays != nil {
		doc["totalPlays"] = *meta.totalPlays
	}
	enrichArtistDoc(doc, name)
	return doc, nil
}

type artistMeta struct {
	trackCount int
	totalPlays *int64
}

func (i *Indexer) artistStats(ctx context.Context, artistName string) (artistMeta, error) {
	q := `
SELECT COUNT(*)::int AS track_count,
       COALESCE(SUM(play_count), 0)::bigint AS total_plays
  FROM songs
 WHERE lower(artist) = lower($1)
   AND COALESCE(is_available, true) = true;
`
	var tc int
	var plays int64
	if err := i.db.QueryRow(ctx, q, artistName).Scan(&tc, &plays); err != nil {
		return artistMeta{}, err
	}
	p := plays
	return artistMeta{trackCount: tc, totalPlays: &p}, nil
}

func (i *Indexer) reindexArtistByName(ctx context.Context, artistName string) error {
	name := strings.TrimSpace(artistName)
	if name == "" {
		return nil
	}

	cardQ := `
SELECT public_id, is_verified, hero_cover_path
  FROM artists
 WHERE name_key = lower(regexp_replace(btrim($1), '\\s+', ' ', 'g'))
 LIMIT 1;
`
	var publicID *string
	var verified bool
	var hero *string
	_ = i.db.QueryRow(ctx, cardQ, name).Scan(&publicID, &verified, &hero)

	stats, err := i.artistStats(ctx, name)
	if err != nil {
		return nil
	}
	if stats.trackCount <= 0 {
		_, _ = i.meili.IndexArtists().DeleteDocument(normalizeKey(name))
		return nil
	}
	doc := map[string]any{
		"id":             normalizeKey(name),
		"artistName":     name,
		"artistPublicId": publicID,
		"isVerified":     verified,
		"heroCoverPath":  hero,
		"trackCount":     stats.trackCount,
		"totalPlays":     *stats.totalPlays,
	}
	enrichArtistDoc(doc, name)
	_, err = i.meili.IndexArtists().AddDocuments([]any{doc})
	return err
}

func (i *Indexer) processAlbum(ctx context.Context, j job) error {
	doc, err := i.buildAlbumDocByID(ctx, j.EntityID)
	if err != nil {
		return nil
	}
	_, err = i.meili.IndexAlbums().AddDocuments([]any{doc})
	return err
}

func (i *Indexer) buildAlbumDocByID(ctx context.Context, id int64) (map[string]any, error) {
	q := `
SELECT a.public_id,
       a.name,
       ar.public_id,
       ar.name
  FROM albums a
  JOIN artists ar ON ar.id = a.artist_id
 WHERE a.id = $1
 LIMIT 1;
`
	var albumPID *string
	var albumName string
	var artistPID *string
	var artistName string
	if err := i.db.QueryRow(ctx, q, id).Scan(&albumPID, &albumName, &artistPID, &artistName); err != nil {
		return nil, err
	}

	meta, _ := i.albumStats(ctx, artistName, albumName)
	doc := map[string]any{
		"id":             albumKey(artistName, albumName),
		"albumName":      albumName,
		"albumPublicId":  albumPID,
		"artistName":     artistName,
		"artistPublicId": artistPID,
		"trackCount":     meta.trackCount,
		"totalPlays":     *meta.totalPlays,
	}
	if meta.year != nil {
		doc["year"] = *meta.year
	}
	if meta.heroCoverPath != nil {
		doc["heroCoverPath"] = *meta.heroCoverPath
	}
	enrichAlbumDoc(doc, artistName, albumName, meta.year)
	return doc, nil
}

type albumMeta struct {
	trackCount    int
	totalPlays    *int64
	year          *int
	heroCoverPath *string
}

func (i *Indexer) albumStats(ctx context.Context, artistName, albumName string) (albumMeta, error) {
	q := `
SELECT COUNT(*)::int AS track_count,
       COALESCE(SUM(play_count), 0)::bigint AS total_plays,
       MAX(year)::int AS year,
       (
         SELECT s2.cover_path
           FROM songs s2
          WHERE lower(s2.artist) = lower($1)
            AND lower(btrim(COALESCE(s2.album, ''))) = lower($2)
            AND s2.cover_path IS NOT NULL
            AND btrim(s2.cover_path) <> ''
            AND COALESCE(s2.is_available, true) = true
          ORDER BY s2.play_count DESC NULLS LAST, s2.popularity DESC NULLS LAST, s2.created_at DESC
          LIMIT 1
       ) AS hero_cover_path
  FROM songs s
 WHERE lower(s.artist) = lower($1)
   AND lower(btrim(COALESCE(s.album, ''))) = lower($2)
   AND COALESCE(s.is_available, true) = true;
`
	var tc int
	var plays int64
	var year *int
	var hero *string
	if err := i.db.QueryRow(ctx, q, artistName, albumName).Scan(&tc, &plays, &year, &hero); err != nil {
		return albumMeta{}, err
	}
	p := plays
	return albumMeta{trackCount: tc, totalPlays: &p, year: year, heroCoverPath: hero}, nil
}

func (i *Indexer) reindexAlbumByNames(ctx context.Context, artistName, albumName string) error {
	a := strings.TrimSpace(artistName)
	al := strings.TrimSpace(albumName)
	if a == "" || al == "" {
		return nil
	}

	meta, err := i.albumStats(ctx, a, al)
	if err != nil {
		return nil
	}
	if meta.trackCount <= 0 {
		_, _ = i.meili.IndexAlbums().DeleteDocument(albumKey(a, al))
		return nil
	}

	pidsQ := `
SELECT al.public_id, ar.public_id
  FROM albums al
  JOIN artists ar ON ar.id = al.artist_id
 WHERE lower(al.name_key) = lower(regexp_replace(btrim($2), '\\s+', ' ', 'g'))
   AND ar.name_key = lower(regexp_replace(btrim($1), '\\s+', ' ', 'g'))
 LIMIT 1;
`
	var albumPID *string
	var artistPID *string
	_ = i.db.QueryRow(ctx, pidsQ, a, al).Scan(&albumPID, &artistPID)

	doc := map[string]any{
		"id":             albumKey(a, al),
		"albumName":      al,
		"albumPublicId":  albumPID,
		"artistName":     a,
		"artistPublicId": artistPID,
		"trackCount":     meta.trackCount,
		"totalPlays":     *meta.totalPlays,
	}
	if meta.year != nil {
		doc["year"] = *meta.year
	}
	if meta.heroCoverPath != nil {
		doc["heroCoverPath"] = *meta.heroCoverPath
	}
	enrichAlbumDoc(doc, a, al, meta.year)

	_, err = i.meili.IndexAlbums().AddDocuments([]any{doc})
	return err
}

func enrichTrackDoc(d *trackDoc) {
	if d == nil {
		return
	}

	genre := ""
	if d.Genre != nil {
		genre = *d.Genre
	}

	if d.Year != nil {
		d.YearText = strconv.Itoa(*d.Year)
	}

	d.TitleNorm = normalizeIndexText(d.Title)
	d.ArtistNorm = normalizeIndexText(d.Artist)
	d.AlbumNorm = normalizeIndexText(d.Album)
	d.GenreNorm = normalizeIndexText(genre)
	d.TitleTranslit = textnorm.TransliterateCyrillic(d.Title)
	d.ArtistTranslit = textnorm.TransliterateCyrillic(d.Artist)
	d.AlbumTranslit = textnorm.TransliterateCyrillic(d.Album)
	d.GenreTranslit = textnorm.TransliterateCyrillic(genre)
	d.SearchText = joinSearchTerms(
		d.Title,
		d.Artist,
		d.Album,
		genre,
		d.YearText,
		d.TitleNorm,
		d.ArtistNorm,
		d.AlbumNorm,
		d.GenreNorm,
		d.TitleTranslit,
		d.ArtistTranslit,
		d.AlbumTranslit,
		d.GenreTranslit,
	)
}

func enrichArtistDoc(doc map[string]any, artistName string) {
	if doc == nil {
		return
	}

	norm := normalizeIndexText(artistName)
	translit := textnorm.TransliterateCyrillic(artistName)
	doc["artistNameNorm"] = norm
	if translit != "" {
		doc["artistNameTranslit"] = translit
	}
	doc["searchText"] = joinSearchTerms(artistName, norm, translit)
}

func enrichAlbumDoc(doc map[string]any, artistName, albumName string, year *int) {
	if doc == nil {
		return
	}

	albumNorm := normalizeIndexText(albumName)
	artistNorm := normalizeIndexText(artistName)
	albumTranslit := textnorm.TransliterateCyrillic(albumName)
	artistTranslit := textnorm.TransliterateCyrillic(artistName)
	yearText := ""
	if year != nil {
		yearText = strconv.Itoa(*year)
		doc["yearText"] = yearText
	}

	doc["albumNameNorm"] = albumNorm
	doc["artistNameNorm"] = artistNorm
	if albumTranslit != "" {
		doc["albumNameTranslit"] = albumTranslit
	}
	if artistTranslit != "" {
		doc["artistNameTranslit"] = artistTranslit
	}
	doc["searchText"] = joinSearchTerms(albumName, artistName, yearText, albumNorm, artistNorm, albumTranslit, artistTranslit)
}

func normalizeIndexText(value string) string {
	norm := textnorm.NormalizeQuery(value)
	if norm == "" {
		return ""
	}
	simplified := textnorm.SimplifySeparators(norm)
	if simplified != "" {
		return simplified
	}
	return norm
}

func joinSearchTerms(values ...string) string {
	out := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, raw := range values {
		v := strings.Join(strings.Fields(strings.TrimSpace(raw)), " ")
		if v == "" {
			continue
		}
		key := strings.ToLower(v)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, v)
	}
	return strings.Join(out, " ")
}

func normalizeKey(name string) string {
	fields := strings.Fields(strings.ToLower(strings.TrimSpace(name)))
	if len(fields) == 0 {
		return ""
	}
	k := strings.Join(fields, " ")
	if len(k) > 255 {
		k = k[:255]
	}
	return k
}

func albumKey(artistName, albumName string) string {
	return normalizeKey(artistName) + "::" + normalizeKey(albumName)
}

func (i *Indexer) ack(ctx context.Context, j job) {
	_, _ = i.db.Exec(ctx, `DELETE FROM search_outbox_queue WHERE entity_type = $1 AND entity_id = $2`, j.EntityType, j.EntityID)
}

func (i *Indexer) releaseWithBackoff(ctx context.Context, j job, cause error) {
	attempts := j.Attempts + 1
	backoff := i.computeBackoff(attempts)
	next := time.Now().Add(backoff)
	_, _ = i.db.Exec(ctx, `UPDATE search_outbox_queue SET attempts = $3, next_attempt_at = $4, locked_at = NULL, locked_by = NULL, updated_at = NOW() WHERE entity_type = $1 AND entity_id = $2`, j.EntityType, j.EntityID, attempts, next)
	_ = cause
}

func (i *Indexer) computeBackoff(attempts int) time.Duration {
	base := i.baseBackoff
	if base <= 0 {
		base = time.Second
	}
	max := i.maxBackoff
	if max <= 0 {
		max = 5 * time.Minute
	}
	x := float64(base) * math.Pow(2, float64(attempts-1))
	d := time.Duration(x)
	if d > max {
		return max
	}
	if d < base {
		return base
	}
	return d
}

func (i *Indexer) ensureIndexSettings(ctx context.Context) error {
	rankingTracks := []string{"words", "typo", "proximity", "attribute", "sort", "exactness", "popularity:desc", "play_count:desc"}
	searchableTracks := []string{"title", "artist", "album", "genre", "yearText", "searchText", "titleNorm", "artistNorm", "albumNorm", "genreNorm", "titleTranslit", "artistTranslit", "albumTranslit", "genreTranslit"}
	filterableTracks := []string{"has_ebap", "genre", "year"}
	sortableTracks := []string{"popularity", "play_count"}
	interval := 100 * time.Millisecond

	tracks := i.meili.IndexTracks()
	if t, err := tracks.UpdateRankingRules(&rankingTracks); err == nil && t != nil {
		_, _ = i.meili.Raw().WaitForTask(t.TaskUID, interval)
	}
	if t, err := tracks.UpdateSearchableAttributes(&searchableTracks); err == nil && t != nil {
		_, _ = i.meili.Raw().WaitForTask(t.TaskUID, interval)
	}
	if t, err := tracks.UpdateFilterableAttributes(&filterableTracks); err == nil && t != nil {
		_, _ = i.meili.Raw().WaitForTask(t.TaskUID, interval)
	}
	if t, err := tracks.UpdateSortableAttributes(&sortableTracks); err == nil && t != nil {
		_, _ = i.meili.Raw().WaitForTask(t.TaskUID, interval)
	}

	rankingArtists := []string{"words", "typo", "proximity", "attribute", "sort", "exactness", "trackCount:desc", "totalPlays:desc"}
	searchableArtists := []string{"artistName", "artistNameNorm", "artistNameTranslit", "searchText"}
	artists := i.meili.IndexArtists()
	if t, err := artists.UpdateRankingRules(&rankingArtists); err == nil && t != nil {
		_, _ = i.meili.Raw().WaitForTask(t.TaskUID, interval)
	}
	if t, err := artists.UpdateSearchableAttributes(&searchableArtists); err == nil && t != nil {
		_, _ = i.meili.Raw().WaitForTask(t.TaskUID, interval)
	}

	rankingAlbums := []string{"words", "typo", "proximity", "attribute", "sort", "exactness", "trackCount:desc", "totalPlays:desc"}
	searchableAlbums := []string{"albumName", "artistName", "albumNameNorm", "artistNameNorm", "albumNameTranslit", "artistNameTranslit", "yearText", "searchText"}
	albums := i.meili.IndexAlbums()
	if t, err := albums.UpdateRankingRules(&rankingAlbums); err == nil && t != nil {
		_, _ = i.meili.Raw().WaitForTask(t.TaskUID, interval)
	}
	if t, err := albums.UpdateSearchableAttributes(&searchableAlbums); err == nil && t != nil {
		_, _ = i.meili.Raw().WaitForTask(t.TaskUID, interval)
	}
	return nil
}

func (i *Indexer) backfillOnce(ctx context.Context) error {
	if err := i.backfillTracks(ctx); err != nil {
		return err
	}
	_ = i.backfillArtistsFromSongs(ctx)
	_ = i.backfillAlbumsFromSongs(ctx)
	_ = i.backfillArtistCards(ctx)
	_ = i.backfillAlbumCards(ctx)
	return nil
}

func (i *Indexer) backfillTracks(ctx context.Context) error {
	lastID := int64(0)
	for {
		rows, err := i.db.Query(ctx, `
SELECT id
  FROM songs
 WHERE id > $1
   AND COALESCE(is_available, true) = true
 ORDER BY id ASC
 LIMIT 500`, lastID)
		if err != nil {
			return err
		}
		ids := make([]int64, 0, 500)
		for rows.Next() {
			var id int64
			if err := rows.Scan(&id); err == nil {
				ids = append(ids, id)
			}
		}
		rows.Close()
		if len(ids) == 0 {
			return nil
		}

		docs := make([]any, 0, len(ids))
		for _, id := range ids {
			d, err := i.fetchSong(ctx, id)
			if err == nil {
				docs = append(docs, d)
			}
			lastID = id
		}
		if len(docs) > 0 {
			_, _ = i.meili.IndexTracks().AddDocuments(docs)
		}
	}
}

func (i *Indexer) backfillArtistsFromSongs(ctx context.Context) error {
	rows, err := i.db.Query(ctx, `
SELECT DISTINCT artist
  FROM songs
 WHERE artist IS NOT NULL
   AND btrim(artist) <> ''
   AND COALESCE(is_available, true) = true
 LIMIT 200000`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			continue
		}
		_ = i.reindexArtistByName(ctx, name)
	}
	return nil
}

func (i *Indexer) backfillAlbumsFromSongs(ctx context.Context) error {
	rows, err := i.db.Query(ctx, `
SELECT DISTINCT artist, album
  FROM songs
 WHERE artist IS NOT NULL
   AND btrim(artist) <> ''
   AND album IS NOT NULL
   AND btrim(album) <> ''
   AND COALESCE(is_available, true) = true
 LIMIT 200000`)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var a, al string
		if err := rows.Scan(&a, &al); err != nil {
			continue
		}
		_ = i.reindexAlbumByNames(ctx, a, al)
	}
	return nil
}

func (i *Indexer) backfillArtistCards(ctx context.Context) error {
	rows, err := i.db.Query(ctx, `SELECT id FROM artists ORDER BY id ASC`)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			continue
		}
		_ = i.processArtist(ctx, job{EntityType: "artist", EntityID: id, Op: "upsert"})
	}
	return nil
}

func (i *Indexer) backfillAlbumCards(ctx context.Context) error {
	rows, err := i.db.Query(ctx, `SELECT id FROM albums ORDER BY id ASC`)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			continue
		}
		_ = i.processAlbum(ctx, job{EntityType: "album", EntityID: id, Op: "upsert"})
	}
	return nil
}
