package config

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	HTTP       HTTPConfig
	Postgres   PostgresConfig
	Meili      MeiliConfig
	Indexer    IndexerConfig
	Logging    LoggingConfig
	InstanceID string
}

type HTTPConfig struct {
	Port           int
	PublicMaxLimit int
	AuthedMaxLimit int
	RequestTimeout time.Duration
}

type PostgresConfig struct {
	Host     string
	Port     int
	Name     string
	User     string
	Password string
	SSLMode  string
	MaxConns int32
	Prepare  bool
}

type MeiliConfig struct {
	URL     string
	APIKey  string
	Indexes IndexNames
}

type IndexNames struct {
	Tracks  string
	Artists string
	Albums  string
}

type IndexerConfig struct {
	Enabled         bool
	SetupIndexes    bool
	BackfillOnStart bool
	BatchSize       int
	LockTTL         time.Duration
	BaseBackoff     time.Duration
	MaxBackoff      time.Duration
	PollInterval    time.Duration
}

type LoggingConfig struct {
	Level slog.Level
}

func Load() (Config, error) {
	instanceID := strings.TrimSpace(os.Getenv("INSTANCE_ID"))
	if instanceID == "" {
		instanceID = newInstanceID()
	}

	cfg := Config{
		InstanceID: instanceID,
		HTTP: HTTPConfig{
			Port:           getInt("PORT", 3062),
			PublicMaxLimit: clampInt(getInt("SEARCH_PUBLIC_MAX_LIMIT", 20), 1, 50),
			AuthedMaxLimit: clampInt(getInt("SEARCH_AUTHED_MAX_LIMIT", 50), 1, 100),
			RequestTimeout: getDurationMs("SEARCH_REQUEST_TIMEOUT_MS", 2500),
		},
		Postgres: PostgresConfig{
			Host:     getString("DB_HOST", "postgres"),
			Port:     getInt("DB_PORT", 5432),
			Name:     getString("DB_NAME", ""),
			User:     getString("DB_USER", ""),
			Password: getString("DB_PASSWORD", ""),
			SSLMode:  getString("DB_SSLMODE", "disable"),
			MaxConns: int32(clampInt(getInt("DB_MAX_CONNECTIONS", 10), 1, 100)),
			Prepare:  getBool("DB_PREPARE", true),
		},
		Meili: MeiliConfig{
			URL:    getString("MEILI_URL", "http://meilisearch:7700"),
			APIKey: getString("MEILI_API_KEY", ""),
			Indexes: IndexNames{
				Tracks:  getString("MEILI_INDEX_TRACKS", "tracks_v1"),
				Artists: getString("MEILI_INDEX_ARTISTS", "artists_v1"),
				Albums:  getString("MEILI_INDEX_ALBUMS", "albums_v1"),
			},
		},
		Indexer: IndexerConfig{
			Enabled:         getBool("SEARCH_INDEXER_ENABLED", true),
			SetupIndexes:    getBool("SEARCH_SETUP_INDEXES", true),
			BackfillOnStart: getBool("SEARCH_BACKFILL_ON_START", true),
			BatchSize:       clampInt(getInt("SEARCH_INDEXER_BATCH", 50), 1, 500),
			LockTTL:         getDurationMs("SEARCH_INDEXER_LOCK_TTL_MS", 60000),
			BaseBackoff:     getDurationMs("SEARCH_INDEXER_BACKOFF_BASE_MS", 1000),
			MaxBackoff:      getDurationMs("SEARCH_INDEXER_BACKOFF_MAX_MS", 300000),
			PollInterval:    getDurationMs("SEARCH_INDEXER_POLL_INTERVAL_MS", 500),
		},
		Logging: LoggingConfig{Level: parseLogLevel(getString("LOG_LEVEL", "info"))},
	}

	if cfg.Postgres.Name == "" || cfg.Postgres.User == "" {
		return Config{}, fmt.Errorf("DB_NAME and DB_USER must be set")
	}
	if cfg.Meili.URL == "" {
		return Config{}, fmt.Errorf("MEILI_URL must be set")
	}

	return cfg, nil
}

func (c HTTPConfig) Addr() string { return ":" + strconv.Itoa(c.Port) }

func (c PostgresConfig) DSN() string {
	host := strings.TrimSpace(c.Host)
	if host == "" {
		host = "postgres"
	}
	sslmode := strings.TrimSpace(c.SSLMode)
	if sslmode == "" {
		sslmode = "disable"
	}
	dsn := fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=%s&pool_max_conns=%d", urlQueryEscape(c.User), urlQueryEscape(c.Password), host, c.Port, urlQueryEscape(c.Name), sslmode, c.MaxConns)
	if !c.Prepare {
		dsn += "&default_query_exec_mode=simple_protocol"
	}
	return dsn
}

func urlQueryEscape(v string) string {
	r := strings.ReplaceAll(v, "%", "%25")
	r = strings.ReplaceAll(r, "+", "%2B")
	r = strings.ReplaceAll(r, " ", "%20")
	r = strings.ReplaceAll(r, "#", "%23")
	r = strings.ReplaceAll(r, "&", "%26")
	r = strings.ReplaceAll(r, "?", "%3F")
	r = strings.ReplaceAll(r, "/", "%2F")
	r = strings.ReplaceAll(r, ":", "%3A")
	r = strings.ReplaceAll(r, "@", "%40")
	return r
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

func clampInt(v, min, max int) int {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
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

func newInstanceID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
