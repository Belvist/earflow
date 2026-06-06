package home

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	DB               DBConfig
	Redis            RedisConfig
	LibraryUserID    int
	CacheTTL         time.Duration
	CandidateLimit   int
	MaxRails         int
	MaxPlaylists     int
	PlaylistsPerRail int
	TrackLimit       int
}

type DBConfig struct {
	Host           string
	Port           int
	Name           string
	User           string
	Password       string
	MaxConns       int32
	ConnectTimeout time.Duration
	Prepare        bool
}

type RedisConfig struct {
	Host     string
	Port     int
	Password string
	DB       int
	Prefix   string
}

func LoadConfig() (Config, bool, error) {
	cfg := Config{
		DB: DBConfig{
			Host:           stringEnv("DB_HOST", "postgres"),
			Port:           intEnv("DB_PORT", 5432),
			Name:           stringEnv("DB_NAME", ""),
			User:           stringEnv("DB_USER", ""),
			Password:       stringEnv("DB_PASSWORD", ""),
			MaxConns:       int32(clampInt(intEnv("RANKING_DB_MAX_CONNECTIONS", 8), 1, 50)),
			ConnectTimeout: durationMsEnv("RANKING_DB_CONNECT_TIMEOUT_MS", 1500),
			Prepare:        boolEnv("DB_PREPARE", true),
		},
		Redis: RedisConfig{
			Host:     stringEnv("REDIS_HOST", "redis"),
			Port:     intEnv("REDIS_PORT", 6379),
			Password: stringEnv("REDIS_PASSWORD", ""),
			DB:       intEnv("REDIS_DB", 0),
			Prefix:   stringEnv("RECO_REDIS_KEY_PREFIX", "reco:"),
		},
		LibraryUserID:    clampInt(intEnv("LIBRARY_USER_ID", 1), 1, 1_000_000_000),
		CacheTTL:         durationSecondsEnv("RECO_HOME_CACHE_TTL_SECONDS", 60, 30, 300),
		CandidateLimit:   clampInt(intEnv("RECO_HOME_CANDIDATE_LIMIT", 2000), 100, 5000),
		MaxRails:         clampInt(intEnv("RECO_HOME_MAX_RAILS", 6), 3, 8),
		MaxPlaylists:     clampInt(intEnv("RECO_HOME_MAX_PLAYLISTS", 60), 10, 80),
		PlaylistsPerRail: clampInt(intEnv("RECO_HOME_PLAYLISTS_PER_RAIL", 10), 2, 12),
		TrackLimit:       clampInt(intEnv("RECO_HOME_TRACK_LIMIT", 12), 5, 40),
	}

	if cfg.DB.Name == "" || cfg.DB.User == "" {
		return cfg, false, nil
	}
	return cfg, true, nil
}

func (c DBConfig) DSN() string {
	dsn := fmt.Sprintf("postgres://%s:%s@%s:%d/%s", urlEscape(c.User), urlEscape(c.Password), c.Host, c.Port, c.Name)
	if !c.Prepare {
		dsn += "?default_query_exec_mode=simple_protocol"
	}
	return dsn
}

func stringEnv(name, def string) string {
	v := strings.TrimSpace(os.Getenv(name))
	if v == "" {
		return def
	}
	return v
}

func intEnv(name string, def int) int {
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

func boolEnv(name string, def bool) bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(name)))
	if v == "" {
		return def
	}
	switch v {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return def
	}
}

func durationMsEnv(name string, defMs int) time.Duration {
	ms := intEnv(name, defMs)
	if ms <= 0 {
		ms = defMs
	}
	return time.Duration(ms) * time.Millisecond
}

func durationSecondsEnv(name string, defSeconds, minSeconds, maxSeconds int) time.Duration {
	seconds := clampInt(intEnv(name, defSeconds), minSeconds, maxSeconds)
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

func urlEscape(s string) string {
	out := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		b := s[i]
		if (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || (b >= '0' && b <= '9') || b == '-' || b == '_' || b == '.' || b == '~' {
			out = append(out, b)
		} else {
			hex := "0123456789ABCDEF"
			out = append(out, '%', hex[b>>4], hex[b&15])
		}
	}
	return string(out)
}
