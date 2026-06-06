package config

import (
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	HTTP     HTTPConfig
	Postgres PostgresConfig
	Redis    RedisConfig
	JWT      JWTConfig
	Crypto   CryptoConfig
	Security SecurityConfig
	Logging  LoggingConfig
	// ServiceKeyGateway validates X-Service-Token on /internal/auth/* (gateway caller).
	ServiceKeyGateway string
}

type HTTPConfig struct {
	Port              int
	ReadHeaderTimeout time.Duration
	ReadTimeout       time.Duration
	WriteTimeout      time.Duration
	IdleTimeout       time.Duration
	HandlerTimeout    time.Duration
	MaxBodyBytes      int64
}

type PostgresConfig struct {
	Host           string
	Port           int
	Name           string
	User           string
	Password       string
	SSLMode        string
	MaxConns       int32
	MinConns       int32
	ConnectTimeout time.Duration
	Prepare        bool
}

type RedisConfig struct {
	Host         string
	Port         int
	Password     string
	DB           int
	DialTimeout  time.Duration
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
	PoolSize     int
}

type JWTConfig struct {
	Secret   []byte
	Issuer   string
	Audience string
}

type CryptoConfig struct {
	EncryptionKey []byte
}

type SecurityConfig struct {
	StepUpTTL                 time.Duration
	PasswordAttemptWindow     time.Duration
	PasswordMaxAttempts       int
	StrengthRateWindow        time.Duration
	StrengthRateMax           int
	MaxSessionsList           int
	PasswordMinLength         int
	PasswordMaxLength         int
	PbkdfIterations           int
	PbkdfIterationsLegacy     int
	PbkdfKeyLength            int
	EncryptionPbkdfIterations int
	EncryptionKeyLength       int
}

type LoggingConfig struct {
	Level slog.Level
}

func Load() (Config, error) {
	cfg := Config{
		HTTP: HTTPConfig{
			Port:              getInt("PORT", 3074),
			ReadHeaderTimeout: getDurationMs("HTTP_READ_HEADER_TIMEOUT_MS", 10000),
			ReadTimeout:       getDurationMs("HTTP_READ_TIMEOUT_MS", 15000),
			WriteTimeout:      getDurationMs("HTTP_WRITE_TIMEOUT_MS", 15000),
			IdleTimeout:       getDurationMs("HTTP_IDLE_TIMEOUT_MS", 60000),
			HandlerTimeout:    getDurationMs("HTTP_HANDLER_TIMEOUT_MS", 10000),
			MaxBodyBytes:      int64(getInt("HTTP_MAX_BODY_BYTES", 32*1024)),
		},
		Postgres: PostgresConfig{
			Host:           getString("DB_HOST", "postgres"),
			Port:           getInt("DB_PORT", 5432),
			Name:           getString("DB_NAME", ""),
			User:           getString("DB_USER", ""),
			Password:       getString("DB_PASSWORD", ""),
			SSLMode:        getString("DB_SSLMODE", "disable"),
			MaxConns:       int32(clampInt(getInt("DB_MAX_CONNECTIONS", 20), 1, 200)),
			MinConns:       int32(clampInt(getInt("DB_MIN_CONNECTIONS", 2), 0, 50)),
			ConnectTimeout: getDurationMs("DB_CONNECT_TIMEOUT_MS", 5000),
			Prepare:        getBool("DB_PREPARE", true),
		},
		Redis: RedisConfig{
			Host:         getString("REDIS_HOST", "redis-auth"),
			Port:         getInt("REDIS_PORT", 6379),
			Password:     os.Getenv("REDIS_PASSWORD"),
			DB:           getInt("REDIS_DB", 0),
			DialTimeout:  getDurationMs("REDIS_DIAL_TIMEOUT_MS", 3000),
			ReadTimeout:  getDurationMs("REDIS_READ_TIMEOUT_MS", 2000),
			WriteTimeout: getDurationMs("REDIS_WRITE_TIMEOUT_MS", 2000),
			PoolSize:     clampInt(getInt("REDIS_POOL_SIZE", 50), 5, 500),
		},
		JWT: JWTConfig{
			Issuer:   getString("JWT_ISSUER", "earflow-auth"),
			Audience: getString("JWT_AUDIENCE", "earflow-api"),
		},
		Security: SecurityConfig{
			StepUpTTL:                 getDurationSeconds("SECURITY_STEP_UP_TTL_SECONDS", 300),
			PasswordAttemptWindow:     getDurationSeconds("SECURITY_PASSWORD_WINDOW_SECONDS", 60),
			PasswordMaxAttempts:       clampInt(getInt("SECURITY_PASSWORD_MAX_ATTEMPTS", 5), 1, 100),
			StrengthRateWindow:        getDurationSeconds("SECURITY_STRENGTH_WINDOW_SECONDS", 60),
			StrengthRateMax:           clampInt(getInt("SECURITY_STRENGTH_MAX", 60), 1, 1000),
			MaxSessionsList:           clampInt(getInt("SECURITY_MAX_SESSIONS", 40), 1, 500),
			PasswordMinLength:         clampInt(getInt("SECURITY_PASSWORD_MIN_LENGTH", 8), 6, 64),
			PasswordMaxLength:         clampInt(getInt("SECURITY_PASSWORD_MAX_LENGTH", 256), 16, 1024),
			PbkdfIterations:           clampInt(getInt("SECURITY_PBKDF_ITERATIONS", 600000), 10000, 2000000),
			PbkdfIterationsLegacy:     clampInt(getInt("SECURITY_PBKDF_ITERATIONS_LEGACY", 100000), 10000, 2000000),
			PbkdfKeyLength:            clampInt(getInt("SECURITY_PBKDF_KEY_LENGTH", 64), 16, 128),
			EncryptionPbkdfIterations: clampInt(getInt("SECURITY_ENC_PBKDF_ITERATIONS", 600000), 10000, 2000000),
			EncryptionKeyLength:       clampInt(getInt("SECURITY_ENC_KEY_LENGTH", 32), 16, 64),
		},
		Logging: LoggingConfig{
			Level: parseLogLevel(getString("LOG_LEVEL", "info")),
		},
	}

	jwtSecret := strings.TrimSpace(os.Getenv("JWT_SECRET"))
	if jwtSecret == "" {
		return Config{}, errors.New("JWT_SECRET must be set")
	}
	cfg.JWT.Secret = []byte(jwtSecret)

	encKey := strings.TrimSpace(os.Getenv("ENCRYPTION_KEY"))
	if encKey == "" {
		return Config{}, errors.New("ENCRYPTION_KEY must be set (64 hex chars / 32 bytes)")
	}
	if len(encKey) < 32 {
		return Config{}, errors.New("ENCRYPTION_KEY must be at least 32 characters")
	}
	decoded, err := hex.DecodeString(encKey)
	if err != nil || len(decoded) != 32 {
		return Config{}, errors.New("ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)")
	}
	cfg.Crypto.EncryptionKey = decoded

	if cfg.Postgres.Name == "" || cfg.Postgres.User == "" {
		return Config{}, errors.New("DB_NAME and DB_USER must be set")
	}

	cfg.ServiceKeyGateway = strings.TrimSpace(os.Getenv("SERVICE_KEY_API_GATEWAY"))

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
	dsn := fmt.Sprintf(
		"postgres://%s:%s@%s:%d/%s?sslmode=%s&pool_max_conns=%d&pool_min_conns=%d",
		urlQueryEscape(c.User),
		urlQueryEscape(c.Password),
		host,
		c.Port,
		urlQueryEscape(c.Name),
		sslmode,
		c.MaxConns,
		c.MinConns,
	)
	if !c.Prepare {
		dsn += "&default_query_exec_mode=simple_protocol"
	}
	return dsn
}

func (c RedisConfig) Addr() string {
	return fmt.Sprintf("%s:%d", c.Host, c.Port)
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

func getDurationMs(name string, defMs int) time.Duration {
	ms := getInt(name, defMs)
	if ms <= 0 {
		ms = defMs
	}
	return time.Duration(ms) * time.Millisecond
}

func getDurationSeconds(name string, defSec int) time.Duration {
	s := getInt(name, defSec)
	if s <= 0 {
		s = defSec
	}
	return time.Duration(s) * time.Second
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
