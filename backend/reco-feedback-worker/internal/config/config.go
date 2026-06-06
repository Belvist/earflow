package config

import (
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	DB       DBConfig
	Redis    RedisConfig
	Keys     KeysConfig
	Realtime RealtimeConfig
	Worker   WorkerConfig
	Health   HealthConfig
	Taste    TasteConfig
	Logging  LoggingConfig
}

type DBConfig struct {
	Host              string
	Port              int
	Name              string
	User              string
	Password          string
	MaxConns          int32
	ConnTimeout       time.Duration
	StatementTimeout  time.Duration
	CircuitFailThresh int
	CircuitCooldown   time.Duration
	Prepare           bool
}

type RedisConfig struct {
	Host          string
	Port          int
	Password      string
	DB            int
	ConnectTimout time.Duration
}

type KeysConfig struct {
	Prefix          string
	FeedbackStream  string
	FeedbackGroup   string
	FeedbackDLQ     string
	ImpressionsKey  func(sessionID string) string
	RecentTrackKey  func(userID int, trackID int) string
	SkipTrackKey    func(userID int, trackID int) string
	DislikeTrackKey func(userID int, trackID int) string
	DailySeenKey    func(userID int) string
}

type RealtimeConfig struct {
	RecentTTL    time.Duration
	SkipTTL      time.Duration
	DislikeTTL   time.Duration
	DailySeenTTL time.Duration
}

type WorkerConfig struct {
	BatchSize        int
	BlockTimeout     time.Duration
	MaxRetries       int
	RetryDelay       time.Duration
	ShutdownTimeout  time.Duration
	ConsumerName     string
	UseDeliveryCount bool
}

type HealthConfig struct {
	Port              int
	MaxInactivity     time.Duration
	HeartbeatInterval time.Duration
}

type TasteConfig struct {
	MaxClusters          int
	NewClusterDistThresh float64
	UserAlpha            float64
	ImplicitAlpha        float64
	DislikeAlpha         float64
	ImplicitMinPlaySec   int
	MaxDuration          time.Duration
	AllowedActions       map[string]struct{}
}

type LoggingConfig struct {
	Level slog.Level
}

func Load() (Config, error) {
	prefix := getString("RECO_REDIS_KEY_PREFIX", "reco:")
	feedbackStream := prefix + "feedback:stream"
	dlq := prefix + "feedback:dlq"

	cfg := Config{
		DB: DBConfig{
			Host:              getString("DB_HOST", "localhost"),
			Port:              getInt("DB_PORT", 5432),
			Name:              getString("DB_NAME", ""),
			User:              getString("DB_USER", ""),
			Password:          getString("DB_PASSWORD", ""),
			MaxConns:          int32(getInt("DB_MAX_CONNECTIONS", 10)),
			ConnTimeout:       getDurationMs("DB_CONNECTION_TIMEOUT_MS", 5000),
			StatementTimeout:  getDurationMs("RECO_DB_STATEMENT_TIMEOUT_MS", 30000),
			CircuitFailThresh: getInt("RECO_DB_CB_FAILURE_THRESHOLD", 5),
			CircuitCooldown:   getDurationMs("RECO_DB_CB_COOLDOWN_MS", 30000),
			Prepare:           getBool("DB_PREPARE", true),
		},
		Redis: RedisConfig{
			Host:          getString("REDIS_HOST", "localhost"),
			Port:          getInt("REDIS_PORT", 6379),
			Password:      getString("REDIS_PASSWORD", ""),
			DB:            getInt("REDIS_DB", 0),
			ConnectTimout: getDurationMs("REDIS_CONNECT_TIMEOUT_MS", 5000),
		},
		Keys: KeysConfig{
			Prefix:         prefix,
			FeedbackStream: feedbackStream,
			FeedbackGroup:  "feedback-workers",
			FeedbackDLQ:    dlq,
			ImpressionsKey: func(sessionID string) string {
				return prefix + "session:" + sessionID + ":impressions"
			},
			RecentTrackKey: func(userID int, trackID int) string {
				return prefix + "rt:recent:" + itoa(userID) + ":" + itoa(trackID)
			},
			SkipTrackKey: func(userID int, trackID int) string {
				return prefix + "rt:skip:" + itoa(userID) + ":" + itoa(trackID)
			},
			DislikeTrackKey: func(userID int, trackID int) string {
				return prefix + "rt:dislike:" + itoa(userID) + ":" + itoa(trackID)
			},
			DailySeenKey: func(userID int) string {
				return prefix + "seen:today:" + itoa(userID)
			},
		},
		Realtime: RealtimeConfig{
			RecentTTL:    getDurationSeconds("RECO_REALTIME_RECENT_TTL_SECONDS", 172800, 60, 604800),
			SkipTTL:      getDurationSeconds("RECO_REALTIME_SKIP_TTL_SECONDS", 172800, 60, 604800),
			DislikeTTL:   getDurationSeconds("RECO_REALTIME_DISLIKE_TTL_SECONDS", 2592000, 60, 31536000),
			DailySeenTTL: getDurationSeconds("RECO_DAILY_SEEN_TTL_SECONDS", 172800, 60, 604800),
		},
		Worker: WorkerConfig{
			BatchSize:        clampInt(getInt("RECO_FEEDBACK_BATCH_SIZE", 200), 1, 1000),
			BlockTimeout:     getDurationMs("RECO_FEEDBACK_BLOCK_TIMEOUT_MS", 5000),
			MaxRetries:       clampInt(getInt("RECO_FEEDBACK_MAX_RETRIES", 5), 1, 1000),
			RetryDelay:       getDurationMs("RECO_FEEDBACK_RETRY_DELAY_MS", 1000),
			ShutdownTimeout:  getDurationMs("RECO_FEEDBACK_SHUTDOWN_TIMEOUT_MS", 30000),
			ConsumerName:     getString("RECO_FEEDBACK_CONSUMER_NAME", ""),
			UseDeliveryCount: getBool("RECO_FEEDBACK_USE_DELIVERY_RETRIES", false),
		},
		Health: HealthConfig{
			Port:              getInt("FEEDBACK_WORKER_HEALTH_PORT", 3016),
			MaxInactivity:     5 * time.Minute,
			HeartbeatInterval: 60 * time.Second,
		},
		Taste: TasteConfig{
			MaxClusters:          clampInt(getInt("RECO_TASTE_MAX_CLUSTERS", 5), 1, 5),
			NewClusterDistThresh: clampFloat(getFloat("RECO_TASTE_NEW_CLUSTER_DIST_THRESHOLD", 0.25), 0.05, 1.0),
			UserAlpha:            clampFloat(getFloat("RECO_USER_EMBEDDING_ALPHA", 0.05), 0.001, 0.5),
			ImplicitAlpha:        clampFloat(getFloat("RECO_IMPLICIT_USER_EMBEDDING_ALPHA", 0.01), 0.0001, 0.2),
			DislikeAlpha:         clampFloat(getFloat("RECO_DISLIKE_USER_EMBEDDING_ALPHA", 0.01), 0.0001, 0.2),
			ImplicitMinPlaySec:   clampInt(getInt("RECO_IMPLICIT_MIN_PLAY_SECONDS", 30), 1, 3600),
			MaxDuration:          time.Duration(clampInt(getInt("RECO_MAX_DURATION_MS", int((24*time.Hour)/time.Millisecond)), 1000, int((24*time.Hour)/time.Millisecond))) * time.Millisecond,
			AllowedActions:       map[string]struct{}{"play": {}, "pause": {}, "skip": {}, "complete": {}, "like": {}, "dislike": {}, "seek": {}},
		},
		Logging: LoggingConfig{Level: parseLogLevel(getString("LOG_LEVEL", "info"))},
	}

	if cfg.Worker.ConsumerName == "" {
		host, _ := os.Hostname()
		cfg.Worker.ConsumerName = "worker-" + sanitizeConsumerName(host)
	}

	if cfg.DB.Name == "" || cfg.DB.User == "" {
		return Config{}, fmt.Errorf("DB_NAME and DB_USER must be set")
	}

	return cfg, nil
}

func getString(name, def string) string {
	v := strings.TrimSpace(os.Getenv(name))
	if v == "" {
		return def
	}
	return v
}

func getInt(name string, def int) int {
	v := strings.TrimSpace(os.Getenv(name))
	if v == "" {
		return def
	}
	i, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return i
}

func getFloat(name string, def float64) float64 {
	v := strings.TrimSpace(os.Getenv(name))
	if v == "" {
		return def
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return def
	}
	return f
}

func getBool(name string, def bool) bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv(name)))
	if v == "" {
		return def
	}
	if v == "true" || v == "1" || v == "yes" || v == "on" {
		return true
	}
	if v == "false" || v == "0" || v == "no" || v == "off" {
		return false
	}
	return def
}

func getDurationMs(name string, defMs int) time.Duration {
	ms := getInt(name, defMs)
	if ms <= 0 {
		ms = defMs
	}
	return time.Duration(ms) * time.Millisecond
}

func getDurationSeconds(name string, defSeconds int, minSeconds int, maxSeconds int) time.Duration {
	seconds := clampInt(getInt(name, defSeconds), minSeconds, maxSeconds)
	return time.Duration(seconds) * time.Second
}

func clampInt(v, min, max int) int {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

func clampFloat(v, min, max float64) float64 {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

func sanitizeConsumerName(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	out := make([]rune, 0, len(s))
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			out = append(out, r)
		}
	}
	if len(out) == 0 {
		return "unknown"
	}
	if len(out) > 50 {
		out = out[:50]
	}
	return string(out)
}

func parseLogLevel(v string) slog.Level {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "debug", "trace":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

func itoa(v int) string {
	if v == 0 {
		return "0"
	}
	neg := false
	if v < 0 {
		neg = true
		v = -v
	}
	buf := make([]byte, 0, 16)
	for v > 0 {
		buf = append(buf, byte('0'+v%10))
		v /= 10
	}
	for i, j := 0, len(buf)-1; i < j; i, j = i+1, j-1 {
		buf[i], buf[j] = buf[j], buf[i]
	}
	if neg {
		buf = append([]byte{'-'}, buf...)
	}
	return string(buf)
}
