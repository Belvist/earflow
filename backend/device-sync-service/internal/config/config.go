// Package config loads and validates device-sync-service configuration from
// environment variables. Configuration is loaded exactly once at startup and
// then treated as immutable for the life of the process. This keeps hot paths
// allocation-free and avoids the need for atomic reads of flags on every
// request.
package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config is the fully resolved configuration. All validation errors surface at
// Load time so that a mis-configured container fails fast (crash-loops) rather
// than serving traffic silently in a broken state.
type Config struct {
	Env      string
	Port     int
	IsProd   bool
	Enabled  bool
	Instance string

	JWTSecret            []byte
	JWTIssuer            string
	JWTAudience          string
	WSTicketSecret       []byte
	WSTicketTTL          time.Duration
	GatewayHeaderUserID  string
	GatewayHeaderUser    string
	GatewayHeaderSession string

	Redis struct {
		Addr         string
		Password     string
		DB           int
		PoolSize     int
		MinIdleConns int
		DialTimeout  time.Duration
		ReadTimeout  time.Duration
		WriteTimeout time.Duration
		KeyPrefix    string
	}

	Device struct {
		MaxPerUser             int
		DeviceTTL              time.Duration
		HeartbeatGrace         time.Duration
		NowPlayingTTL          time.Duration
		MaxCommandPayloadBytes int
		AllowedKinds           map[string]struct{}
		// ListHideStaleAfter: из списка (API / init WS) убрать «мертвые» —
		// lastSeen дольше этого окна, кроме устройства с активным плеером.
		// 0 = не фильтровать. Как у Spotify: не тянуть в панель всё, что в Redis.
		ListHideStaleAfter time.Duration
	}

	Transfer struct {
		AckTimeout     time.Duration
		MaxRetries     int
		IdempotencyTTL time.Duration
		RecordTTL      time.Duration
	}

	WS struct {
		ReadLimitBytes     int64
		ReadTimeout        time.Duration
		WriteTimeout       time.Duration
		PingInterval       time.Duration
		RateLimitPerSecond int
		WriteBuffer        int
	}

	HTTP struct {
		RateLimitWindow time.Duration
		RateLimitMax    int
		// AllowedOrigins stores full origin URLs (e.g. "https://earflow.ru")
		// for the CORS middleware. AllowedOriginHosts is hostnames-only
		// (e.g. "earflow.ru") for WebSocket OriginPatterns which compares
		// against url.Parse(Origin).Host.
		AllowedOrigins     []string
		AllowedOriginHosts []string
		ReadHeader         time.Duration
		Write              time.Duration
		Idle               time.Duration
		ShutdownTimeout    time.Duration
	}
}

// Load reads the process environment, validates it, and returns an immutable
// Config. Any error returned here must be surfaced to the operator via fatal
// log + non-zero exit in main().
func Load() (*Config, error) {
	c := &Config{}
	c.Env = envOr("NODE_ENV", "development")
	c.IsProd = c.Env == "production"
	c.Instance = envOr("INSTANCE_ID", hostnameOr("local"))

	port, err := parseInt("PORT", 3050)
	if err != nil {
		return nil, err
	}
	c.Port = port

	c.Enabled = parseBool("DEVICE_SYNC_ENABLED", false)

	jwt := strings.TrimSpace(os.Getenv("JWT_SECRET"))
	if len(jwt) < 32 {
		return nil, errors.New("JWT_SECRET must be set and >=32 chars")
	}
	c.JWTSecret = []byte(jwt)
	c.JWTIssuer = strings.TrimSpace(os.Getenv("JWT_ISSUER"))
	c.JWTAudience = strings.TrimSpace(os.Getenv("JWT_AUDIENCE"))

	ticket := strings.TrimSpace(os.Getenv("DEVICE_SYNC_WS_TICKET_SECRET"))
	if ticket == "" {
		if c.IsProd {
			return nil, errors.New("DEVICE_SYNC_WS_TICKET_SECRET is required in production")
		}
		ticket = jwt
	}
	if len(ticket) < 32 {
		return nil, errors.New("DEVICE_SYNC_WS_TICKET_SECRET (or JWT_SECRET fallback) must be >=32 chars")
	}
	c.WSTicketSecret = []byte(ticket)
	c.WSTicketTTL = parseDuration("WS_TICKET_TTL", 60*time.Second)
	if c.WSTicketTTL < 10*time.Second || c.WSTicketTTL > 10*time.Minute {
		return nil, fmt.Errorf("WS_TICKET_TTL out of bounds: %s", c.WSTicketTTL)
	}

	c.GatewayHeaderUserID = envOr("GATEWAY_HEADER_USER_ID", "X-User-Id")
	c.GatewayHeaderUser = envOr("GATEWAY_HEADER_USER_NAME", "X-User-Name")
	c.GatewayHeaderSession = envOr("GATEWAY_HEADER_SESSION_ID", "X-Session-Id")

	// Redis
	c.Redis.Addr = fmt.Sprintf("%s:%d",
		envOr("REDIS_HOST", "redis"),
		parseIntNoErr("REDIS_PORT", 6379))
	c.Redis.Password = strings.TrimSpace(os.Getenv("REDIS_PASSWORD"))
	c.Redis.DB = parseIntNoErr("REDIS_DB", 3)
	c.Redis.PoolSize = parseIntNoErr("REDIS_POOL_SIZE", 50)
	c.Redis.MinIdleConns = parseIntNoErr("REDIS_MIN_IDLE", 10)
	c.Redis.DialTimeout = parseDuration("REDIS_DIAL_TIMEOUT", 5*time.Second)
	c.Redis.ReadTimeout = parseDuration("REDIS_READ_TIMEOUT", 3*time.Second)
	c.Redis.WriteTimeout = parseDuration("REDIS_WRITE_TIMEOUT", 3*time.Second)
	c.Redis.KeyPrefix = envOr("REDIS_KEY_PREFIX", "dsync:")

	if c.IsProd && c.Redis.Password == "" {
		return nil, errors.New("REDIS_PASSWORD is required in production")
	}

	// Device
	c.Device.MaxPerUser = parseIntNoErr("MAX_DEVICES_PER_USER", 30)
	c.Device.DeviceTTL = parseDurationSeconds("DEVICE_TTL_SECONDS", 900)
	c.Device.HeartbeatGrace = parseDurationSeconds("HEARTBEAT_GRACE_SECONDS", 60)
	c.Device.NowPlayingTTL = parseDurationSeconds("NOW_PLAYING_TTL_SECONDS", 3600)
	c.Device.MaxCommandPayloadBytes = parseIntNoErr("MAX_COMMAND_PAYLOAD_BYTES", 2048)
	// 180s ≈ 3m: нет heartbeats/активности — устройство не показывать, пока снова не оживёт.
	// LIST_HIDE_STALE_AFTER_SECONDS=0 — отключить (все записи в user set, до TTL).
	switch strings.TrimSpace(os.Getenv("LIST_HIDE_STALE_AFTER_SECONDS")) {
	case "0":
		c.Device.ListHideStaleAfter = 0
	case "":
		c.Device.ListHideStaleAfter = 3 * time.Minute
	default:
		if n, err := strconv.Atoi(strings.TrimSpace(os.Getenv("LIST_HIDE_STALE_AFTER_SECONDS"))); err == nil && n > 0 {
			c.Device.ListHideStaleAfter = time.Duration(n) * time.Second
		} else {
			c.Device.ListHideStaleAfter = 3 * time.Minute
		}
	}
	c.Device.AllowedKinds = map[string]struct{}{
		"web": {}, "mobile-web": {}, "desktop": {},
		"android": {}, "ios": {}, "tv": {}, "speaker": {}, "other": {},
	}

	c.Transfer.AckTimeout = parseDuration("TRANSFER_ACK_TIMEOUT", 5*time.Second)
	if c.Transfer.AckTimeout < time.Second || c.Transfer.AckTimeout > time.Minute {
		c.Transfer.AckTimeout = 5 * time.Second
	}
	c.Transfer.MaxRetries = parseIntNoErr("TRANSFER_MAX_RETRIES", 2)
	if c.Transfer.MaxRetries < 0 || c.Transfer.MaxRetries > 10 {
		c.Transfer.MaxRetries = 2
	}
	c.Transfer.IdempotencyTTL = parseDuration("TRANSFER_IDEMPOTENCY_TTL", 24*time.Hour)
	c.Transfer.RecordTTL = parseDuration("TRANSFER_RECORD_TTL", 30*time.Minute)

	// WebSocket
	c.WS.ReadLimitBytes = int64(parseIntNoErr("WS_READ_LIMIT_BYTES", 4096))
	c.WS.ReadTimeout = parseDuration("WS_READ_TIMEOUT", 60*time.Second)
	c.WS.WriteTimeout = parseDuration("WS_WRITE_TIMEOUT", 10*time.Second)
	c.WS.PingInterval = parseDuration("WS_PING_INTERVAL", 25*time.Second)
	c.WS.RateLimitPerSecond = parseIntNoErr("WS_RATE_LIMIT_MESSAGES_PER_SECOND", 8)
	c.WS.WriteBuffer = parseIntNoErr("WS_WRITE_BUFFER", 64)

	// HTTP. RATE_LIMIT_WINDOW accepts either a Go duration ("60s") or a raw
	// integer in milliseconds (kept for backward-compat with other services
	// in docker-compose that historically used `RATE_LIMIT_WINDOW_MS`).
	c.HTTP.RateLimitWindow = parseDurationFlexible(
		[]string{"RATE_LIMIT_WINDOW", "RATE_LIMIT_WINDOW_MS"},
		60*time.Second,
	)
	c.HTTP.RateLimitMax = parseIntNoErr("RATE_LIMIT_MAX_REQUESTS", 120)
	c.HTTP.ReadHeader = parseDuration("HTTP_READ_HEADER_TIMEOUT", 10*time.Second)
	c.HTTP.Write = parseDuration("HTTP_WRITE_TIMEOUT", 15*time.Second)
	c.HTTP.Idle = parseDuration("HTTP_IDLE_TIMEOUT", 120*time.Second)
	c.HTTP.ShutdownTimeout = parseDuration("SHUTDOWN_TIMEOUT", 30*time.Second)

	// ALLOWED_ORIGINS: mixed CSV of "https://earflow.ru" or plain "earflow.ru".
	// We keep the full URL for CORS middleware (which wants scheme+host) but
	// ALSO expose a hostname-only slice for coder/websocket's OriginPatterns,
	// because that library compares against url.Parse(Origin).Host.
	raw := strings.TrimSpace(os.Getenv("ALLOWED_ORIGINS"))
	if raw != "" {
		parts := strings.Split(raw, ",")
		for _, p := range parts {
			v := strings.TrimSpace(p)
			if v != "" {
				c.HTTP.AllowedOrigins = append(c.HTTP.AllowedOrigins, v)
			}
		}
	}
	c.HTTP.AllowedOriginHosts = originHostsFromList(c.HTTP.AllowedOrigins)
	if c.IsProd && len(c.HTTP.AllowedOriginHosts) == 0 {
		return nil, errors.New("ALLOWED_ORIGINS is required in production")
	}

	return c, nil
}

// originHostsFromList extracts bare hostnames from entries like
// "https://earflow.ru", "earflow.ru:8443", or "*.earflow.ru". Duplicates are
// preserved in order (rarely matters, but keeps pattern ordering stable).
func originHostsFromList(items []string) []string {
	out := make([]string, 0, len(items))
	seen := make(map[string]struct{}, len(items))
	for _, v := range items {
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		// If it looks like a URL, parse it; otherwise treat as host.
		host := v
		if strings.Contains(v, "://") {
			if u, err := url.Parse(v); err == nil && u.Host != "" {
				host = u.Host
			}
		}
		// Drop port: coder/websocket's path.Match compares against
		// url.Parse(Origin).Host which INCLUDES the port, so for patterns we
		// want both with and without to stay permissive behind reverse
		// proxies that may strip/add one.
		if strings.Contains(host, ":") {
			if colon := strings.LastIndex(host, ":"); colon > 0 {
				hostNoPort := host[:colon]
				if _, ok := seen[hostNoPort]; !ok {
					seen[hostNoPort] = struct{}{}
					out = append(out, hostNoPort)
				}
			}
		}
		if _, ok := seen[host]; !ok {
			seen[host] = struct{}{}
			out = append(out, host)
		}
	}
	return out
}

func envOr(key, def string) string {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	return v
}

func hostnameOr(def string) string {
	h, err := os.Hostname()
	if err != nil || h == "" {
		return def
	}
	return h
}

func parseInt(key string, def int) (int, error) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return def, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("%s: invalid integer %q", key, raw)
	}
	return n, nil
}

func parseIntNoErr(key string, def int) int {
	n, err := parseInt(key, def)
	if err != nil {
		return def
	}
	return n
}

func parseBool(key string, def bool) bool {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	switch raw {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return def
	}
}

func parseDuration(key string, def time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return def
	}
	d, err := time.ParseDuration(raw)
	if err != nil {
		return def
	}
	return d
}

func parseDurationSeconds(key string, defSeconds int) time.Duration {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return time.Duration(defSeconds) * time.Second
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return time.Duration(defSeconds) * time.Second
	}
	return time.Duration(n) * time.Second
}

// parseDurationFlexible tries multiple env var aliases. The alias ending in
// `_MS` is interpreted as milliseconds when the value is a plain integer
// (legacy compat); any alias also accepts a Go duration string.
func parseDurationFlexible(keys []string, def time.Duration) time.Duration {
	for _, k := range keys {
		raw := strings.TrimSpace(os.Getenv(k))
		if raw == "" {
			continue
		}
		if d, err := time.ParseDuration(raw); err == nil {
			return d
		}
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			if strings.HasSuffix(k, "_MS") {
				return time.Duration(n) * time.Millisecond
			}
			// Fall back to seconds for plain integers.
			return time.Duration(n) * time.Second
		}
	}
	return def
}
