package loadtest

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/rand/v2"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type Config struct {
	RedisAddr     string
	RedisPassword string
	RedisDB       int
	Stream        string
	Group         string

	PostgresDSN string

	TotalInteractions      int
	InteractionsPerMessage int
	PublisherConcurrency   int
	PipelineSize           int

	UserPoolSize  int
	TrackPoolSize int

	ActionPlayRate     float64
	ActionCompleteRate float64
	ActionSkipRate     float64
	ActionLikeRate     float64
	ActionDislikeRate  float64

	DurationMsMin int
	DurationMsMax int

	ProgressSkipMin float64
	ProgressSkipMax float64

	SessionPrefix string
	EventPrefix   string

	DrainTimeout time.Duration
	DrainPoll    time.Duration
}

type Result struct {
	TotalInteractions int
	TotalMessages     int
	PublishedIn       time.Duration
	DrainedIn         time.Duration
	TotalDuration     time.Duration
}

func DefaultConfig() Config {
	prefix := strings.TrimSpace(os.Getenv("RECO_REDIS_KEY_PREFIX"))
	if prefix == "" {
		prefix = "reco:"
	}

	redisHost := strings.TrimSpace(os.Getenv("REDIS_HOST"))
	if redisHost == "" {
		redisHost = "localhost"
	}
	redisPort := strings.TrimSpace(os.Getenv("REDIS_PORT"))
	if redisPort == "" {
		redisPort = "6379"
	}

	redisDB := 0
	if v := strings.TrimSpace(os.Getenv("REDIS_DB")); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			redisDB = n
		}
	}

	pgHost := strings.TrimSpace(os.Getenv("DB_HOST"))
	if pgHost == "" {
		pgHost = "localhost"
	}
	pgPort := strings.TrimSpace(os.Getenv("DB_PORT"))
	if pgPort == "" {
		pgPort = "5432"
	}
	pgName := strings.TrimSpace(os.Getenv("DB_NAME"))
	pgUser := strings.TrimSpace(os.Getenv("DB_USER"))
	pgPass := os.Getenv("DB_PASSWORD")

	pgDSN := ""
	if pgName != "" && pgUser != "" {
		pgDSN = fmt.Sprintf("postgres://%s:%s@%s:%s/%s", urlEscape(pgUser), urlEscape(pgPass), pgHost, pgPort, urlEscape(pgName))
	}

	return Config{
		RedisAddr:     redisHost + ":" + redisPort,
		RedisPassword: os.Getenv("REDIS_PASSWORD"),
		RedisDB:       redisDB,
		Stream:        prefix + "feedback:stream",
		Group:         "feedback-workers",
		PostgresDSN:   pgDSN,

		TotalInteractions:      1_000_000,
		InteractionsPerMessage: 200,
		PublisherConcurrency:   4,
		PipelineSize:           500,

		UserPoolSize:  50,
		TrackPoolSize: 5000,

		ActionPlayRate:     0.80,
		ActionCompleteRate: 0.10,
		ActionSkipRate:     0.10,
		ActionLikeRate:     0.0,
		ActionDislikeRate:  0.0,

		DurationMsMin: 5_000,
		DurationMsMax: 120_000,

		ProgressSkipMin: 0.0,
		ProgressSkipMax: 0.8,

		SessionPrefix: "loadgen-sess-",
		EventPrefix:   "loadgen",

		DrainTimeout: 20 * time.Minute,
		DrainPoll:    2 * time.Second,
	}
}

func ValidateConfig(cfg Config) error {
	if err := validateBasics(cfg); err != nil {
		return err
	}
	if err := validateRates(cfg); err != nil {
		return err
	}
	return validateTimings(cfg)
}

func validateBasics(cfg Config) error {
	if cfg.RedisAddr == "" {
		return fmt.Errorf("redis addr is required")
	}
	if cfg.Stream == "" || cfg.Group == "" {
		return fmt.Errorf("stream and group are required")
	}
	if cfg.TotalInteractions <= 0 {
		return fmt.Errorf("total interactions must be > 0")
	}
	if cfg.InteractionsPerMessage <= 0 {
		return fmt.Errorf("interactions per message must be > 0")
	}
	if cfg.PublisherConcurrency <= 0 {
		return fmt.Errorf("publisher concurrency must be > 0")
	}
	if cfg.PipelineSize <= 0 {
		return fmt.Errorf("pipeline size must be > 0")
	}
	if cfg.DurationMsMin < 0 || cfg.DurationMsMax <= 0 || cfg.DurationMsMax < cfg.DurationMsMin {
		return fmt.Errorf("invalid duration range")
	}
	return nil
}

func validateTimings(cfg Config) error {
	if cfg.DrainPoll <= 0 || cfg.DrainTimeout <= 0 {
		return fmt.Errorf("invalid drain timings")
	}
	return nil
}

func validateRates(cfg Config) error {
	rates := []float64{cfg.ActionPlayRate, cfg.ActionCompleteRate, cfg.ActionSkipRate, cfg.ActionLikeRate, cfg.ActionDislikeRate}
	for _, r := range rates {
		if math.IsNaN(r) || math.IsInf(r, 0) || r < 0 {
			return fmt.Errorf("invalid action rates")
		}
	}
	sum := cfg.ActionPlayRate + cfg.ActionCompleteRate + cfg.ActionSkipRate + cfg.ActionLikeRate + cfg.ActionDislikeRate
	if sum <= 0 {
		return fmt.Errorf("sum action rates must be > 0")
	}
	return nil
}

func Run(ctx context.Context, cfg Config) (Result, error) {
	if err := ValidateConfig(cfg); err != nil {
		return Result{}, err
	}

	redisClient := redis.NewClient(&redis.Options{
		Addr:        cfg.RedisAddr,
		Password:    cfg.RedisPassword,
		DB:          cfg.RedisDB,
		DialTimeout: 5 * time.Second,
	})
	defer redisClient.Close()

	if err := ensureGroup(ctx, redisClient, cfg.Stream, cfg.Group); err != nil {
		return Result{}, err
	}

	users, tracks, err := resolvePools(ctx, cfg)
	if err != nil {
		return Result{}, err
	}
	if len(users) == 0 {
		users = []int{1}
	}
	if len(tracks) == 0 {
		return Result{}, fmt.Errorf("track pool is empty; provide DB credentials or ensure songs exist")
	}

	start := time.Now()
	publishedStart := time.Now()
	messages := int(math.Ceil(float64(cfg.TotalInteractions) / float64(cfg.InteractionsPerMessage)))

	err = publishInteractions(ctx, redisClient, cfg, users, tracks)
	publishedIn := time.Since(publishedStart)
	if err != nil {
		return Result{}, err
	}

	drainStart := time.Now()
	drainCtx, cancel := context.WithTimeout(ctx, cfg.DrainTimeout)
	defer cancel()
	if err := waitDrained(drainCtx, redisClient, cfg.Stream, cfg.Group, cfg.DrainPoll); err != nil {
		return Result{}, err
	}
	drainedIn := time.Since(drainStart)

	return Result{
		TotalInteractions: cfg.TotalInteractions,
		TotalMessages:     messages,
		PublishedIn:       publishedIn,
		DrainedIn:         drainedIn,
		TotalDuration:     time.Since(start),
	}, nil
}

func ensureGroup(ctx context.Context, rdb *redis.Client, stream string, group string) error {
	err := rdb.XGroupCreateMkStream(ctx, stream, group, "0").Err()
	if err == nil {
		return nil
	}
	if strings.Contains(err.Error(), "BUSYGROUP") {
		return nil
	}
	return err
}

func resolvePools(ctx context.Context, cfg Config) ([]int, []int, error) {
	if strings.TrimSpace(cfg.PostgresDSN) == "" {
		return []int{1}, nil, nil
	}

	pool, err := pgxpool.New(ctx, cfg.PostgresDSN)
	if err != nil {
		return nil, nil, err
	}
	defer pool.Close()

	users, err := fetchIDs(ctx, pool, "SELECT id FROM users ORDER BY id LIMIT $1", cfg.UserPoolSize)
	if err != nil {
		return nil, nil, err
	}
	tracks, err := fetchIDs(ctx, pool, "SELECT id FROM songs ORDER BY id LIMIT $1", cfg.TrackPoolSize)
	if err != nil {
		return nil, nil, err
	}
	return users, tracks, nil
}

func fetchIDs(ctx context.Context, pool *pgxpool.Pool, sql string, limit int) ([]int, error) {
	if limit <= 0 {
		return nil, nil
	}
	rows, err := pool.Query(ctx, sql, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]int, 0, limit)
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func publishInteractions(ctx context.Context, rdb *redis.Client, cfg Config, users []int, tracks []int) error {
	messages := int(math.Ceil(float64(cfg.TotalInteractions) / float64(cfg.InteractionsPerMessage)))
	workCh := make(chan int, cfg.PublisherConcurrency*2)
	errCh := make(chan error, 1)

	for w := 0; w < cfg.PublisherConcurrency; w++ {
		go func(worker int) {
			rng := rand.New(rand.NewPCG(uint64(time.Now().UnixNano())+uint64(worker), uint64(worker+1)))
			buf := make([]int, 0, cfg.PipelineSize)
			for idx := range workCh {
				if ctx.Err() != nil {
					return
				}
				buf = append(buf, idx)
				if len(buf) < cfg.PipelineSize {
					continue
				}
				if err := publishMessageBatch(ctx, rdb, cfg, users, tracks, rng, buf); err != nil {
					select {
					case errCh <- err:
					default:
					}
					return
				}
				buf = buf[:0]
			}
			if len(buf) > 0 {
				if err := publishMessageBatch(ctx, rdb, cfg, users, tracks, rng, buf); err != nil {
					select {
					case errCh <- err:
					default:
					}
					return
				}
			}
		}(w)
	}

	for i := 0; i < messages; i++ {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case err := <-errCh:
			return err
		case workCh <- i:
		}
	}
	close(workCh)

	select {
	case err := <-errCh:
		return err
	default:
		return nil
	}
}

func publishMessageBatch(ctx context.Context, rdb *redis.Client, cfg Config, users []int, tracks []int, rng *rand.Rand, indices []int) error {
	pipe := rdb.Pipeline()
	for _, msgIndex := range indices {
		if err := addOneMessage(ctx, pipe, cfg, users, tracks, rng, msgIndex); err != nil {
			return err
		}
	}
	_, err := pipe.Exec(ctx)
	return err
}

func addOneMessage(ctx context.Context, pipe redis.Pipeliner, cfg Config, users []int, tracks []int, rng *rand.Rand, msgIndex int) error {
	n := cfg.InteractionsPerMessage
	startIdx := msgIndex * cfg.InteractionsPerMessage
	remaining := cfg.TotalInteractions - startIdx
	if remaining < n {
		n = remaining
	}
	if n <= 0 {
		return nil
	}

	userID := users[rng.IntN(len(users))]
	sessionID := sessionID(cfg.SessionPrefix, userID)
	nowMs := time.Now().UnixMilli()

	interactions := make([]map[string]any, 0, n)
	for i := 0; i < n; i++ {
		trackID := tracks[rng.IntN(len(tracks))]
		action := pickAction(cfg, rng)
		duration := rng.IntN(cfg.DurationMsMax-cfg.DurationMsMin+1) + cfg.DurationMsMin

		var progress any
		switch action {
		case "skip", "dislike":
			progress = clampFloat64(cfg.ProgressSkipMin+(cfg.ProgressSkipMax-cfg.ProgressSkipMin)*rng.Float64(), 0, 1)
		default:
			progress = nil
		}

		interaction := map[string]any{
			"trackId":     trackID,
			"action":      action,
			"duration":    duration,
			"progress":    progress,
			"eventId":     buildEventID(cfg.EventPrefix, userID, trackID, msgIndex, i),
			"eventTime":   nowMs,
			"schemaVersion": 2,
			"context":     nil,
		}
		interactions = append(interactions, interaction)
	}

	payload := map[string]any{
		"type":        "batch",
		"userId":      userID,
		"sessionId":   sessionID,
		"interactions": interactions,
	}

	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	pipe.XAdd(ctx, &redis.XAddArgs{Stream: cfg.Stream, ID: "*", Values: map[string]any{
		"data":      string(b),
		"timestamp": strconv.FormatInt(nowMs, 10),
	}})
	return nil
}

func waitDrained(ctx context.Context, rdb *redis.Client, stream string, group string, poll time.Duration) error {
	ticker := time.NewTicker(poll)
	defer ticker.Stop()

	for {
		pending, err := rdb.XPending(ctx, stream, group).Result()
		if err != nil {
			if errors.Is(err, redis.Nil) {
				return nil
			}
			return err
		}
		lag, err := groupLag(ctx, rdb, stream, group)
		if err != nil {
			return err
		}

		if pending.Count == 0 && lag == 0 {
			return nil
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func groupLag(ctx context.Context, rdb *redis.Client, stream string, group string) (int64, error) {
	groups, err := rdb.XInfoGroups(ctx, stream).Result()
	if err != nil {
		return 0, err
	}
	for _, g := range groups {
		if g.Name == group {
			return g.Lag, nil
		}
	}
	return -1, nil
}

func pickAction(cfg Config, rng *rand.Rand) string {
	sum := cfg.ActionPlayRate + cfg.ActionCompleteRate + cfg.ActionSkipRate + cfg.ActionLikeRate + cfg.ActionDislikeRate
	r := rng.Float64() * sum

	if r < cfg.ActionPlayRate {
		return "play"
	}
	r -= cfg.ActionPlayRate
	if r < cfg.ActionCompleteRate {
		return "complete"
	}
	r -= cfg.ActionCompleteRate
	if r < cfg.ActionSkipRate {
		return "skip"
	}
	r -= cfg.ActionSkipRate
	if r < cfg.ActionLikeRate {
		return "like"
	}
	return "dislike"
}

func buildEventID(prefix string, userID int, trackID int, msgIndex int, interactionIndex int) string {
	key := fmt.Sprintf("%s:%d:%d:%d:%d", prefix, userID, trackID, msgIndex, interactionIndex)
	sum := sha1.Sum([]byte(key))
	h := hex.EncodeToString(sum[:])
	return prefix + ":" + h
}

func sessionID(prefix string, userID int) string {
	return prefix + strconv.Itoa(userID)
}

func clampFloat64(v float64, min float64, max float64) float64 {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

func urlEscape(s string) string {
	r := strings.NewReplacer(
		":", "%3A",
		"/", "%2F",
		"?", "%3F",
		"#", "%23",
		"[", "%5B",
		"]", "%5D",
		"@", "%40",
	)
	return r.Replace(s)
}
