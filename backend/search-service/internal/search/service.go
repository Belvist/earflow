package search

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/earflow/music-platform/search-service/internal/meili"
	"github.com/earflow/music-platform/search-service/internal/textnorm"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/meilisearch/meilisearch-go"
	"github.com/sony/gobreaker/v2"
)

var (
	artistFeatureMarkerRe = regexp.MustCompile(`(?i)\s+(?:feat\.?|ft\.?|featuring|with)\b[\s\S]*$`)
	artistSeparatorRe     = regexp.MustCompile(`(?i)\s*(?:;|,|&|/|×|\bx\b|\band\b)\s*`)
)

type ServiceConfig struct {
	Meili          *meili.Client
	DB             *pgxpool.Pool
	Logger         any
	PublicMaxLimit int
	AuthedMaxLimit int
}

type Service struct {
	meili          *meili.Client
	db             *pgxpool.Pool
	logger         any
	publicMaxLimit int
	authedMaxLimit int
	cb             *gobreaker.CircuitBreaker[Response]
	slowThreshold  time.Duration
}

func NewService(cfg ServiceConfig) *Service {
	st := gobreaker.Settings{
		Name:        "meilisearch",
		MaxRequests: 5,
		Interval:    30 * time.Second,
		Timeout:     10 * time.Second,
		ReadyToTrip: func(counts gobreaker.Counts) bool {
			if counts.Requests < 20 {
				return false
			}
			failureRatio := float64(counts.TotalFailures) / float64(counts.Requests)
			return failureRatio >= 0.5
		},
		IsSuccessful: func(err error) bool {
			return err == nil || errors.Is(err, context.Canceled)
		},
	}

	return &Service{
		meili:          cfg.Meili,
		db:             cfg.DB,
		logger:         cfg.Logger,
		publicMaxLimit: cfg.PublicMaxLimit,
		authedMaxLimit: cfg.AuthedMaxLimit,
		cb:             gobreaker.NewCircuitBreaker[Response](st),
		slowThreshold:  0,
	}
}

func (s *Service) Search(ctx context.Context, req Request) (Response, error) {
	norm := textnorm.NormalizeQuery(req.Query)
	limit := req.Limit
	if limit <= 0 {
		if req.IsAuthed {
			limit = 20
		} else {
			limit = 12
		}
	}
	max := s.publicMaxLimit
	if req.IsAuthed {
		max = s.authedMaxLimit
	}
	if limit > max {
		limit = max
	}
	if req.Offset < 0 {
		req.Offset = 0
	}
	if req.Offset > 200 {
		req.Offset = 200
	}
	if norm == "" {
		recs, err := s.Recommendations(ctx, limit)
		if err != nil {
			return Response{}, err
		}
		return Response{
			Query:           req.Query,
			Normalized:      norm,
			Tracks:          []Track{},
			Artists:         []Artist{},
			Albums:          []Album{},
			Recommendations: recs,
			Meta:            Meta{},
		}, nil
	}

	alternatives := searchAlternatives(norm)
	searchQueries := append([]string{norm}, alternatives...)

	resp, err := s.safeMultiSearch(ctx, norm, limit, req.Offset)
	if err != nil {
		fallbackResp, fallbackErr := s.dbFallbackSearch(ctx, searchQueries, limit, req.Offset)
		if fallbackErr != nil || len(fallbackResp.Tracks) == 0 {
			return Response{}, err
		}
		resp = fallbackResp
	}

	fallbackUsed := ""
	if err == nil {
		for _, alternative := range alternatives {
			if (len(resp.Tracks) + len(resp.Artists) + len(resp.Albums)) >= 3 {
				break
			}
			fallbackResp, err := s.safeMultiSearch(ctx, alternative, limit, req.Offset)
			if err == nil {
				before := len(resp.Tracks) + len(resp.Artists) + len(resp.Albums)
				resp = mergeResponses(resp, fallbackResp)
				after := len(resp.Tracks) + len(resp.Artists) + len(resp.Albums)
				if fallbackUsed == "" && after > before {
					fallbackUsed = alternative
				}
			}
		}
	}
	minDesiredTracks := minInt(limit, 12)
	if len(resp.Tracks) < minDesiredTracks {
		fallbackResp, fallbackErr := s.dbFallbackSearch(ctx, searchQueries, limit, req.Offset)
		if fallbackErr == nil && len(fallbackResp.Tracks) > 0 {
			before := len(resp.Tracks) + len(resp.Artists) + len(resp.Albums)
			resp = mergeResponses(resp, fallbackResp)
			after := len(resp.Tracks) + len(resp.Artists) + len(resp.Albums)
			if fallbackUsed == "" && after > before {
				fallbackUsed = "postgres"
			}
		}
	}

	meta := Meta{Alternatives: alternatives}
	if fallbackUsed != "" {
		meta.UsedFallbackQuery = &fallbackUsed
	}
	resp = rankResponse(resp, norm, limit)
	if len(resp.Tracks)+len(resp.Artists)+len(resp.Albums) == 0 {
		if recs, err := s.Recommendations(ctx, minInt(limit, 12)); err == nil {
			resp.Recommendations = recs
		}
	}
	resp = fillDerivedSideResults(resp, norm, limit)
	resp = rankResponse(resp, norm, limit)
	resp.Query = req.Query
	resp.Normalized = norm
	resp.Meta = meta
	return resp, nil
}

func (s *Service) Recommendations(ctx context.Context, limit int) ([]Track, error) {
	if s == nil || s.meili == nil {
		return []Track{}, nil
	}
	if limit <= 0 {
		limit = 12
	}
	if limit > 24 {
		limit = 24
	}

	deadline := time.Now().Add(1500 * time.Millisecond)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	innerCtx, cancel := context.WithDeadline(ctx, deadline)
	defer cancel()

	req := &meilisearch.SearchRequest{
		Limit:  int64(limit),
		Offset: 0,
		Sort:   []string{"popularity:desc", "play_count:desc"},
	}
	res, err := s.meili.IndexTracks().SearchWithContext(innerCtx, "", req)
	if err != nil {
		req.Sort = nil
		res, err = s.meili.IndexTracks().SearchWithContext(innerCtx, "", req)
		if err != nil {
			return []Track{}, err
		}
	}

	b, err := json.Marshal(res.Hits)
	if err != nil {
		return []Track{}, err
	}
	var tracks []Track
	if err := json.Unmarshal(b, &tracks); err != nil {
		return []Track{}, err
	}
	if tracks == nil {
		tracks = []Track{}
	}
	return tracks, nil
}

func (s *Service) safeMultiSearch(ctx context.Context, query string, limit, offset int) (Response, error) {
	start := time.Now()
	resp, err := s.cb.Execute(func() (Response, error) {
		return s.multiSearch(ctx, query, limit, offset)
	})
	if err != nil {
		return Response{}, err
	}
	if s.slowThreshold > 0 && time.Since(start) > s.slowThreshold {
		return Response{}, context.DeadlineExceeded
	}
	return resp, nil
}

func (s *Service) multiSearch(ctx context.Context, query string, limit, offset int) (Response, error) {
	sideLimit := int64(limit / 2)
	if sideLimit < 1 {
		sideLimit = 1
	}

	queries := []*meilisearch.SearchRequest{
		{IndexUID: s.meili.IndexNames().Tracks, Query: query, Limit: int64(limit), Offset: int64(offset)},
		{IndexUID: s.meili.IndexNames().Artists, Query: query, Limit: sideLimit},
		{IndexUID: s.meili.IndexNames().Albums, Query: query, Limit: sideLimit},
	}

	deadline := time.Now().Add(2 * time.Second)
	if d, ok := ctx.Deadline(); ok {
		deadline = d
	}
	innerCtx, cancel := context.WithDeadline(ctx, deadline)
	defer cancel()

	msr := meilisearch.MultiSearchRequest{Queries: queries}
	res, err := s.meili.Raw().MultiSearchWithContext(innerCtx, &msr)
	if err != nil {
		return Response{}, err
	}

	out := Response{Tracks: []Track{}, Artists: []Artist{}, Albums: []Album{}}
	for _, r := range res.Results {
		b, err := json.Marshal(r.Hits)
		if err != nil {
			continue
		}
		switch r.IndexUID {
		case s.meili.IndexNames().Tracks:
			var tracks []Track
			_ = json.Unmarshal(b, &tracks)
			out.Tracks = tracks
		case s.meili.IndexNames().Artists:
			var artists []Artist
			_ = json.Unmarshal(b, &artists)
			out.Artists = artists
		case s.meili.IndexNames().Albums:
			var albums []Album
			_ = json.Unmarshal(b, &albums)
			out.Albums = albums
		}
	}
	return out, nil
}

func (s *Service) dbFallbackSearch(ctx context.Context, queries []string, limit, offset int) (Response, error) {
	if s == nil || s.db == nil || limit <= 0 {
		return Response{Tracks: []Track{}, Artists: []Artist{}, Albums: []Album{}}, nil
	}

	seenQuery := map[string]struct{}{}
	seenTracks := map[int64]struct{}{}
	out := Response{Tracks: []Track{}, Artists: []Artist{}, Albums: []Album{}}

	for _, q := range queries {
		nq := textnorm.NormalizeQuery(q)
		if nq == "" {
			continue
		}
		if _, ok := seenQuery[nq]; ok {
			continue
		}
		seenQuery[nq] = struct{}{}

		remaining := limit - len(out.Tracks)
		if remaining <= 0 {
			break
		}

		tracks, err := s.dbSearchOne(ctx, nq, remaining, offset)
		if err != nil {
			return out, err
		}
		for _, t := range tracks {
			if _, ok := seenTracks[t.ID]; ok {
				continue
			}
			out.Tracks = append(out.Tracks, t)
			seenTracks[t.ID] = struct{}{}
			if len(out.Tracks) >= limit {
				break
			}
		}
	}

	return fillDerivedSideResults(out, firstNonEmptyQuery(queries), limit), nil
}

func (s *Service) dbSearchOne(ctx context.Context, query string, limit, offset int) ([]Track, error) {
	if s == nil || s.db == nil {
		return []Track{}, nil
	}
	if limit <= 0 {
		return []Track{}, nil
	}
	if limit > 50 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	if offset > 200 {
		offset = 200
	}

	q := textnorm.NormalizeQuery(query)
	if q == "" {
		return []Track{}, nil
	}
	q = strings.ToLower(q)
	qFolded := strings.ReplaceAll(q, "ё", "е")
	tokens := searchTokens(qFolded, 6)
	pattern := "%" + q + "%"
	patternFolded := "%" + qFolded + "%"
	prefix := q + "%"
	prefixFolded := qFolded + "%"

	const sqlText = `
WITH docs AS (
SELECT id::bigint,
       COALESCE(title, '') AS title,
       COALESCE(artist, '') AS artist,
       COALESCE(album, '') AS album,
       COALESCE(duration, 0)::int AS duration,
       COALESCE(genre, '') AS genre,
       COALESCE(year, 0)::int AS year,
       COALESCE(cover_path, '') AS cover_path,
       COALESCE(has_ebap, false) AS has_ebap,
       COALESCE(play_count, 0)::int AS play_count,
       COALESCE(popularity, 0)::int AS popularity,
       lower(CONCAT_WS(' ', COALESCE(title, ''), COALESCE(artist, ''), COALESCE(album, ''), COALESCE(genre, ''), COALESCE(year::text, ''))) AS search_blob,
       replace(lower(CONCAT_WS(' ', COALESCE(title, ''), COALESCE(artist, ''), COALESCE(album, ''), COALESCE(genre, ''), COALESCE(year::text, ''))), 'ё', 'е') AS folded_blob
  FROM songs
 WHERE COALESCE(is_available, true) = true
)
SELECT id,
       title,
       artist,
       album,
       duration,
       genre,
       year,
       cover_path,
       has_ebap,
       play_count,
       popularity
  FROM docs
 WHERE
       (
        search_blob LIKE $1
     OR folded_blob LIKE $2
     OR (cardinality($9::text[]) > 1 AND NOT EXISTS (
          SELECT 1
            FROM unnest($9::text[]) AS tok
           WHERE folded_blob NOT LIKE ('%' || tok || '%')
        ))
       )
 ORDER BY
   CASE
     WHEN lower(COALESCE(title, '')) = $3 THEN 0
     WHEN lower(COALESCE(artist, '')) = $3 THEN 1
     WHEN lower(COALESCE(album, '')) = $3 THEN 2
     WHEN replace(lower(COALESCE(title, '')), 'ё', 'е') = $4 THEN 3
     WHEN replace(lower(COALESCE(artist, '')), 'ё', 'е') = $4 THEN 4
     WHEN lower(COALESCE(title, '')) LIKE $5 THEN 4
     WHEN lower(COALESCE(artist, '')) LIKE $5 THEN 6
     WHEN lower(COALESCE(album, '')) LIKE $5 THEN 7
     WHEN replace(lower(COALESCE(title, '')), 'ё', 'е') LIKE $6 THEN 8
     WHEN replace(lower(COALESCE(artist, '')), 'ё', 'е') LIKE $6 THEN 9
     WHEN cardinality($9::text[]) > 1 AND NOT EXISTS (
          SELECT 1
            FROM unnest($9::text[]) AS tok
           WHERE folded_blob NOT LIKE ('%' || tok || '%')
        ) THEN 10
     ELSE 11
   END,
   COALESCE(popularity, 0) DESC,
   COALESCE(play_count, 0) DESC,
   id DESC
 LIMIT $7 OFFSET $8
`

	rows, err := s.db.Query(ctx, sqlText, pattern, patternFolded, q, qFolded, prefix, prefixFolded, limit, offset, tokens)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Track, 0, limit)
	for rows.Next() {
		var t Track
		var duration int
		var genre string
		var year int
		var cover string
		if err := rows.Scan(&t.ID, &t.Title, &t.Artist, &t.Album, &duration, &genre, &year, &cover, &t.HasEbap, &t.PlayCount, &t.Popularity); err != nil {
			return out, err
		}
		if duration > 0 {
			v := duration
			t.Duration = &v
		}
		if genre != "" {
			v := genre
			t.Genre = &v
		}
		if year > 0 {
			v := year
			t.Year = &v
		}
		if cover != "" {
			v := cover
			t.CoverPath = &v
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func searchTokens(query string, max int) []string {
	if max <= 0 {
		max = 6
	}
	seen := map[string]struct{}{}
	out := make([]string, 0, max)
	for _, raw := range strings.Fields(query) {
		t := strings.TrimSpace(raw)
		if len([]rune(t)) < 2 {
			continue
		}
		if _, ok := seen[t]; ok {
			continue
		}
		seen[t] = struct{}{}
		out = append(out, t)
		if len(out) >= max {
			break
		}
	}
	return out
}

func firstNonEmptyQuery(queries []string) string {
	for _, q := range queries {
		nq := textnorm.NormalizeQuery(q)
		if nq != "" {
			return nq
		}
	}
	return ""
}

func searchAlternatives(norm string) []string {
	alternatives := make([]string, 0, 8)
	add := func(next string) {
		next = textnorm.NormalizeQuery(next)
		if next == "" || next == norm || len(alternatives) >= 12 {
			return
		}
		for _, existing := range alternatives {
			if existing == next {
				return
			}
		}
		alternatives = append(alternatives, next)
	}

	for _, next := range []string{
		textnorm.SwapKeyboardLayout(norm),
		textnorm.SimplifySeparators(norm),
		textnorm.TransliterateCyrillic(norm),
		textnorm.TransliterateLatin(norm),
	} {
		add(next)
	}

	firstPass := append([]string(nil), alternatives...)
	for _, next := range firstPass {
		add(textnorm.SimplifySeparators(next))
		add(textnorm.SwapKeyboardLayout(next))
		add(textnorm.TransliterateCyrillic(next))
		add(textnorm.TransliterateLatin(next))
	}

	return alternatives
}

func mergeResponses(a, b Response) Response {
	trackSeen := map[int64]struct{}{}
	for _, t := range a.Tracks {
		trackSeen[t.ID] = struct{}{}
	}
	for _, t := range b.Tracks {
		if _, ok := trackSeen[t.ID]; ok {
			continue
		}
		a.Tracks = append(a.Tracks, t)
		trackSeen[t.ID] = struct{}{}
	}

	artistSeen := map[string]struct{}{}
	for _, it := range a.Artists {
		artistSeen[it.ArtistName] = struct{}{}
	}
	for _, it := range b.Artists {
		if _, ok := artistSeen[it.ArtistName]; ok {
			continue
		}
		a.Artists = append(a.Artists, it)
		artistSeen[it.ArtistName] = struct{}{}
	}

	albumSeen := map[string]struct{}{}
	for _, it := range a.Albums {
		albumSeen[it.ArtistName+"\n"+it.AlbumName] = struct{}{}
	}
	for _, it := range b.Albums {
		k := it.ArtistName + "\n" + it.AlbumName
		if _, ok := albumSeen[k]; ok {
			continue
		}
		a.Albums = append(a.Albums, it)
		albumSeen[k] = struct{}{}
	}
	return a
}

func rankResponse(resp Response, query string, limit int) Response {
	if limit <= 0 {
		limit = 20
	}
	sort.SliceStable(resp.Tracks, func(i, j int) bool {
		left := trackMatchScore(query, resp.Tracks[i])
		right := trackMatchScore(query, resp.Tracks[j])
		if left != right {
			return left > right
		}
		if resp.Tracks[i].Popularity != resp.Tracks[j].Popularity {
			return resp.Tracks[i].Popularity > resp.Tracks[j].Popularity
		}
		if resp.Tracks[i].PlayCount != resp.Tracks[j].PlayCount {
			return resp.Tracks[i].PlayCount > resp.Tracks[j].PlayCount
		}
		return resp.Tracks[i].ID > resp.Tracks[j].ID
	})
	if len(resp.Tracks) > limit {
		resp.Tracks = resp.Tracks[:limit]
	}

	sideLimit := limit / 2
	if sideLimit < 1 {
		sideLimit = 1
	}
	sort.SliceStable(resp.Artists, func(i, j int) bool {
		left := scoreResultMatch(query, resp.Artists[i].ArtistName)
		right := scoreResultMatch(query, resp.Artists[j].ArtistName)
		if left != right {
			return left > right
		}
		if resp.Artists[i].IsVerified != resp.Artists[j].IsVerified {
			return resp.Artists[i].IsVerified
		}
		if resp.Artists[i].TrackCount != resp.Artists[j].TrackCount {
			return resp.Artists[i].TrackCount > resp.Artists[j].TrackCount
		}
		return int64Value(resp.Artists[i].TotalPlays) > int64Value(resp.Artists[j].TotalPlays)
	})
	if len(resp.Artists) > sideLimit {
		resp.Artists = resp.Artists[:sideLimit]
	}

	sort.SliceStable(resp.Albums, func(i, j int) bool {
		left := scoreResultMatch(query, resp.Albums[i].AlbumName, resp.Albums[i].ArtistName)
		right := scoreResultMatch(query, resp.Albums[j].AlbumName, resp.Albums[j].ArtistName)
		if left != right {
			return left > right
		}
		if resp.Albums[i].TrackCount != resp.Albums[j].TrackCount {
			return resp.Albums[i].TrackCount > resp.Albums[j].TrackCount
		}
		return int64Value(resp.Albums[i].TotalPlays) > int64Value(resp.Albums[j].TotalPlays)
	})
	if len(resp.Albums) > sideLimit {
		resp.Albums = resp.Albums[:sideLimit]
	}

	return resp
}

func trackMatchScore(query string, track Track) int {
	values := []string{track.Title, track.Artist, track.Album}
	if track.Genre != nil {
		values = append(values, *track.Genre)
	}
	if track.Year != nil {
		values = append(values, strconv.Itoa(*track.Year))
	}
	return scoreResultMatch(query, values...)
}

func int64Value(v *int64) int64 {
	if v == nil {
		return 0
	}
	return *v
}

func fillDerivedSideResults(resp Response, query string, limit int) Response {
	if len(resp.Tracks) == 0 {
		return resp
	}
	sideLimit := limit / 2
	if sideLimit < 1 {
		sideLimit = 1
	}
	if len(resp.Artists) == 0 {
		resp.Artists = deriveArtistsFromTracks(resp.Tracks, query, sideLimit)
	}
	if len(resp.Albums) == 0 {
		resp.Albums = deriveAlbumsFromTracks(resp.Tracks, query, sideLimit)
	}
	return resp
}

type derivedArtist struct {
	artist     Artist
	matchScore int
	totalPlays int64
}

func deriveArtistsFromTracks(tracks []Track, query string, limit int) []Artist {
	if len(tracks) == 0 || limit <= 0 {
		return []Artist{}
	}

	byName := make(map[string]*derivedArtist)
	for _, t := range tracks {
		name := primaryArtistName(t.Artist)
		if name == "" {
			continue
		}
		key := textnorm.NormalizeQuery(name)
		if key == "" {
			continue
		}
		score := scoreResultMatch(query, name, t.Artist, t.Title, t.Album)
		cur := byName[key]
		if cur == nil {
			cur = &derivedArtist{
				artist: Artist{
					ArtistName:    name,
					IsVerified:    false,
					TrackCount:    0,
					HeroCoverPath: t.CoverPath,
				},
				matchScore: score,
			}
			byName[key] = cur
		}
		cur.artist.TrackCount++
		cur.totalPlays += int64(t.PlayCount)
		if score > cur.matchScore {
			cur.matchScore = score
		}
		if cur.artist.HeroCoverPath == nil && t.CoverPath != nil {
			cur.artist.HeroCoverPath = t.CoverPath
		}
	}

	items := make([]*derivedArtist, 0, len(byName))
	hasMatches := false
	for _, item := range byName {
		if item.matchScore > 0 {
			hasMatches = true
		}
		items = append(items, item)
	}
	if hasMatches {
		filtered := items[:0]
		for _, item := range items {
			if item.matchScore > 0 {
				filtered = append(filtered, item)
			}
		}
		items = filtered
	}

	sort.SliceStable(items, func(i, j int) bool {
		if items[i].matchScore != items[j].matchScore {
			return items[i].matchScore > items[j].matchScore
		}
		if items[i].artist.TrackCount != items[j].artist.TrackCount {
			return items[i].artist.TrackCount > items[j].artist.TrackCount
		}
		return items[i].totalPlays > items[j].totalPlays
	})

	if len(items) > limit {
		items = items[:limit]
	}
	out := make([]Artist, 0, len(items))
	for _, item := range items {
		total := item.totalPlays
		item.artist.TotalPlays = &total
		out = append(out, item.artist)
	}
	return out
}

type derivedAlbum struct {
	album      Album
	matchScore int
	totalPlays int64
}

func deriveAlbumsFromTracks(tracks []Track, query string, limit int) []Album {
	if len(tracks) == 0 || limit <= 0 {
		return []Album{}
	}

	byKey := make(map[string]*derivedAlbum)
	for _, t := range tracks {
		artist := primaryArtistName(t.Artist)
		album := strings.TrimSpace(t.Album)
		if artist == "" || album == "" {
			continue
		}
		key := textnorm.NormalizeQuery(artist) + "\n" + textnorm.NormalizeQuery(album)
		if strings.TrimSpace(key) == "" {
			continue
		}
		score := scoreResultMatch(query, album, artist, t.Artist, t.Title)
		cur := byKey[key]
		if cur == nil {
			cur = &derivedAlbum{
				album: Album{
					AlbumName:     album,
					ArtistName:    artist,
					TrackCount:    0,
					Year:          t.Year,
					HeroCoverPath: t.CoverPath,
				},
				matchScore: score,
			}
			byKey[key] = cur
		}
		cur.album.TrackCount++
		cur.totalPlays += int64(t.PlayCount)
		if score > cur.matchScore {
			cur.matchScore = score
		}
		if cur.album.HeroCoverPath == nil && t.CoverPath != nil {
			cur.album.HeroCoverPath = t.CoverPath
		}
		if cur.album.Year == nil && t.Year != nil {
			cur.album.Year = t.Year
		}
	}

	items := make([]*derivedAlbum, 0, len(byKey))
	hasMatches := false
	for _, item := range byKey {
		if item.matchScore > 0 {
			hasMatches = true
		}
		items = append(items, item)
	}
	if hasMatches {
		filtered := items[:0]
		for _, item := range items {
			if item.matchScore > 0 {
				filtered = append(filtered, item)
			}
		}
		items = filtered
	}

	sort.SliceStable(items, func(i, j int) bool {
		if items[i].matchScore != items[j].matchScore {
			return items[i].matchScore > items[j].matchScore
		}
		if items[i].album.TrackCount != items[j].album.TrackCount {
			return items[i].album.TrackCount > items[j].album.TrackCount
		}
		return items[i].totalPlays > items[j].totalPlays
	})

	if len(items) > limit {
		items = items[:limit]
	}
	out := make([]Album, 0, len(items))
	for _, item := range items {
		total := item.totalPlays
		item.album.TotalPlays = &total
		out = append(out, item.album)
	}
	return out
}

func primaryArtistName(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return ""
	}
	s = artistFeatureMarkerRe.ReplaceAllString(s, "")
	parts := artistSeparatorRe.Split(s, 2)
	if len(parts) > 0 {
		s = strings.TrimSpace(parts[0])
	}
	return s
}

func scoreResultMatch(query string, values ...string) int {
	queryCandidates := normalizedMatchCandidates(query)
	if len(queryCandidates) == 0 {
		return 0
	}

	best := 0
	for _, raw := range values {
		valueCandidates := normalizedMatchCandidates(raw)
		if len(valueCandidates) == 0 {
			continue
		}
		for _, qc := range queryCandidates {
			for _, vc := range valueCandidates {
				if score := scoreNormalizedMatch(qc, vc); score > best {
					best = score
				}
			}
		}
	}
	return best
}

func normalizedMatchCandidates(raw string) []string {
	norm := textnorm.NormalizeQuery(raw)
	if norm == "" {
		return []string{}
	}
	out := make([]string, 0, 6)
	add := func(next string) {
		next = textnorm.NormalizeQuery(next)
		if next == "" {
			return
		}
		for _, existing := range out {
			if existing == next {
				return
			}
		}
		out = append(out, next)
	}
	add(norm)
	add(textnorm.SimplifySeparators(norm))
	add(textnorm.SwapKeyboardLayout(norm))
	add(textnorm.TransliterateCyrillic(norm))
	add(textnorm.TransliterateLatin(norm))
	return out
}

func scoreNormalizedMatch(query, value string) int {
	if query == "" || value == "" {
		return 0
	}
	if value == query {
		return 1000
	}
	if strings.HasPrefix(value, query) {
		return 700
	}
	for _, token := range strings.Fields(value) {
		if strings.HasPrefix(token, query) {
			return 520
		}
	}
	if strings.Contains(value, query) {
		return 360
	}
	return 0
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
