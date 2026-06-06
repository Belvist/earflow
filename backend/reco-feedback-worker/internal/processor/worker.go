package processor

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"sync"
	"time"

	"reco-feedback-worker/internal/config"
	"reco-feedback-worker/internal/db"
	"reco-feedback-worker/internal/health"
	"reco-feedback-worker/internal/metrics"
	"reco-feedback-worker/internal/redisstream"
)

type Worker struct {
	cfg    config.Config
	redis  *redisstream.Client
	db     *db.Pool
	health *health.Server
	m      *metrics.Metrics

	mu            sync.Mutex
	currentCancel context.CancelFunc
}

func New(cfg config.Config, redisClient *redisstream.Client, dbPool *db.Pool, healthServer *health.Server, m *metrics.Metrics) *Worker {
	return &Worker{cfg: cfg, redis: redisClient, db: dbPool, health: healthServer, m: m}
}

func (w *Worker) Run(ctx context.Context) error {
	ctxRun, cancel := context.WithCancel(ctx)
	w.currentCancel = cancel
	defer func() {
		w.currentCancel = nil
	}()

	minIdle := w.cfg.Worker.BlockTimeout * 3
	pendingTicker := time.NewTicker(10 * w.cfg.Worker.BlockTimeout)
	heartbeat := time.NewTicker(w.cfg.Health.HeartbeatInterval)
	defer pendingTicker.Stop()
	defer heartbeat.Stop()

	for {
		select {
		case <-ctxRun.Done():
			return nil
		case <-heartbeat.C:
			w.health.UpdateActivity()
		default:
		}

		select {
		case <-ctxRun.Done():
			return nil
		case <-pendingTicker.C:
			if err := w.processPending(ctxRun, minIdle); err != nil {
				slog.Default().Error("process pending failed", slog.String("err", err.Error()))
			}
			continue
		default:
		}

		msgs, err := w.redis.ReadBatch(ctxRun, w.cfg.Worker.BatchSize, w.cfg.Worker.BlockTimeout)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				return nil
			}
			slog.Default().Error("read batch failed", slog.String("err", err.Error()))
			time.Sleep(w.cfg.Worker.RetryDelay)
			continue
		}
		if len(msgs) == 0 {
			continue
		}

		start := time.Now()
		w.health.UpdateActivity()
		err = w.processBatch(ctxRun, msgs, 0)
		w.m.ObserveDuration(time.Since(start))
		if err != nil {
			slog.Default().Error("batch failed", slog.String("err", err.Error()))
			time.Sleep(w.cfg.Worker.RetryDelay)
		}
	}
}

func (w *Worker) Shutdown(ctx context.Context) error {
	_ = ctx
	if w.currentCancel != nil {
		w.currentCancel()
	}
	return nil
}

func (w *Worker) processPending(ctx context.Context, minIdle time.Duration) error {
	pending, err := w.redis.Pending(ctx, w.cfg.Worker.BatchSize, minIdle)
	if err != nil {
		return err
	}
	if len(pending) == 0 {
		return nil
	}

	ids := make([]string, 0, len(pending))
	maxDeliveries := int64(0)
	for _, p := range pending {
		ids = append(ids, p.ID)
		if p.Deliveries > maxDeliveries {
			maxDeliveries = p.Deliveries
		}
	}

	claimed, err := w.redis.Claim(ctx, ids, minIdle)
	if err != nil {
		return err
	}
	if len(claimed) == 0 {
		return nil
	}

	return w.processBatch(ctx, claimed, maxDeliveries)
}

func (w *Worker) processBatch(ctx context.Context, messages []redisstream.StreamMessage, deliveriesHint int64) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	successIDs := make([]string, 0, len(messages))
	failed := make([]redisstream.StreamMessage, 0)

	interactions := make([]db.Interaction, 0, len(messages))

	type singleEvent struct {
		Type              string           `json:"type"`
		UserID            any              `json:"userId"`
		TrackID           any              `json:"trackId"`
		Action            any              `json:"action"`
		Duration          any              `json:"duration"`
		Progress          any              `json:"progress"`
		SessionID         any              `json:"sessionId"`
		EventID           any              `json:"eventId"`
		PlaybackSessionID any              `json:"playbackSessionId"`
		SchemaVersion     any              `json:"schemaVersion"`
		EventTime         any              `json:"eventTime"`
		Context           any              `json:"context"`
		Interactions      []map[string]any `json:"interactions"`
	}

	for _, msg := range messages {
		payload, _ := json.Marshal(msg.Data)
		var e singleEvent
		if err := json.Unmarshal(payload, &e); err != nil {
			failed = append(failed, msg)
			continue
		}

		fallbackEventID := "reco:" + msg.ID
		fallbackTime := msg.Timestamp
		if fallbackTime <= 0 {
			fallbackTime = time.Now().UnixMilli()
		}

		if e.Type == "single" {
			in := map[string]any{
				"userId":            e.UserID,
				"trackId":           e.TrackID,
				"action":            e.Action,
				"durationMs":        e.Duration,
				"progress":          e.Progress,
				"sessionId":         e.SessionID,
				"eventId":           coalesceString(e.EventID, fallbackEventID),
				"playbackSessionId": coalesceNilString(e.PlaybackSessionID),
				"schemaVersion":     coalesceInt(e.SchemaVersion, 1),
				"eventTime":         coalesceInt64(e.EventTime, fallbackTime),
				"context":           e.Context,
			}
			row, ok := db.Normalize(w.cfg, in)
			if ok {
				if row.EventID == "" {
					row.EventID = fallbackEventID
				}
				interactions = append(interactions, row)
			}
			successIDs = append(successIDs, msg.ID)
			continue
		}

		if e.Type == "batch" && len(e.Interactions) > 0 {
			for _, it := range e.Interactions {
				in := map[string]any{
					"userId":            e.UserID,
					"trackId":           it["trackId"],
					"action":            it["action"],
					"durationMs":        it["duration"],
					"progress":          it["progress"],
					"sessionId":         e.SessionID,
					"eventId":           coalesceString(it["eventId"], fallbackEventID),
					"playbackSessionId": coalesceNilString(it["playbackSessionId"]),
					"schemaVersion":     coalesceInt(it["schemaVersion"], 1),
					"eventTime":         coalesceInt64(it["eventTime"], fallbackTime),
					"context":           it["context"],
				}
				row, ok := db.Normalize(w.cfg, in)
				if ok {
					if row.EventID == "" {
						row.EventID = fallbackEventID
					}
					interactions = append(interactions, row)
				}
			}
			successIDs = append(successIDs, msg.ID)
			continue
		}

		successIDs = append(successIDs, msg.ID)
	}

	res, err := db.RecordInteractionsBatch(ctx, w.cfg, w.db, interactions)
	if err != nil {
		failed = append(failed, messages...)
		successIDs = successIDs[:0]
		w.m.EventsProcessed.WithLabelValues("error").Add(float64(len(interactions)))
		return err
	}

	if res.Recorded > 0 {
		w.m.EventsProcessed.WithLabelValues("success").Add(float64(res.Recorded))
		w.m.BatchSize.Observe(float64(res.Recorded))
		w.markRealtimeDelta(ctx, res.Fresh)
		w.observeRecommendationHits(ctx, res.Fresh)
	}

	if len(successIDs) > 0 {
		_, _ = w.redis.Ack(ctx, successIDs)
	}

	if len(failed) > 0 {
		retries := 1
		if w.cfg.Worker.UseDeliveryCount && deliveriesHint > 0 {
			retries = int(deliveriesHint)
		}
		if retries >= w.cfg.Worker.MaxRetries {
			for _, msg := range failed {
				_ = w.redis.MoveToDLQ(ctx, msg.ID, msg.Data, "process_failed")
				w.m.DlqTotal.Inc()
			}
		} else {
			w.m.RetriesTotal.Inc()
		}
	}
	return nil
}

func (w *Worker) markRealtimeDelta(ctx context.Context, interactions []db.Interaction) {
	if len(interactions) == 0 {
		return
	}
	items := make([]redisstream.RealtimeInteraction, 0, len(interactions))
	for _, it := range interactions {
		items = append(items, redisstream.RealtimeInteraction{
			UserID:  it.UserID,
			TrackID: it.TrackID,
			Action:  it.Action,
		})
	}
	ops, err := w.redis.MarkRealtimeDelta(ctx, items)
	if err != nil {
		w.m.RealtimeDeltaUpdates.WithLabelValues("error").Add(float64(len(items)))
		return
	}
	if ops > 0 {
		w.m.RealtimeDeltaUpdates.WithLabelValues("success").Add(float64(ops))
	}
}

func (w *Worker) observeRecommendationHits(ctx context.Context, interactions []db.Interaction) {
	hitActions := map[string]struct{}{"like": {}, "complete": {}}
	bySession := map[string]struct {
		likes     []int
		completes []int
	}{}

	for _, it := range interactions {
		if it.SessionID == nil || *it.SessionID == "" {
			continue
		}
		if _, ok := hitActions[it.Action]; !ok {
			continue
		}
		entry := bySession[*it.SessionID]
		if it.Action == "like" {
			entry.likes = append(entry.likes, it.TrackID)
		} else {
			entry.completes = append(entry.completes, it.TrackID)
		}
		bySession[*it.SessionID] = entry
	}

	likeHits := 0
	completeHits := 0
	for sessionID, ids := range bySession {
		all := append(append([]int{}, ids.likes...), ids.completes...)
		if len(all) == 0 {
			continue
		}
		membership, err := w.redis.SessionHadImpressions(ctx, sessionID, all)
		if err != nil {
			continue
		}
		for _, id := range ids.likes {
			if membership[id] {
				likeHits += 1
			}
		}
		for _, id := range ids.completes {
			if membership[id] {
				completeHits += 1
			}
		}
	}

	if likeHits > 0 {
		w.m.RecommendationHits.WithLabelValues("like").Add(float64(likeHits))
	}
	if completeHits > 0 {
		w.m.RecommendationHits.WithLabelValues("complete").Add(float64(completeHits))
	}
}

func coalesceString(v any, fallback string) string {
	s, _ := v.(string)
	if s == "" {
		return fallback
	}
	return s
}

func coalesceNilString(v any) any {
	s, _ := v.(string)
	if s == "" {
		return nil
	}
	return s
}

func coalesceInt(v any, fallback int) int {
	switch x := v.(type) {
	case int:
		if x > 0 {
			return x
		}
	case int64:
		if x > 0 {
			return int(x)
		}
	case float64:
		if x > 0 {
			return int(x)
		}
	}
	return fallback
}

func coalesceInt64(v any, fallback int64) int64 {
	switch x := v.(type) {
	case int:
		if int64(x) > 0 {
			return int64(x)
		}
	case int64:
		if x > 0 {
			return x
		}
	case float64:
		if int64(x) > 0 {
			return int64(x)
		}
	}
	return fallback
}
