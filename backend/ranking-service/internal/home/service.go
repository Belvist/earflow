package home

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type Service struct {
	cfg   Config
	pool  *pgxpool.Pool
	redis *redis.Client
	now   func() time.Time
}

func NewService(ctx context.Context, cfg Config) (*Service, error) {
	pcfg, err := pgxpool.ParseConfig(cfg.DB.DSN())
	if err != nil {
		return nil, err
	}
	pcfg.MaxConns = cfg.DB.MaxConns
	pcfg.MinConns = 0
	pcfg.MaxConnIdleTime = 30 * time.Second
	pcfg.MaxConnLifetime = 30 * time.Minute
	pcfg.ConnConfig.ConnectTimeout = cfg.DB.ConnectTimeout

	pool, err := pgxpool.NewWithConfig(ctx, pcfg)
	if err != nil {
		return nil, err
	}

	svc := &Service{cfg: cfg, pool: pool, now: time.Now}
	if cfg.Redis.Host != "" {
		svc.redis = redis.NewClient(&redis.Options{
			Addr:         fmt.Sprintf("%s:%d", cfg.Redis.Host, cfg.Redis.Port),
			Password:     cfg.Redis.Password,
			DB:           cfg.Redis.DB,
			DialTimeout:  1200 * time.Millisecond,
			ReadTimeout:  1200 * time.Millisecond,
			WriteTimeout: 1200 * time.Millisecond,
		})
	}
	return svc, nil
}

func (s *Service) Close() {
	if s.redis != nil {
		_ = s.redis.Close()
	}
	if s.pool != nil {
		s.pool.Close()
	}
}

func (s *Service) Ping(ctx context.Context) error {
	if s == nil || s.pool == nil {
		return errors.New("home service disabled")
	}
	return s.pool.Ping(ctx)
}

func (s *Service) Compose(ctx context.Context, req Request) (Response, error) {
	if s == nil || s.pool == nil {
		return Response{}, errors.New("home service disabled")
	}
	seed := computeSeed(req.Seed, req.UserID, s.now())
	cacheStatus := "bypass_personalized"
	if req.UserID <= 0 {
		cacheStatus = "miss"
		if cached, ok := s.readCache(ctx, seed); ok {
			cached.Source = "cache"
			cached.CacheStatus = "hit"
			cached.Diagnostics = newDiagnostics(false, responsePlaylists(cached), emptyRealtimeCounts())
			return cached, nil
		}
	}

	candidates, err := s.fetchCandidates(ctx, req.UserID, seed)
	if err != nil {
		return Response{}, err
	}
	if len(candidates) == 0 {
		resp := Response{Seed: seed, Rails: []Rail{}, Source: "generated", CacheStatus: cacheStatus, Diagnostics: newDiagnostics(false, nil, emptyRealtimeCounts())}
		s.writeCache(ctx, req.UserID, seed, resp)
		return resp, nil
	}

	realtimeCounts := emptyRealtimeCounts()
	if req.UserID > 0 {
		realtimeCounts = s.applyRealtimeDelta(ctx, req.UserID, candidates)
	}

	profile := buildTasteProfile(candidates)
	scoreCandidates(candidates, profile, s.now())

	rails, fallbackUsed := s.buildRails(seed, candidates, profile, s.now())
	if len(rails) == 0 {
		resp := Response{Seed: seed, Rails: []Rail{}, Source: "generated", CacheStatus: cacheStatus, Diagnostics: newDiagnostics(fallbackUsed, nil, realtimeCounts)}
		s.writeCache(ctx, req.UserID, seed, resp)
		return resp, nil
	}

	resp := Response{Seed: seed, Rails: rails, Source: "generated", CacheStatus: cacheStatus, Diagnostics: newDiagnostics(fallbackUsed, responsePlaylists(Response{Rails: rails}), realtimeCounts)}
	s.writeCache(ctx, req.UserID, seed, resp)
	return resp, nil
}

type playlistSpec struct {
	id          string
	typ         string
	selector    string
	title       string
	mixType     string
	description string
	policy      bucketPolicy
	featured    bool
	reason      string
}

func (s *Service) buildRails(seed string, candidates []candidate, profile tasteProfile, now time.Time) ([]Rail, bool) {
	key := hashToBase36(seed)
	used := map[int]struct{}{}
	maxRails := positiveOrDefault(s.cfg.MaxRails, 5)
	maxPlaylists := positiveOrDefault(s.cfg.MaxPlaylists, 8)
	maxPlaylistsPerRail := positiveOrDefault(s.cfg.PlaylistsPerRail, 10)
	fairRailBudget := int(math.Ceil(float64(maxPlaylists) / float64(maxRails)))
	if fairRailBudget > 0 && fairRailBudget < maxPlaylistsPerRail {
		maxPlaylistsPerRail = fairRailBudget
	}
	trackLimit := positiveOrDefault(s.cfg.TrackLimit, 12)
	rails := make([]Rail, 0, maxRails)
	playlistTotal := 0
	usedLeadCovers := map[string]struct{}{}
	freshTracks := selectWeeklyFresh(candidates, used, trackLimit, now)
	freshTracks = promoteDistinctLeadCover(freshTracks, usedLeadCovers)
	freshPlaylist, freshReady := s.buildPlaylist("fresh_"+key, "new", "Новые релизы недели", "fresh", "Треки, вышедшие за последние 7 дней", freshTracks, false, "fresh")
	if freshReady {
		markUsed(freshTracks, used)
		markLeadCover(freshTracks, usedLeadCovers)
	}

	addRail := func(id, title, description string, specs []playlistSpec) {
		if len(rails) >= maxRails || playlistTotal >= maxPlaylists {
			return
		}
		playlists := make([]Playlist, 0, minInt(len(specs), maxPlaylistsPerRail))
		railUsed := map[int]struct{}{}
		for _, spec := range specs {
			if playlistTotal+len(playlists) >= maxPlaylists || len(playlists) >= maxPlaylistsPerRail {
				break
			}
			preferredUsed := cloneUsed(used)
			mergeUsed(preferredUsed, railUsed)
			tracks := selectTracksForSpec(candidates, profile, preferredUsed, spec, trackLimit, now)
			tracks = promoteDistinctLeadCover(tracks, usedLeadCovers)
			item, ok := s.buildPlaylist(spec.id+"_"+key, spec.typ, spec.title, spec.mixType, spec.description, tracks, spec.featured, spec.reason)
			if !ok {
				continue
			}
			playlists = append(playlists, item)
			markUsed(tracks, railUsed)
			markUsed(tracks, used)
			markLeadCover(tracks, usedLeadCovers)
		}
		if len(playlists) == 0 {
			return
		}
		rails = append(rails, Rail{ID: id, Title: title, Description: description, Playlists: playlists})
		playlistTotal += len(playlists)
	}

	addRail("for_you", "Для вас", "", []playlistSpec{
		{id: "for_you", typ: "for_you", selector: "taste", title: "Микс для вас", mixType: "exact/near", description: "Персональная подборка", policy: policyMixForYou(), featured: true, reason: "exact_taste"},
		{id: "more_for_you", typ: "for_you", selector: "taste", title: "Ещё для вас", mixType: "near/exact", description: "Продолжение вашего вкуса", policy: policyMoreForYou(), reason: "near_taste"},
		{id: "in_your_taste", typ: "for_you", selector: "taste", title: "В вашем вкусе", mixType: "near/exact", description: "Похожие треки без повторов", policy: bucketPolicy{Exact: 50, Near: 35, Discovery: 15}, reason: "near_taste"},
		{id: "deep_for_you", typ: "for_you", selector: "taste", title: "Глубже во вкус", mixType: "exact/near/discovery", description: "Ещё одна личная линия без повторов", policy: bucketPolicy{Exact: 40, Near: 40, Discovery: 20}, reason: "near_taste"},
		{id: "today_for_you", typ: "for_you", selector: "taste", title: "Сегодня зайдет", mixType: "exact/near/discovery", description: "Быстрая подборка под текущий вкус", policy: bucketPolicy{Exact: 45, Near: 30, Discovery: 25}, reason: "near_taste"},
		{id: "next_for_you", typ: "for_you", selector: "taste", title: "Следующее для вас", mixType: "near/discovery", description: "Ещё один персональный поток без повторов", policy: bucketPolicy{Exact: 30, Near: 45, Discovery: 25}, reason: "near_taste"},
		{id: "flow_for_you", typ: "for_you", selector: "taste", title: "Flow для вас", mixType: "exact/near/discovery", description: "Личный поток с балансом знакомого и нового", policy: bucketPolicy{Exact: 40, Near: 25, Discovery: 35}, reason: "near_taste"},
		{id: "same_wave", typ: "for_you", selector: "taste", title: "На вашей волне", mixType: "exact/near", description: "Ближе к тому, что уже заходит", policy: bucketPolicy{Exact: 55, Near: 30, Discovery: 15}, reason: "exact_taste"},
		{id: "taste_plus", typ: "for_you", selector: "taste", title: "Вкус плюс", mixType: "near/discovery", description: "Похоже, но шире", policy: bucketPolicy{Exact: 25, Near: 45, Discovery: 30}, reason: "near_taste"},
		{id: "next_session", typ: "for_you", selector: "taste", title: "Следующая сессия", mixType: "exact/near/discovery", description: "Подборка для продолжения прослушивания", policy: bucketPolicy{Exact: 35, Near: 35, Discovery: 30}, reason: "near_taste"},
	})
	if freshReady && playlistTotal < maxPlaylists && len(rails) < maxRails {
		rails = append(rails, Rail{ID: "fresh", Title: "Новинки", Description: "", Playlists: []Playlist{freshPlaylist}})
		playlistTotal++
	}
	addRail("discovery", "Новые открытия", "", []playlistSpec{
		{id: "discovery", typ: "discovery", selector: "discovery", title: "Новые открытия", mixType: "discovery", description: "Новые треки рядом с вашим вкусом", policy: policyDiscovery(), reason: "discovery"},
		{id: "try_this", typ: "discovery", selector: "discovery", title: "Попробуйте это", mixType: "discovery", description: "Менее очевидные находки", policy: bucketPolicy{Near: 25, Discovery: 75}, reason: "discovery"},
		{id: "new_edges", typ: "discovery", selector: "discovery", title: "Новые грани", mixType: "near/discovery", description: "Подборка с менее очевидными связями", policy: bucketPolicy{Near: 45, Discovery: 55}, reason: "discovery"},
		{id: "leftfield", typ: "discovery", selector: "discovery", title: "Случайные находки", mixType: "discovery", description: "Больше новых треков для расширения вкуса", policy: bucketPolicy{Discovery: 100}, reason: "discovery"},
		{id: "wide_step", typ: "discovery", selector: "discovery", title: "Шаг в сторону", mixType: "near/discovery", description: "Новые связи без резкого отрыва от вкуса", policy: bucketPolicy{Near: 40, Discovery: 60}, reason: "discovery"},
		{id: "fresh_edges", typ: "discovery", selector: "discovery", title: "Свежие грани", mixType: "fresh/discovery", description: "Новое рядом с вашими паттернами", policy: bucketPolicy{Fresh: 35, Near: 25, Discovery: 40}, reason: "discovery"},
		{id: "unknown_good", typ: "discovery", selector: "discovery", title: "Незнакомое хорошее", mixType: "discovery", description: "Контролируемое расширение вкуса", policy: bucketPolicy{Near: 20, Discovery: 80}, reason: "discovery"},
		{id: "genre_bridge", typ: "discovery", selector: "discovery", title: "Мост между жанрами", mixType: "near/discovery", description: "Переходные треки между вашими жанрами", policy: bucketPolicy{Near: 50, Discovery: 50}, reason: "discovery"},
		{id: "hidden_tracks", typ: "discovery", selector: "discovery", title: "Скрытые находки", mixType: "discovery", description: "Менее очевидные треки из каталога", policy: bucketPolicy{Discovery: 100}, reason: "discovery"},
		{id: "new_route", typ: "discovery", selector: "discovery", title: "Новый маршрут", mixType: "near/discovery", description: "Другая линия рекомендаций", policy: bucketPolicy{Near: 30, Discovery: 70}, reason: "discovery"},
	})
	addRail("popular", "Популярное", "", []playlistSpec{
		{id: "popular_now", typ: "popular", selector: "popular", title: "Популярное сейчас", mixType: "popular", description: "Треки, которые чаще слушают", reason: "cold_start"},
		{id: "hits_week", typ: "popular", selector: "popular", title: "Хиты недели", mixType: "popular/near", description: "Сильные треки из каталога", reason: "cold_start"},
		{id: "listeners_choice", typ: "popular", selector: "popular", title: "Выбор слушателей", mixType: "popular/discovery", description: "Популярное без повторов в ленте", reason: "cold_start"},
		{id: "rising_tracks", typ: "popular", selector: "popular", title: "Набирает обороты", mixType: "popular/discovery", description: "Треки с хорошей динамикой", reason: "cold_start"},
		{id: "hot_rotation", typ: "popular", selector: "popular", title: "Горячая ротация", mixType: "popular", description: "То, что чаще попадает в прослушивания", reason: "cold_start"},
		{id: "top_streams", typ: "popular", selector: "popular", title: "Топ прослушиваний", mixType: "popular", description: "Сильные треки по активности", reason: "cold_start"},
		{id: "week_pulse", typ: "popular", selector: "popular", title: "Пульс недели", mixType: "popular/near", description: "Популярное с легкой персонализацией", reason: "cold_start"},
		{id: "crowd_pick", typ: "popular", selector: "popular", title: "Слушают сейчас", mixType: "popular", description: "Популярные треки без повторов", reason: "cold_start"},
		{id: "chart_flow", typ: "popular", selector: "popular", title: "Chart flow", mixType: "popular/discovery", description: "Популярное в формате потока", reason: "cold_start"},
		{id: "stable_hits", typ: "popular", selector: "popular", title: "Стабильные хиты", mixType: "popular", description: "Треки, которые держатся в каталоге", reason: "cold_start"},
	})
	addRail("comeback", "Вернуться к", "", []playlistSpec{
		{id: "comeback", typ: "comeback", selector: "comeback", title: "Вернуться к", mixType: "comeback", description: "То, что давно не звучало", policy: policyComeback(), reason: "comeback"},
		{id: "old_favorites", typ: "comeback", selector: "comeback", title: "Старые фавориты", mixType: "comeback/exact", description: "То, что раньше хорошо заходило", policy: bucketPolicy{Comeback: 65, Exact: 25, Near: 10}, reason: "comeback"},
		{id: "remember_this", typ: "comeback", selector: "comeback", title: "Вспомнить это", mixType: "comeback/near", description: "Возврат к сильным трекам без зацикливания", policy: bucketPolicy{Comeback: 55, Exact: 25, Near: 20}, reason: "comeback"},
		{id: "back_to_rotation", typ: "comeback", selector: "comeback", title: "Снова в ротацию", mixType: "comeback/exact", description: "Давно не звучало, но похоже на ваш вкус", policy: bucketPolicy{Comeback: 50, Exact: 30, Discovery: 20}, reason: "comeback"},
		{id: "missed_tracks", typ: "comeback", selector: "comeback", title: "Вы могли соскучиться", mixType: "comeback", description: "Треки из прошлых прослушиваний", policy: bucketPolicy{Comeback: 70, Near: 30}, reason: "comeback"},
		{id: "history_mix", typ: "comeback", selector: "comeback", title: "Из вашей истории", mixType: "comeback/exact", description: "Аккуратный возврат к знакомому", policy: bucketPolicy{Comeback: 60, Exact: 30, Near: 10}, reason: "comeback"},
		{id: "again_good", typ: "comeback", selector: "comeback", title: "Снова хорошо", mixType: "comeback/near", description: "Знакомые паттерны без повторов подряд", policy: bucketPolicy{Comeback: 45, Exact: 35, Near: 20}, reason: "comeback"},
		{id: "long_time_no_hear", typ: "comeback", selector: "comeback", title: "Давно не слушали", mixType: "comeback", description: "Возврат после паузы", policy: bucketPolicy{Comeback: 80, Near: 20}, reason: "comeback"},
		{id: "liked_before", typ: "comeback", selector: "comeback", title: "Раньше заходило", mixType: "comeback/exact", description: "Сигналы из прошлых лайков и дослушиваний", policy: bucketPolicy{Comeback: 55, Exact: 45}, reason: "comeback"},
		{id: "back_catalog", typ: "comeback", selector: "comeback", title: "Назад в каталог", mixType: "comeback/discovery", description: "Знакомое плюс немного нового", policy: bucketPolicy{Comeback: 45, Near: 25, Discovery: 30}, reason: "comeback"},
	})

	if len(rails) > 0 {
		return rails, false
	}

	tracks := selectFallback(candidates, used, trackLimit)
	item, ok := s.buildPlaylist("popular_"+key, "popular", "Популярное сейчас", "popular", "Треки, которые сейчас слушают", tracks, true, "cold_start")
	if !ok {
		return rails, true
	}
	return []Rail{{ID: "popular", Title: "Популярное", Description: "", Playlists: []Playlist{item}}}, true
}

func (s *Service) buildPlaylist(id, typ, title, mixType, description string, tracks []candidate, featured bool, reason string) (Playlist, bool) {
	if len(tracks) < 5 {
		return Playlist{}, false
	}
	out := make([]Track, 0, len(tracks))
	for _, c := range tracks {
		out = append(out, c.Track)
	}
	var cover *string
	if len(out) > 0 {
		cover = out[0].CoverPath
	}
	return Playlist{
		ID:          id,
		Type:        typ,
		Title:       title,
		Description: description,
		CoverURL:    cover,
		Tracks:      out,
		TrackCount:  len(out),
		ShareToken:  nil,
		IsFeatured:  featured,
		Context: map[string]any{
			"reason_type": reason,
			"mixType":     mixType,
		},
	}, true
}

func (s *Service) appendBuiltPlaylist(items []Playlist, id, typ, title, mixType, description string, tracks []candidate, featured bool, reason string) []Playlist {
	item, ok := s.buildPlaylist(id, typ, title, mixType, description, tracks, featured, reason)
	if !ok {
		return items
	}
	return append(items, item)
}

func (s *Service) fetchCandidates(ctx context.Context, userID int, seed string) ([]candidate, error) {
	allowed := []int32{int32(s.cfg.LibraryUserID)}
	if userID > 0 && userID != s.cfg.LibraryUserID {
		allowed = append(allowed, int32(userID))
	}
	limit := s.cfg.CandidateLimit
	params := []any{allowed, limit, seed}
	userParam := 0
	if userID > 0 {
		params = append(params, userID)
		userParam = len(params)
	}

	userHistoryJoin := ""
	likeJoin := ""
	dislikeJoin := ""
	userHistoryFields := "0::int AS user_play_count, 0::int AS user_skip_count, 0::int AS total_play_time, false AS liked, NULL::timestamp AS last_played, false AS like_event, false AS disliked"
	if userParam > 0 {
		userHistoryJoin = fmt.Sprintf("LEFT JOIN user_history uh ON uh.song_id = s.id AND uh.user_id = $%d", userParam)
		likeJoin = fmt.Sprintf("LEFT JOIN likes ul ON ul.song_id = s.id AND ul.user_id = $%d", userParam)
		dislikeJoin = fmt.Sprintf("LEFT JOIN dislikes ud ON ud.song_id = s.id AND ud.user_id = $%d", userParam)
		userHistoryFields = "COALESCE(uh.play_count, 0)::int AS user_play_count, COALESCE(uh.skip_count, 0)::int AS user_skip_count, COALESCE(uh.total_play_time, 0)::int AS total_play_time, COALESCE(uh.liked, false) AS liked, uh.last_played, (ul.song_id IS NOT NULL) AS like_event, (ud.song_id IS NOT NULL) AS disliked"
	}

	sql := fmt.Sprintf(`
WITH plays_30d AS (
    SELECT song_id, COUNT(*)::float8 AS plays_30d
      FROM listens
     WHERE listened_at > NOW() - INTERVAL '30 days'
     GROUP BY song_id
), base AS (
    SELECT s.id,
           s.public_id,
           s.title,
           s.artist,
           s.album,
           s.duration,
           s.genre,
           s.year,
           s.cover_path,
           false AS has_ebap,
           s.release_date,
           COALESCE(s.created_at, NOW()) AS created_at,
           COALESCE(s.popularity, 0)::float8 AS popularity,
           COALESCE(s.play_count, 0)::float8 AS play_count,
           COALESCE(p.plays_30d, 0)::float8 AS plays_30d,
           sf.tempo,
           sf.energy,
           %s
      FROM songs s
      LEFT JOIN plays_30d p ON p.song_id = s.id
      LEFT JOIN song_features sf ON sf.song_id = s.id
      %s
      %s
      %s
     WHERE s.uploader_id = ANY($1::int[])
       AND COALESCE(s.is_available, true) = true
), scored AS (
    SELECT *,
           (
             CASE WHEN disliked THEN -10000 ELSE 0 END +
             CASE WHEN like_event OR liked THEN 120 ELSE 0 END +
             LEAST(user_play_count * 7, 80) - LEAST(user_skip_count * 10, 120) +
             LEAST(plays_30d, 80) + LEAST(popularity, 100) * 0.35 +
             CASE WHEN created_at > NOW() - INTERVAL '45 days' THEN 14 ELSE 0 END
           )::float8 AS source_score
      FROM base
)
SELECT *
  FROM scored
 WHERE disliked = false
 ORDER BY source_score DESC, md5(id::text || $3), id DESC
 LIMIT $2`, userHistoryFields, userHistoryJoin, likeJoin, dislikeJoin)

	rows, err := s.pool.Query(ctx, sql, params...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]candidate, 0, limit)
	for rows.Next() {
		var c candidate
		var album, genre, cover, publicID pgtype.Text
		var duration, year pgtype.Int4
		var releaseDate pgtype.Date
		var createdAt time.Time
		var lastPlayed pgtype.Timestamp
		var tempo, energy pgtype.Float8
		var disliked bool
		var sourceScore float64
		err := rows.Scan(
			&c.ID, &publicID, &c.Title, &c.Artist, &album, &duration, &genre, &year, &cover, &c.HasEBAP, &releaseDate, &createdAt,
			&c.Popularity, &c.PlayCount, &c.Plays30d, &tempo, &energy, &c.UserPlayCount, &c.UserSkipCount,
			&c.TotalPlayTime, &c.Liked, &lastPlayed, &c.LikeEvent, &disliked, &sourceScore,
		)
		if err != nil {
			return nil, err
		}
		c.PublicID = cleanPublicID(cleanTextPtr(publicID))
		c.Album = cleanTextPtr(album)
		c.Genre = cleanTextPtr(genre)
		c.Duration = int4Ptr(duration)
		c.Year = int4Ptr(year)
		c.CoverPath = normalizeCoverPath(cleanTextPtr(cover))
		c.ReleaseDate = datePtr(releaseDate)
		c.CreatedAt = createdAt
		c.LastPlayed = timestampPtr(lastPlayed)
		c.Tempo = float8Ptr(tempo)
		c.Energy = float8Ptr(energy)
		c.BaseScore = sourceScore
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Service) applyRealtimeDelta(ctx context.Context, userID int, candidates []candidate) map[string]int {
	counts := emptyRealtimeCounts()
	if s.redis == nil || userID <= 0 || len(candidates) == 0 {
		return counts
	}
	seenMembers := make([]any, 0, len(candidates))
	realtimeKeys := make([]string, 0, len(candidates)*3)
	for _, c := range candidates {
		trackID := fmt.Sprintf("%d", c.ID)
		seenMembers = append(seenMembers, trackID)
		realtimeKeys = append(realtimeKeys,
			fmt.Sprintf("%srt:recent:%d:%d", s.cfg.Redis.Prefix, userID, c.ID),
			fmt.Sprintf("%srt:skip:%d:%d", s.cfg.Redis.Prefix, userID, c.ID),
			fmt.Sprintf("%srt:dislike:%d:%d", s.cfg.Redis.Prefix, userID, c.ID),
		)
	}
	seenValues, seenErr := s.redis.SMIsMember(ctx, fmt.Sprintf("%sseen:today:%d", s.cfg.Redis.Prefix, userID), seenMembers...).Result()
	realtimeValues, realtimeErr := s.redis.MGet(ctx, realtimeKeys...).Result()

	if seenErr == nil {
		for i := range candidates {
			if i < len(seenValues) && seenValues[i] {
				candidates[i].SeenToday = true
				counts["seen_today"]++
			}
		}
	}
	if realtimeErr == nil {
		for i := range candidates {
			base := i * 3
			if base+2 >= len(realtimeValues) {
				break
			}
			if realtimeValues[base] != nil {
				candidates[i].RecentRealtime = true
				counts["recent"]++
			}
			if realtimeValues[base+1] != nil {
				candidates[i].SkippedRealtime = true
				counts["skip"]++
			}
			if realtimeValues[base+2] != nil {
				candidates[i].DislikedRealtime = true
				counts["dislike"]++
			}
		}
	}
	return counts
}

func (s *Service) readCache(ctx context.Context, seed string) (Response, bool) {
	if s.redis == nil {
		return Response{}, false
	}
	raw, err := s.redis.Get(ctx, s.cacheKey(seed)).Result()
	if err != nil || raw == "" {
		return Response{}, false
	}
	var out Response
	if err := json.Unmarshal([]byte(raw), &out); err != nil || out.Seed == "" || out.Rails == nil {
		return Response{}, false
	}
	return out, true
}

func (s *Service) writeCache(ctx context.Context, userID int, seed string, resp Response) {
	if s.redis == nil || userID > 0 {
		return
	}
	b, err := json.Marshal(resp)
	if err != nil {
		return
	}
	_ = s.redis.Set(ctx, s.cacheKey(seed), b, s.cfg.CacheTTL).Err()
}

func (s *Service) cacheKey(seed string) string {
	return fmt.Sprintf("%shome:playlists:v3:%s", s.cfg.Redis.Prefix, seed)
}

func newDiagnostics(fallbackUsed bool, playlists []Playlist, realtimeCounts map[string]int) Diagnostics {
	return Diagnostics{
		FallbackUsed:   fallbackUsed,
		BucketCounts:   bucketCounts(playlists),
		RealtimeCounts: copyCounts(emptyRealtimeCounts(), realtimeCounts),
	}
}

func responsePlaylists(resp Response) []Playlist {
	items := make([]Playlist, 0)
	for _, rail := range resp.Rails {
		items = append(items, rail.Playlists...)
	}
	return items
}

func bucketCounts(playlists []Playlist) map[string]int {
	counts := emptyBucketCounts()
	for _, playlist := range playlists {
		bucket := "unknown"
		if playlist.Context != nil {
			if raw, ok := playlist.Context["reason_type"].(string); ok {
				bucket = normalizeBucketLabel(raw)
			}
		}
		counts[bucket] += len(playlist.Tracks)
	}
	return counts
}

func normalizeBucketLabel(v string) string {
	switch strings.TrimSpace(strings.ToLower(v)) {
	case "exact_taste":
		return "exact"
	case "near_taste":
		return "near"
	case "discovery", "fresh", "comeback", "cold_start":
		return strings.TrimSpace(strings.ToLower(v))
	default:
		return "unknown"
	}
}

func emptyBucketCounts() map[string]int {
	return map[string]int{"exact": 0, "near": 0, "discovery": 0, "fresh": 0, "comeback": 0, "cold_start": 0, "unknown": 0}
}

func emptyRealtimeCounts() map[string]int {
	return map[string]int{"seen_today": 0, "recent": 0, "skip": 0, "dislike": 0}
}

func copyCounts(base map[string]int, src map[string]int) map[string]int {
	out := make(map[string]int, len(base)+len(src))
	for k, v := range base {
		out[k] = v
	}
	for k, v := range src {
		out[normalizeKey(k)] = v
	}
	return out
}

type tasteProfile struct {
	Artists map[string]float64
	Genres  map[string]float64
	Cold    bool
}

func buildTasteProfile(items []candidate) tasteProfile {
	p := tasteProfile{Artists: map[string]float64{}, Genres: map[string]float64{}, Cold: true}
	for _, c := range items {
		weight := 0.0
		if c.LikeEvent || c.Liked {
			weight += 7
		}
		if c.UserPlayCount > 0 {
			weight += math.Min(float64(c.UserPlayCount)*2, 12)
		}
		if c.TotalPlayTime >= 180 {
			weight += 2
		}
		if c.UserSkipCount > 0 {
			weight -= math.Min(float64(c.UserSkipCount)*2, 8)
		}
		if weight <= 0 {
			continue
		}
		p.Cold = false
		artist := normalizeKey(c.Artist)
		genre := normalizeKey(ptrString(c.Genre))
		if artist != "" {
			p.Artists[artist] += weight
		}
		if genre != "" {
			p.Genres[genre] += weight
		}
	}
	trimWeights(p.Artists, 12)
	trimWeights(p.Genres, 8)
	return p
}

func scoreCandidates(items []candidate, profile tasteProfile, now time.Time) {
	for i := range items {
		c := &items[i]
		score := c.BaseScore
		artist := normalizeKey(c.Artist)
		genre := normalizeKey(ptrString(c.Genre))
		if profile.Artists[artist] > 0 {
			score += 35 + math.Min(profile.Artists[artist], 40)
		}
		if profile.Genres[genre] > 0 {
			score += 22 + math.Min(profile.Genres[genre], 30)
		}
		if c.SeenToday {
			score -= 80
		}
		if c.RecentRealtime {
			score -= 95
		}
		if c.SkippedRealtime {
			score -= 140
		}
		if c.DislikedRealtime {
			score -= 10000
		}
		if c.LastPlayed != nil {
			age := now.Sub(*c.LastPlayed)
			if age < 6*time.Hour {
				score -= 120
			} else if age < 24*time.Hour {
				score -= 65
			} else if age < 7*24*time.Hour {
				score -= 25
			} else if age > 30*24*time.Hour && (c.LikeEvent || c.Liked || c.UserPlayCount >= 2) {
				score += 18
			}
		}
		if c.UserSkipCount >= 3 && c.UserPlayCount == 0 {
			score -= 140
		}
		c.BaseScore = score
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].BaseScore == items[j].BaseScore {
			return items[i].ID < items[j].ID
		}
		return items[i].BaseScore > items[j].BaseScore
	})
}

type bucketPolicy struct {
	Exact     int
	Near      int
	Discovery int
	Fresh     int
	Comeback  int
}

func policyMixForYou() bucketPolicy  { return bucketPolicy{Exact: 60, Near: 25, Discovery: 15} }
func policyMoreForYou() bucketPolicy { return bucketPolicy{Exact: 45, Near: 35, Discovery: 20} }
func policyDiscovery() bucketPolicy  { return bucketPolicy{Exact: 20, Near: 35, Discovery: 45} }
func policyFresh() bucketPolicy      { return bucketPolicy{Fresh: 60, Exact: 25, Near: 15} }
func policyComeback() bucketPolicy   { return bucketPolicy{Comeback: 70, Exact: 30} }

func selectTracksForSpec(items []candidate, profile tasteProfile, used map[int]struct{}, spec playlistSpec, limit int, now time.Time) []candidate {
	switch normalizeKey(spec.selector) {
	case "popular":
		return selectPopular(items, used, limit)
	case "discovery":
		return selectDiscovery(items, profile, used, spec.policy, limit, now)
	case "comeback":
		return selectComeback(items, used, limit, now)
	case "fresh":
		return selectWeeklyFresh(items, used, limit, now)
	default:
		return selectBucket(items, profile, used, spec.policy, limit)
	}
}

func selectBucket(items []candidate, profile tasteProfile, used map[int]struct{}, policy bucketPolicy, limit int) []candidate {
	pools := map[string][]candidate{"exact": {}, "near": {}, "discovery": {}, "fresh": {}, "comeback": {}}
	now := time.Now()
	for _, c := range items {
		if _, ok := used[c.ID]; ok {
			continue
		}
		if c.DislikedRealtime {
			continue
		}
		if c.UserSkipCount >= 5 && c.UserPlayCount == 0 {
			continue
		}
		cls := classify(c, profile, now)
		pools[cls] = append(pools[cls], c)
		if cls == "exact" {
			pools["near"] = append(pools["near"], c)
		}
		if c.CreatedAt.After(now.AddDate(0, 0, -90)) {
			pools["fresh"] = append(pools["fresh"], c)
		}
		if isComeback(c, now) {
			pools["comeback"] = append(pools["comeback"], c)
		}
	}

	out := make([]candidate, 0, limit)
	appendQuota := func(name string, pct int) {
		if pct <= 0 || len(out) >= limit {
			return
		}
		quota := int(math.Ceil(float64(limit) * float64(pct) / 100.0))
		out = appendDiverse(out, pools[name], used, quota, limit)
	}
	appendQuota("fresh", policy.Fresh)
	appendQuota("comeback", policy.Comeback)
	appendQuota("exact", policy.Exact)
	appendQuota("near", policy.Near)
	appendQuota("discovery", policy.Discovery)

	if len(out) < limit {
		out = appendDiverse(out, items, used, limit-len(out), limit)
	}
	for _, c := range out {
		used[c.ID] = struct{}{}
	}
	return out
}

func selectDiscovery(items []candidate, profile tasteProfile, used map[int]struct{}, policy bucketPolicy, limit int, now time.Time) []candidate {
	pools := map[string][]candidate{"near": {}, "discovery": {}, "fresh": {}}
	for _, c := range items {
		if !isSelectable(c, used) {
			continue
		}
		cls := classify(c, profile, now)
		switch cls {
		case "discovery":
			pools["discovery"] = append(pools["discovery"], c)
		case "near":
			pools["near"] = append(pools["near"], c)
		}
		if c.CreatedAt.After(now.AddDate(0, 0, -90)) {
			pools["fresh"] = append(pools["fresh"], c)
		}
	}

	out := make([]candidate, 0, limit)
	appendQuota := func(name string, pct int) {
		if pct <= 0 || len(out) >= limit {
			return
		}
		quota := int(math.Ceil(float64(limit) * float64(pct) / 100.0))
		out = appendDiverse(out, pools[name], used, quota, limit)
	}
	appendQuota("fresh", policy.Fresh)
	appendQuota("near", policy.Near)
	appendQuota("discovery", policy.Discovery)
	if len(out) < limit {
		out = appendDiverse(out, pools["discovery"], used, limit-len(out), limit)
	}
	if len(out) < limit {
		out = appendDiverse(out, pools["near"], used, limit-len(out), limit)
	}
	for _, c := range out {
		used[c.ID] = struct{}{}
	}
	return out
}

func selectPopular(items []candidate, used map[int]struct{}, limit int) []candidate {
	pool := make([]candidate, 0, limit*2)
	for _, c := range items {
		if isSelectable(c, used) {
			pool = append(pool, c)
		}
	}
	sort.SliceStable(pool, func(i, j int) bool {
		left := pool[i]
		right := pool[j]
		ls := left.Plays30d*3 + left.Popularity*1.2 + left.PlayCount*0.6 + left.BaseScore*0.2
		rs := right.Plays30d*3 + right.Popularity*1.2 + right.PlayCount*0.6 + right.BaseScore*0.2
		if ls == rs {
			return left.ID < right.ID
		}
		return ls > rs
	})
	out := appendDiverse(nil, pool, used, limit, limit)
	markUsed(out, used)
	return out
}

func selectComeback(items []candidate, used map[int]struct{}, limit int, now time.Time) []candidate {
	pool := make([]candidate, 0, limit*2)
	for _, c := range items {
		if isSelectable(c, used) && isComeback(c, now) {
			pool = append(pool, c)
		}
	}
	sort.SliceStable(pool, func(i, j int) bool {
		left := pool[i]
		right := pool[j]
		if left.LastPlayed != nil && right.LastPlayed != nil && !left.LastPlayed.Equal(*right.LastPlayed) {
			return left.LastPlayed.Before(*right.LastPlayed)
		}
		if left.BaseScore == right.BaseScore {
			return left.ID < right.ID
		}
		return left.BaseScore > right.BaseScore
	})
	out := appendDiverse(nil, pool, used, limit, limit)
	markUsed(out, used)
	return out
}

func selectFallback(items []candidate, used map[int]struct{}, limit int) []candidate {
	out := appendDiverse(nil, items, used, limit, limit)
	markUsed(out, used)
	return out
}

func selectWeeklyFresh(items []candidate, used map[int]struct{}, limit int, now time.Time) []candidate {
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	weekAgo := today.AddDate(0, 0, -7)
	tomorrow := today.AddDate(0, 0, 1)
	fresh := make([]candidate, 0, limit)
	for _, c := range items {
		if !isSelectable(c, used) {
			continue
		}
		if c.ReleaseDate == nil {
			continue
		}
		released := *c.ReleaseDate
		if released.Before(weekAgo) || !released.Before(tomorrow) {
			continue
		}
		fresh = append(fresh, c)
	}
	sort.SliceStable(fresh, func(i, j int) bool {
		left := *fresh[i].ReleaseDate
		right := *fresh[j].ReleaseDate
		if left.Equal(right) {
			if fresh[i].BaseScore == fresh[j].BaseScore {
				return fresh[i].ID > fresh[j].ID
			}
			return fresh[i].BaseScore > fresh[j].BaseScore
		}
		return left.After(right)
	})
	out := appendDiverse(nil, fresh, used, limit, limit)
	return out
}

func isSelectable(c candidate, used map[int]struct{}) bool {
	if _, ok := used[c.ID]; ok {
		return false
	}
	if c.DislikedRealtime {
		return false
	}
	if c.UserSkipCount >= 5 && c.UserPlayCount == 0 {
		return false
	}
	return true
}

func promoteDistinctLeadCover(items []candidate, usedCovers map[string]struct{}) []candidate {
	if len(items) < 2 || len(usedCovers) == 0 {
		return items
	}
	for i, c := range items {
		cover := normalizeKey(ptrString(c.CoverPath))
		if cover == "" {
			continue
		}
		if _, exists := usedCovers[cover]; exists {
			continue
		}
		if i > 0 {
			items[0], items[i] = items[i], items[0]
		}
		return items
	}
	return items
}

func markLeadCover(items []candidate, usedCovers map[string]struct{}) {
	if len(items) == 0 || usedCovers == nil {
		return
	}
	cover := normalizeKey(ptrString(items[0].CoverPath))
	if cover != "" {
		usedCovers[cover] = struct{}{}
	}
}

func markUsed(items []candidate, used map[int]struct{}) {
	for _, c := range items {
		used[c.ID] = struct{}{}
	}
}

func cloneUsed(src map[int]struct{}) map[int]struct{} {
	out := make(map[int]struct{}, len(src))
	for id := range src {
		out[id] = struct{}{}
	}
	return out
}

func mergeUsed(dst map[int]struct{}, src map[int]struct{}) {
	for id := range src {
		dst[id] = struct{}{}
	}
}

func appendDiverse(dst []candidate, src []candidate, used map[int]struct{}, quota int, limit int) []candidate {
	artistCounts := map[string]int{}
	coverCounts := map[string]int{}
	for _, c := range dst {
		artistCounts[normalizeKey(c.Artist)]++
		cover := normalizeKey(ptrString(c.CoverPath))
		if cover != "" {
			coverCounts[cover]++
		}
	}
	for _, c := range src {
		if len(dst) >= limit || quota <= 0 {
			break
		}
		if _, ok := used[c.ID]; ok {
			continue
		}
		if c.DislikedRealtime {
			continue
		}
		if containsCandidate(dst, c.ID) {
			continue
		}
		artist := normalizeKey(c.Artist)
		if artist != "" && artistCounts[artist] >= 3 {
			continue
		}
		cover := normalizeKey(ptrString(c.CoverPath))
		if cover != "" && coverCounts[cover] >= 1 {
			continue
		}
		dst = append(dst, c)
		artistCounts[artist]++
		if cover != "" {
			coverCounts[cover]++
		}
		quota--
	}
	for _, c := range src {
		if len(dst) >= limit || quota <= 0 {
			break
		}
		if _, ok := used[c.ID]; ok {
			continue
		}
		if c.DislikedRealtime {
			continue
		}
		if containsCandidate(dst, c.ID) {
			continue
		}
		artist := normalizeKey(c.Artist)
		if artist != "" && artistCounts[artist] >= 4 {
			continue
		}
		cover := normalizeKey(ptrString(c.CoverPath))
		if cover != "" && coverCounts[cover] >= 2 {
			continue
		}
		dst = append(dst, c)
		artistCounts[artist]++
		if cover != "" {
			coverCounts[cover]++
		}
		quota--
	}
	return dst
}

func classify(c candidate, profile tasteProfile, now time.Time) string {
	if isComeback(c, now) {
		return "comeback"
	}
	artist := normalizeKey(c.Artist)
	genre := normalizeKey(ptrString(c.Genre))
	if c.LikeEvent || c.Liked || profile.Artists[artist] >= 7 || c.UserPlayCount >= 3 {
		return "exact"
	}
	if profile.Genres[genre] > 0 || profile.Artists[artist] > 0 {
		return "near"
	}
	return "discovery"
}

func isComeback(c candidate, now time.Time) bool {
	return c.LastPlayed != nil && now.Sub(*c.LastPlayed) > 21*24*time.Hour && (c.LikeEvent || c.Liked || c.UserPlayCount >= 2)
}

func containsCandidate(items []candidate, id int) bool {
	for _, c := range items {
		if c.ID == id {
			return true
		}
	}
	return false
}

func positiveOrDefault(v int, fallback int) int {
	if v > 0 {
		return v
	}
	return fallback
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func trimWeights(m map[string]float64, keep int) {
	type kv struct {
		K string
		V float64
	}
	items := make([]kv, 0, len(m))
	for k, v := range m {
		items = append(items, kv{k, v})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].V > items[j].V })
	for i := keep; i < len(items); i++ {
		delete(m, items[i].K)
	}
}

func cleanTextPtr(v pgtype.Text) *string {
	if !v.Valid {
		return nil
	}
	s := strings.TrimSpace(v.String)
	if s == "" {
		return nil
	}
	return &s
}

// canonicalPublicID keeps only the opaque 16-hex song id (web route currency);
// anything else is dropped so share/resolve paths never emit numeric ids.
func cleanPublicID(s *string) *string {
	if s == nil {
		return nil
	}
	v := strings.ToLower(strings.TrimSpace(*s))
	if len(v) != 16 {
		return nil
	}
	for i := 0; i < len(v); i++ {
		c := v[i]
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return nil
		}
	}
	return &v
}

func int4Ptr(v pgtype.Int4) *int {
	if !v.Valid {
		return nil
	}
	n := int(v.Int32)
	return &n
}

func float8Ptr(v pgtype.Float8) *float64 {
	if !v.Valid {
		return nil
	}
	n := v.Float64
	return &n
}

func timestampPtr(v pgtype.Timestamp) *time.Time {
	if !v.Valid {
		return nil
	}
	t := v.Time
	return &t
}

func datePtr(v pgtype.Date) *time.Time {
	if !v.Valid {
		return nil
	}
	t := v.Time
	return &t
}

func ptrString(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

func normalizeKey(v string) string {
	return strings.ToLower(strings.TrimSpace(v))
}
