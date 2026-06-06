package db

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"reco-feedback-worker/internal/config"
)

type RecordBatchResult struct {
	Recorded int
	Fresh    []Interaction
}

type historyEntry struct {
	UserID        int
	TrackID       int
	PlayCount     int
	SkipCount     int
	TotalPlayTime int
	LikedAction   string
}

type pair struct {
	UserID int
	SongID int
}

func RecordInteractionsBatch(ctx context.Context, cfg config.Config, p *Pool, interactions []Interaction) (RecordBatchResult, error) {
	normalized, allTrackIDs := normalizeInteractions(cfg, interactions)
	if len(normalized) == 0 {
		return RecordBatchResult{Recorded: 0, Fresh: nil}, nil
	}

	existing, err := fetchExistingSongIDs(ctx, p, allTrackIDs)
	if err != nil {
		return RecordBatchResult{}, err
	}
	valid := filterExistingSongs(normalized, existing)
	if len(valid) == 0 {
		return RecordBatchResult{Recorded: 0, Fresh: nil}, nil
	}

	tx, release, err := beginTx(ctx, p)
	if err != nil {
		return RecordBatchResult{}, err
	}
	defer release()
	if err := applyStatementTimeout(ctx, tx, cfg); err != nil {
		return RecordBatchResult{}, err
	}

	inserted, fresh, err := insertRawEvents(ctx, tx, valid)
	if err != nil {
		return RecordBatchResult{}, err
	}

	effective := filterLoadTestInteractions(fresh)
	if inserted == 0 || len(fresh) == 0 || len(effective) == 0 {
		if err := tx.Commit(ctx); err != nil {
			return RecordBatchResult{}, err
		}
		return RecordBatchResult{Recorded: 0, Fresh: nil}, nil
	}

	if err := insertUserInteractions(ctx, tx, effective); err != nil {
		return RecordBatchResult{}, err
	}
	if err := applyInteractionEffects(ctx, tx, cfg, effective); err != nil {
		return RecordBatchResult{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return RecordBatchResult{}, err
	}

	return RecordBatchResult{Recorded: len(effective), Fresh: effective}, nil
}

func normalizeInteractions(cfg config.Config, interactions []Interaction) ([]Interaction, []int32) {
	if len(interactions) == 0 {
		return nil, nil
	}

	normalized := make([]Interaction, 0, len(interactions))
	trackIDsSet := map[int]struct{}{}
	maxMs := int(cfg.Taste.MaxDuration / time.Millisecond)

	for _, it := range interactions {
		it, ok := normalizeOneInteraction(cfg, it, maxMs)
		if !ok {
			continue
		}
		trackIDsSet[it.TrackID] = struct{}{}
		normalized = append(normalized, it)
	}

	if len(normalized) == 0 {
		return nil, nil
	}

	allTrackIDs := make([]int32, 0, len(trackIDsSet))
	for id := range trackIDsSet {
		allTrackIDs = append(allTrackIDs, int32(id))
	}

	return normalized, allTrackIDs
}

func normalizeOneInteraction(cfg config.Config, it Interaction, maxMs int) (Interaction, bool) {
	if it.UserID <= 0 || it.TrackID <= 0 {
		return Interaction{}, false
	}
	if _, ok := cfg.Taste.AllowedActions[it.Action]; !ok {
		return Interaction{}, false
	}

	if it.DurationMs < 0 {
		it.DurationMs = 0
	}
	if it.DurationMs > maxMs {
		it.DurationMs = maxMs
	}
	it.DurationSeconds = it.DurationMs / 1000

	if it.SchemaVersion <= 0 {
		it.SchemaVersion = 1
	}
	if it.EventTime.IsZero() {
		it.EventTime = time.Now()
	}
	if it.EventID == "" {
		it.EventID = fmt.Sprintf("legacy:%d:%d:%s:%d", it.UserID, it.TrackID, it.Action, it.EventTime.UnixMilli())
	}
	return it, true
}

func filterExistingSongs(interactions []Interaction, existing map[int32]bool) []Interaction {
	if len(interactions) == 0 {
		return nil
	}
	valid := make([]Interaction, 0, len(interactions))
	for _, it := range interactions {
		if existing[int32(it.TrackID)] {
			valid = append(valid, it)
		}
	}
	return valid
}

func beginTx(ctx context.Context, p *Pool) (pgx.Tx, func(), error) {
	conn, err := p.pool.Acquire(ctx)
	if err != nil {
		return nil, nil, err
	}

	tx, err := conn.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		conn.Release()
		return nil, nil, err
	}

	release := func() {
		_ = tx.Rollback(ctx)
		conn.Release()
	}

	return tx, release, nil
}


func applyStatementTimeout(ctx context.Context, tx pgx.Tx, cfg config.Config) error {
	if cfg.DB.StatementTimeout <= 0 {
		return nil
	}
	ms := int(cfg.DB.StatementTimeout / time.Millisecond)
	if ms <= 0 {
		return nil
	}
	timeoutValue := fmt.Sprintf("%dms", ms)
	_, err := tx.Exec(ctx, "SELECT set_config('statement_timeout', $1, true)", timeoutValue)
	return err
}

func applyInteractionEffects(ctx context.Context, tx pgx.Tx, cfg config.Config, interactions []Interaction) error {
	historyMap, implicitPairs, qualifiedPlays := buildHistoryAgg(cfg, interactions)

	if err := upsertUserHistory(ctx, tx, historyMap); err != nil {
		return err
	}
	if err := updateLikedFlags(ctx, tx, historyMap); err != nil {
		return err
	}

	likesPairs, dislikesPairs := buildLikeDislikePairs(historyMap)

	if err := applyLikePairs(ctx, tx, cfg, likesPairs); err != nil {
		return err
	}
	if err := applyDislikePairs(ctx, tx, cfg, dislikesPairs); err != nil {
		return err
	}
	if err := applyImplicitPairs(ctx, tx, cfg, implicitPairs); err != nil {
		return err
	}

	return updateSongCounters(ctx, tx, qualifiedPlays)
}

func applyLikePairs(ctx context.Context, tx pgx.Tx, cfg config.Config, pairs []pair) error {
	if len(pairs) == 0 {
		return nil
	}
	if err := updateUserEmbeddingsForPairs(ctx, tx, cfg, pairs, cfg.Taste.UserAlpha, 1); err != nil {
		return err
	}
	if err := insertLikes(ctx, tx, pairs); err != nil {
		return err
	}
	return deleteDislikes(ctx, tx, pairs)
}

func applyDislikePairs(ctx context.Context, tx pgx.Tx, cfg config.Config, pairs []pair) error {
	if len(pairs) == 0 {
		return nil
	}
	if err := updateUserEmbeddingsForPairs(ctx, tx, cfg, pairs, cfg.Taste.DislikeAlpha, -1); err != nil {
		return err
	}
	if err := insertDislikes(ctx, tx, pairs); err != nil {
		return err
	}
	return deleteLikes(ctx, tx, pairs)
}

func applyImplicitPairs(ctx context.Context, tx pgx.Tx, cfg config.Config, pairs []pair) error {
	if len(pairs) == 0 {
		return nil
	}
	return updateUserEmbeddingsForPairs(ctx, tx, cfg, pairs, cfg.Taste.ImplicitAlpha, 1)
}

func fetchExistingSongIDs(ctx context.Context, p *Pool, ids []int32) (map[int32]bool, error) {
	if len(ids) == 0 {
		return map[int32]bool{}, nil
	}

	rows, err := p.pool.Query(ctx, "SELECT id FROM songs WHERE id = ANY($1::int[])", ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[int32]bool{}
	for rows.Next() {
		var id int32
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func insertRawEvents(ctx context.Context, tx pgx.Tx, interactions []Interaction) (int, []Interaction, error) {
	eventIDs := make([]string, 0, len(interactions))
	schemaVersions := make([]int32, 0, len(interactions))
	eventTimes := make([]time.Time, 0, len(interactions))
	userIDs := make([]int32, 0, len(interactions))
	sessionIDs := make([]pgtype.Text, 0, len(interactions))
	playbackSessionIDs := make([]pgtype.Text, 0, len(interactions))
	trackIDs := make([]int32, 0, len(interactions))
	actions := make([]string, 0, len(interactions))
	durationMs := make([]int32, 0, len(interactions))
	progress := make([]pgtype.Float8, 0, len(interactions))
	contextText := make([]pgtype.Text, 0, len(interactions))

	for _, it := range interactions {
		eventIDs = append(eventIDs, it.EventID)
		schemaVersions = append(schemaVersions, int32(it.SchemaVersion))
		eventTimes = append(eventTimes, it.EventTime)
		userIDs = append(userIDs, int32(it.UserID))
		sessionIDs = append(sessionIDs, textFromPtr(it.SessionID))
		playbackSessionIDs = append(playbackSessionIDs, textFromPtr(it.PlaybackSessionID))
		trackIDs = append(trackIDs, int32(it.TrackID))
		actions = append(actions, it.Action)
		durationMs = append(durationMs, int32(it.DurationMs))
		progress = append(progress, floatFromPtr(it.Progress))
		contextText = append(contextText, textFromJSON(it.Context))
	}

	sessionIDsArr := pgtype.Array[pgtype.Text]{Elements: sessionIDs, Dims: oneDim(len(sessionIDs)), Valid: true}
	playbackSessionIDsArr := pgtype.Array[pgtype.Text]{Elements: playbackSessionIDs, Dims: oneDim(len(playbackSessionIDs)), Valid: true}
	progressArr := pgtype.Array[pgtype.Float8]{Elements: progress, Dims: oneDim(len(progress)), Valid: true}
	contextArr := pgtype.Array[pgtype.Text]{Elements: contextText, Dims: oneDim(len(contextText)), Valid: true}

	rows, err := tx.Query(
		ctx,
		`INSERT INTO analytics_events_raw (
		   event_id,
		   schema_version,
		   event_time,
		   user_id,
		   session_id,
		   playback_session_id,
		   track_id,
		   action,
		   duration_ms,
		   progress,
		   context,
		   metadata
		 )
		 SELECT
		   t.event_id,
		   t.schema_version,
		   t.event_time,
		   t.user_id,
		   t.session_id,
		   t.playback_session_id,
		   t.track_id,
		   t.action,
		   t.duration_ms,
		   t.progress::numeric,
		   t.context::jsonb,
		   NULL::jsonb
		 FROM UNNEST (
		   $1::text[],
		   $2::int[],
		   $3::timestamptz[],
		   $4::int[],
		   $5::text[],
		   $6::text[],
		   $7::int[],
		   $8::text[],
		   $9::int[],
		   $10::double precision[],
		   $11::text[]
		 ) AS t(
		   event_id,
		   schema_version,
		   event_time,
		   user_id,
		   session_id,
		   playback_session_id,
		   track_id,
		   action,
		   duration_ms,
		   progress,
		   context
		 )
		 ON CONFLICT (event_id) DO NOTHING
		 RETURNING event_id`,
		eventIDs,
		schemaVersions,
		eventTimes,
		userIDs,
		sessionIDsArr,
		playbackSessionIDsArr,
		trackIDs,
		actions,
		durationMs,
		progressArr,
		contextArr,
	)
	if err != nil {
		return 0, nil, err
	}
	defer rows.Close()

	inserted := map[string]struct{}{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return 0, nil, err
		}
		inserted[id] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return 0, nil, err
	}

	fresh := make([]Interaction, 0, len(inserted))
	for _, it := range interactions {
		if _, ok := inserted[it.EventID]; ok {
			fresh = append(fresh, it)
		}
	}

	return len(inserted), fresh, nil
}

func insertUserInteractions(ctx context.Context, tx pgx.Tx, interactions []Interaction) error {
	userIDs := make([]int32, 0, len(interactions))
	trackIDs := make([]int32, 0, len(interactions))
	actions := make([]string, 0, len(interactions))
	sessionIDs := make([]pgtype.Text, 0, len(interactions))
	durationMs := make([]int32, 0, len(interactions))
	progress := make([]pgtype.Float8, 0, len(interactions))
	eventIDs := make([]string, 0, len(interactions))
	playbackSessionIDs := make([]pgtype.Text, 0, len(interactions))
	eventTimes := make([]time.Time, 0, len(interactions))

	for _, it := range interactions {
		userIDs = append(userIDs, int32(it.UserID))
		trackIDs = append(trackIDs, int32(it.TrackID))
		actions = append(actions, it.Action)
		sessionIDs = append(sessionIDs, textFromPtr(it.SessionID))
		durationMs = append(durationMs, int32(it.DurationMs))
		progress = append(progress, floatFromPtr(it.Progress))
		eventIDs = append(eventIDs, it.EventID)
		playbackSessionIDs = append(playbackSessionIDs, textFromPtr(it.PlaybackSessionID))
		eventTimes = append(eventTimes, it.EventTime)
	}

	sessionIDsArr := pgtype.Array[pgtype.Text]{Elements: sessionIDs, Dims: oneDim(len(sessionIDs)), Valid: true}
	playbackSessionIDsArr := pgtype.Array[pgtype.Text]{Elements: playbackSessionIDs, Dims: oneDim(len(playbackSessionIDs)), Valid: true}
	progressArr := pgtype.Array[pgtype.Float8]{Elements: progress, Dims: oneDim(len(progress)), Valid: true}

	_, err := tx.Exec(
		ctx,
		`INSERT INTO user_interactions (
		   user_id,
		   song_id,
		   interaction_type,
		   session_id,
		   duration_ms,
		   progress,
		   event_id,
		   playback_session_id,
		   event_time,
		   metadata
		 )
		 SELECT
		   t.user_id,
		   t.song_id,
		   t.action,
		   t.session_id,
		   t.duration_ms,
		   t.progress::numeric,
		   t.event_id,
		   t.playback_session_id,
		   t.event_time,
		   NULL::jsonb
		 FROM UNNEST (
		   $1::int[],
		   $2::int[],
		   $3::text[],
		   $4::text[],
		   $5::int[],
		   $6::double precision[],
		   $7::text[],
		   $8::text[],
		   $9::timestamptz[]
		 ) AS t(
		   user_id,
		   song_id,
		   action,
		   session_id,
		   duration_ms,
		   progress,
		   event_id,
		   playback_session_id,
		   event_time
		 )`,
		userIDs,
		trackIDs,
		actions,
		sessionIDsArr,
		durationMs,
		progressArr,
		eventIDs,
		playbackSessionIDsArr,
		eventTimes,
	)
	return err
}

func buildHistoryAgg(cfg config.Config, interactions []Interaction) (map[string]*historyEntry, []pair, map[int]int) {
	history := map[string]*historyEntry{}
	implicit := make([]pair, 0)
	disliked := map[string]struct{}{}
	qualified := map[int]int{}

	minPlay := cfg.Taste.ImplicitMinPlaySec
	for _, it := range interactions {
		key := historyKey(it.UserID, it.TrackID)
		entry := getOrCreateHistoryEntry(history, key, it.UserID, it.TrackID)
		applyHistoryCounters(entry, it)
		applyLikeDislikeMarkers(entry, key, it.Action, disliked)

		qualifiesByDuration := it.DurationSeconds >= minPlay
		qualifiesByProgress := it.Progress != nil && *it.Progress >= 0.5
		qualifiedListen := isQualifiedListen(it.Action, qualifiesByDuration, qualifiesByProgress)

		if shouldImplicitPair(it.Action, qualifiesByDuration) {
			implicit = append(implicit, pair{UserID: it.UserID, SongID: it.TrackID})
		}
		if qualifiedListen {
			qualified[it.TrackID] = qualified[it.TrackID] + 1
		}
	}

	filteredImplicit := filterImplicitPairs(implicit, disliked)
	return history, filteredImplicit, qualified
}

func historyKey(userID, trackID int) string {
	return fmt.Sprintf("%d:%d", userID, trackID)
}

func filterLoadTestInteractions(in []Interaction) []Interaction {
	if len(in) == 0 {
		return nil
	}
	out := make([]Interaction, 0, len(in))
	for _, it := range in {
		if isLoadTestEvent(it) {
			continue
		}
		out = append(out, it)
	}
	return out
}

func isLoadTestEvent(it Interaction) bool {
	if it.EventID != "" {
		if strings.HasPrefix(it.EventID, "loadgen:") {
			return true
		}
		if strings.HasPrefix(it.EventID, "loadtest:") {
			return true
		}
	}
	if it.SessionID != nil {
		sid := *it.SessionID
		if strings.HasPrefix(sid, "loadgen-sess-") {
			return true
		}
		if strings.HasPrefix(sid, "loadtest-") {
			return true
		}
	}
	return false
}

func getOrCreateHistoryEntry(history map[string]*historyEntry, key string, userID, trackID int) *historyEntry {
	entry := history[key]
	if entry != nil {
		return entry
	}
	entry = &historyEntry{UserID: userID, TrackID: trackID}
	history[key] = entry
	return entry
}

func applyHistoryCounters(entry *historyEntry, it Interaction) {
	if it.Action == "play" || it.Action == "complete" {
		entry.PlayCount += 1
	}
	if it.Action == "skip" || it.Action == "dislike" {
		entry.SkipCount += 1
	}
	entry.TotalPlayTime += it.DurationSeconds
}

func applyLikeDislikeMarkers(entry *historyEntry, key string, action string, disliked map[string]struct{}) {
	if action == "like" {
		entry.LikedAction = "like"
		return
	}
	if action == "dislike" {
		entry.LikedAction = "dislike"
		disliked[key] = struct{}{}
	}
}

func isQualifiedListen(action string, qualifiesByDuration bool, qualifiesByProgress bool) bool {
	if action == "complete" {
		return true
	}
	if action == "play" {
		return qualifiesByDuration
	}
	if action == "skip" || action == "dislike" {
		return qualifiesByDuration || qualifiesByProgress
	}
	return false
}

func shouldImplicitPair(action string, qualifiesByDuration bool) bool {
	if action == "complete" {
		return true
	}
	if action == "play" {
		return qualifiesByDuration
	}
	return false
}

func filterImplicitPairs(pairs []pair, disliked map[string]struct{}) []pair {
	if len(pairs) == 0 {
		return nil
	}
	out := make([]pair, 0, len(pairs))
	for _, p := range pairs {
		k := historyKey(p.UserID, p.SongID)
		if _, ok := disliked[k]; ok {
			continue
		}
		out = append(out, p)
	}
	return out
}

func upsertUserHistory(ctx context.Context, tx pgx.Tx, history map[string]*historyEntry) error {
	if len(history) == 0 {
		return nil
	}

	u := make([]int32, 0, len(history))
	s := make([]int32, 0, len(history))
	plays := make([]int32, 0, len(history))
	skips := make([]int32, 0, len(history))
	total := make([]int32, 0, len(history))
	for _, e := range history {
		u = append(u, int32(e.UserID))
		s = append(s, int32(e.TrackID))
		plays = append(plays, int32(e.PlayCount))
		skips = append(skips, int32(e.SkipCount))
		total = append(total, int32(e.TotalPlayTime))
	}

	_, err := tx.Exec(
		ctx,
		`INSERT INTO user_history (user_id, song_id, play_count, liked, last_played, total_play_time, skip_count)
		 SELECT t.user_id, t.song_id, t.play_count, FALSE, NOW(), t.total_play_time, t.skip_count
		 FROM UNNEST ($1::int[], $2::int[], $3::int[], $4::int[], $5::int[])
		   AS t(user_id, song_id, play_count, skip_count, total_play_time)
		 ON CONFLICT (user_id, song_id) DO UPDATE SET
		   play_count = user_history.play_count + EXCLUDED.play_count,
		   skip_count = user_history.skip_count + EXCLUDED.skip_count,
		   total_play_time = user_history.total_play_time + EXCLUDED.total_play_time,
		   last_played = GREATEST(user_history.last_played, NOW())`,
		u, s, plays, skips, total,
	)
	return err
}

func updateLikedFlags(ctx context.Context, tx pgx.Tx, history map[string]*historyEntry) error {
	likeUserIDs := make([]int32, 0)
	likeTrackIDs := make([]int32, 0)
	likeValues := make([]bool, 0)

	for _, e := range history {
		if e.LikedAction != "like" && e.LikedAction != "dislike" {
			continue
		}
		likeUserIDs = append(likeUserIDs, int32(e.UserID))
		likeTrackIDs = append(likeTrackIDs, int32(e.TrackID))
		likeValues = append(likeValues, e.LikedAction == "like")
	}

	if len(likeUserIDs) == 0 {
		return nil
	}

	_, err := tx.Exec(
		ctx,
		`UPDATE user_history AS uh
		 SET liked = t.liked_value
		 FROM UNNEST ($1::int[], $2::int[], $3::boolean[])
		   AS t(user_id, song_id, liked_value)
		 WHERE uh.user_id = t.user_id AND uh.song_id = t.song_id`,
		likeUserIDs, likeTrackIDs, likeValues,
	)
	return err
}

func buildLikeDislikePairs(history map[string]*historyEntry) ([]pair, []pair) {
	likes := make([]pair, 0)
	dislikes := make([]pair, 0)

	likesSet := map[string]struct{}{}
	dislikesSet := map[string]struct{}{}

	for _, e := range history {
		k := fmt.Sprintf("%d:%d", e.UserID, e.TrackID)
		if e.LikedAction == "like" {
			if _, ok := likesSet[k]; ok {
				continue
			}
			likesSet[k] = struct{}{}
			likes = append(likes, pair{UserID: e.UserID, SongID: e.TrackID})
		} else if e.LikedAction == "dislike" {
			if _, ok := dislikesSet[k]; ok {
				continue
			}
			dislikesSet[k] = struct{}{}
			dislikes = append(dislikes, pair{UserID: e.UserID, SongID: e.TrackID})
		}
	}

	return likes, dislikes
}

func updateUserEmbeddingsForPairs(ctx context.Context, tx pgx.Tx, cfg config.Config, pairs []pair, alpha float64, direction int) error {
	if len(pairs) == 0 {
		return nil
	}
	if alpha <= 0 || alpha >= 1 {
		return nil
	}

	u := make([]int32, 0, len(pairs))
	s := make([]int32, 0, len(pairs))
	for _, p := range pairs {
		u = append(u, int32(p.UserID))
		s = append(s, int32(p.SongID))
	}

	dir := 1
	if direction == -1 {
		dir = -1
	}

	maxClusters := cfg.Taste.MaxClusters
	newThresh := cfg.Taste.NewClusterDistThresh

	_, err := tx.Exec(
		ctx,
		`WITH pairs AS (
		   SELECT *
		   FROM UNNEST ($1::int[], $2::int[]) AS t(user_id, song_id)
		 ),
		 agg AS (
		   SELECT
		     p.user_id,
		     reco_scale_vector(sum(s.embedding), (1.0::real / count(*)::real)) AS track_embedding
		   FROM pairs p
		   JOIN songs s ON s.id = p.song_id
		   WHERE s.embedding IS NOT NULL
		   GROUP BY p.user_id
		 )
		 INSERT INTO user_models (user_id, last_updated)
		 SELECT a.user_id, NOW()
		 FROM agg a
		 ON CONFLICT (user_id) DO NOTHING`,
		u, s,
	)
	if err != nil {
		return err
	}

	_, err = tx.Exec(
		ctx,
		`WITH pairs AS (
		   SELECT *
		   FROM UNNEST ($1::int[], $2::int[]) AS t(user_id, song_id)
		 ),
		 agg AS (
		   SELECT
		     p.user_id,
		     reco_scale_vector(sum(s.embedding), (1.0::real / count(*)::real)) AS track_embedding
		   FROM pairs p
		   JOIN songs s ON s.id = p.song_id
		   WHERE s.embedding IS NOT NULL
		   GROUP BY p.user_id
		 )
		 SELECT reco_apply_feedback_to_taste_clusters(a.user_id, a.track_embedding, $3::real, $4::int, $5::int, $6::real)
		 FROM agg a`,
		u, s, alpha, dir, maxClusters, newThresh,
	)
	return err
}

func insertLikes(ctx context.Context, tx pgx.Tx, pairs []pair) error {
	u, s := pairsToArrays(pairs)
	_, err := tx.Exec(
		ctx,
		`INSERT INTO likes (user_id, song_id)
		 SELECT t.user_id, t.song_id
		 FROM UNNEST ($1::int[], $2::int[]) AS t(user_id, song_id)
		 ON CONFLICT (user_id, song_id) DO NOTHING`,
		u, s,
	)
	return err
}

func insertDislikes(ctx context.Context, tx pgx.Tx, pairs []pair) error {
	u, s := pairsToArrays(pairs)
	_, err := tx.Exec(
		ctx,
		`INSERT INTO dislikes (user_id, song_id)
		 SELECT t.user_id, t.song_id
		 FROM UNNEST ($1::int[], $2::int[]) AS t(user_id, song_id)
		 ON CONFLICT (user_id, song_id) DO NOTHING`,
		u, s,
	)
	return err
}

func deleteDislikes(ctx context.Context, tx pgx.Tx, pairs []pair) error {
	u, s := pairsToArrays(pairs)
	_, err := tx.Exec(
		ctx,
		`DELETE FROM dislikes d
		 USING UNNEST ($1::int[], $2::int[]) AS t(user_id, song_id)
		 WHERE d.user_id = t.user_id AND d.song_id = t.song_id`,
		u, s,
	)
	return err
}

func deleteLikes(ctx context.Context, tx pgx.Tx, pairs []pair) error {
	u, s := pairsToArrays(pairs)
	_, err := tx.Exec(
		ctx,
		`DELETE FROM likes l
		 USING UNNEST ($1::int[], $2::int[]) AS t(user_id, song_id)
		 WHERE l.user_id = t.user_id AND l.song_id = t.song_id`,
		u, s,
	)
	return err
}

func updateSongCounters(ctx context.Context, tx pgx.Tx, byTrackID map[int]int) error {
	if len(byTrackID) == 0 {
		return nil
	}

	songIDs := make([]int32, 0, len(byTrackID))
	incs := make([]int32, 0, len(byTrackID))
	for id, inc := range byTrackID {
		if id <= 0 || inc <= 0 {
			continue
		}
		songIDs = append(songIDs, int32(id))
		incs = append(incs, int32(inc))
	}
	if len(songIDs) == 0 {
		return nil
	}

	_, err := tx.Exec(
		ctx,
		`UPDATE songs AS s
		 SET play_count = COALESCE(s.play_count, 0) + t.inc,
		     popularity = COALESCE(s.play_count, 0) + t.inc
		 FROM UNNEST ($1::int[], $2::int[]) AS t(song_id, inc)
		 WHERE s.id = t.song_id`,
		songIDs, incs,
	)
	return err
}

func pairsToArrays(pairs []pair) ([]int32, []int32) {
	u := make([]int32, 0, len(pairs))
	s := make([]int32, 0, len(pairs))
	for _, p := range pairs {
		u = append(u, int32(p.UserID))
		s = append(s, int32(p.SongID))
	}
	return u, s
}

func oneDim(n int) []pgtype.ArrayDimension {
	return []pgtype.ArrayDimension{{Length: int32(n), LowerBound: 1}}
}

func textFromPtr(v *string) pgtype.Text {
	if v == nil {
		return pgtype.Text{Valid: false}
	}
	if *v == "" {
		return pgtype.Text{Valid: false}
	}
	return pgtype.Text{String: *v, Valid: true}
}

func floatFromPtr(v *float64) pgtype.Float8 {
	if v == nil {
		return pgtype.Float8{Valid: false}
	}
	return pgtype.Float8{Float64: *v, Valid: true}
}

func textFromJSON(v []byte) pgtype.Text {
	if len(v) == 0 {
		return pgtype.Text{Valid: false}
	}
	return pgtype.Text{String: string(v), Valid: true}
}
