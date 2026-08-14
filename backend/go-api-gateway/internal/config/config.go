package config

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type CookieConfig struct {
	Domain   string
	SameSite string
	Secure   bool
}

type CookieNamesConfig struct {
	Auth    string
	Refresh string
	SID     string
	CSRF    string
}

type RedisConfig struct {
	Addr     string
	Password string
	DB       int
}

type Upstreams struct {
	Auth            []string
	// AuthLegacy is the previous identity upstream (Node auth-service), kept
	// reachable for endpoints still served by Node after the auth-core flip
	// (currently the MFA routes /api/auth/2fa/*). Optional: empty disables the
	// auth_legacy upstream entirely.
	AuthLegacy      []string
	Upload          []string
	Database        []string
	Recommendations []string
	Playlist        []string
	Subscription    []string
	Lyrics          []string
	Party           []string
	PartyV2State    []string
	PartyV2Gateway  []string
	Ebap            []string
	EbapHlsAdapter  []string
	DirectStream    []string
	Artist          []string
	ArtistPortal    []string
	Search          []string
	MetadataParser  []string
	ImportService   []string
	// DeviceSync exposes /api/devices/* and /ws/devices (Spotify Connect-like
	// cross-device synchronization). Gated behind the DEVICE_SYNC_ENABLED env
	// on the microservice itself, so the gateway is safe to route to it
	// even when the feature is off — the service will answer 503.
	DeviceSync []string
	// Security handles account security operations (overview, password change,
	// telegram unlink, sessions list, revoke-others, 2FA recovery regeneration).
	// Split off from auth-service for Go's concurrency model on hot endpoints.
	Security []string
}

type AdminAuthConfig struct {
	Username       string
	PasswordBcrypt string
	Password       string
}

type Config struct {
	Port                  int
	NodeEnv               string
	IsProduction          bool
	ClientErrorLogEnabled bool
	AppVersion            string
	GitSHA                string
	JWTSecret             string
	JWTIssuer             string
	JWTAudience           string
	ServiceName           string
	ServiceKeyAPIGateway  string
	RateLimitMultiplier   int
	AllowedOrigins        []string
	TrustProxy            bool
	Cookie                CookieConfig
	CookieNames           CookieNamesConfig
	SessionTTL            time.Duration
	Redis                 RedisConfig
	RedisAuth             RedisConfig
	RedisRateLimit        RedisConfig
	Upstreams             Upstreams
	AdminAuth             AdminAuthConfig
	TelegramBotUsername   string
	InstanceID            string
	GatewayConfigPath     string
}

var originRe = regexp.MustCompile(`^https?://[^/]+$`)

var cookieNameRe = regexp.MustCompile(`^[A-Za-z0-9_]{3,64}$`)

func LoadFromEnv() (Config, error) {
	port := 3000
	if v := strings.TrimSpace(os.Getenv("PORT")); v != "" {
		p, err := strconv.Atoi(v)
		if err != nil || p <= 0 || p > 65535 {
			return Config{}, errors.New("invalid PORT")
		}
		port = p
	}

	appVersion := strings.TrimSpace(os.Getenv("APP_VERSION"))
	if appVersion == "" {
		appVersion = "local"
	}
	gitSHA := strings.TrimSpace(os.Getenv("GIT_SHA"))
	if gitSHA == "" {
		gitSHA = "local"
	}

	nodeEnv := strings.TrimSpace(os.Getenv("NODE_ENV"))
	if nodeEnv == "" {
		nodeEnv = "development"
	}
	lowerEnv := strings.ToLower(nodeEnv)
	isProd := lowerEnv == "production" || lowerEnv == "prod"

	clientErrorLogEnabled := false
	if raw := strings.ToLower(strings.TrimSpace(os.Getenv("CLIENT_ERROR_LOG_ENABLED"))); raw != "" {
		clientErrorLogEnabled = raw == "1" || raw == "true" || raw == "yes" || raw == "on"
	}

	jwtSecret := os.Getenv("JWT_SECRET")
	if len(jwtSecret) < 32 {
		return Config{}, errors.New("JWT_SECRET must be set and at least 32 characters")
	}

	jwtIssuer := strings.TrimSpace(os.Getenv("JWT_ISSUER"))
	jwtAudience := strings.TrimSpace(os.Getenv("JWT_AUDIENCE"))
	if isProd {
		if jwtIssuer == "" || jwtAudience == "" {
			return Config{}, errors.New("JWT_ISSUER and JWT_AUDIENCE must be set in production")
		}
	} else {
		if (jwtIssuer == "") != (jwtAudience == "") {
			return Config{}, errors.New("set both JWT_ISSUER and JWT_AUDIENCE or neither")
		}
	}

	svcKey := os.Getenv("SERVICE_KEY_API_GATEWAY")
	if len(svcKey) < 32 {
		return Config{}, errors.New("SERVICE_KEY_API_GATEWAY must be set and at least 32 characters")
	}

	serviceName := strings.TrimSpace(os.Getenv("GATEWAY_SERVICE_NAME"))
	if serviceName == "" {
		serviceName = "api-gateway"
	}

	rateLimitMultiplier, err := parseRateLimitMultiplier()
	if err != nil {
		return Config{}, err
	}

	allowedOrigins, err := parseAllowedOrigins(os.Getenv("ALLOWED_ORIGINS"), os.Getenv("COOKIE_DOMAIN"), isProd)
	if err != nil {
		return Config{}, err
	}

	trustProxy := strings.TrimSpace(os.Getenv("TRUST_PROXY"))
	useTrustProxy := trustProxy == "1" || strings.EqualFold(trustProxy, "true")

	sameSite := strings.ToLower(strings.TrimSpace(os.Getenv("COOKIE_SAMESITE")))
	if sameSite == "" {
		if isProd {
			sameSite = "none"
		} else {
			sameSite = "lax"
		}
	}
	if sameSite != "lax" && sameSite != "strict" && sameSite != "none" {
		return Config{}, errors.New("COOKIE_SAMESITE must be one of: lax, strict, none")
	}

	secure := isProd
	if raw := strings.ToLower(strings.TrimSpace(os.Getenv("COOKIE_SECURE"))); raw != "" {
		secure = raw == "1" || raw == "true"
	}
	if sameSite == "none" && !secure {
		return Config{}, errors.New("COOKIE_SECURE must be true when COOKIE_SAMESITE is none")
	}

	cookieDomainRaw := strings.TrimSpace(os.Getenv("COOKIE_DOMAIN"))
	var cookieDomain string
	switch strings.ToLower(cookieDomainRaw) {
	case "host", "host-only":
		cookieDomain = ""
	case "":
		if isProd {
			cookieDomain = ".earflow.ru"
		}
	default:
		cookieDomain = cookieDomainRaw
		if !strings.HasPrefix(cookieDomain, ".") {
			cookieDomain = "." + cookieDomain
		}
	}

	defaultCookieNames := CookieNamesConfig{Auth: "mp_auth", Refresh: "mp_refresh", SID: "mp_sid", CSRF: "mp_csrf"}
	readCookieName := func(envKey string, def string) (string, error) {
		v := strings.TrimSpace(os.Getenv(envKey))
		if v == "" {
			return def, nil
		}
		if !cookieNameRe.MatchString(v) {
			return "", errors.New("invalid " + envKey)
		}
		return v, nil
	}

	cookieAuthName, err := readCookieName("COOKIE_AUTH_NAME", defaultCookieNames.Auth)
	if err != nil {
		return Config{}, err
	}
	cookieRefreshName, err := readCookieName("COOKIE_REFRESH_NAME", defaultCookieNames.Refresh)
	if err != nil {
		return Config{}, err
	}
	cookieSIDName, err := readCookieName("COOKIE_SID_NAME", defaultCookieNames.SID)
	if err != nil {
		return Config{}, err
	}
	cookieCSRFName, err := readCookieName("COOKIE_CSRF_NAME", defaultCookieNames.CSRF)
	if err != nil {
		return Config{}, err
	}

	rawTTL := strings.TrimSpace(os.Getenv("SESSION_TTL_SECONDS"))
	if rawTTL == "" {
		return Config{}, errors.New("SESSION_TTL_SECONDS must be set")
	}
	v, err := strconv.Atoi(rawTTL)
	if err != nil {
		return Config{}, errors.New("invalid SESSION_TTL_SECONDS")
	}
	const minSessionTTLSeconds = 5 * 60
	const maxSessionTTLSeconds = 365 * 24 * 60 * 60
	if v < minSessionTTLSeconds || v > maxSessionTTLSeconds {
		return Config{}, errors.New("invalid SESSION_TTL_SECONDS")
	}
	sessionTTL := time.Duration(v) * time.Second

	baseRedis, err := parseRedisConfigFromEnv("REDIS_", RedisConfig{})
	if err != nil {
		return Config{}, err
	}
	if strings.TrimSpace(baseRedis.Addr) == "" {
		baseRedis = RedisConfig{Addr: net.JoinHostPort("redis", "6379"), Password: strings.TrimSpace(os.Getenv("REDIS_PASSWORD")), DB: 0}
	}

	redisAuth, err := parseRedisConfigFromEnv("REDIS_AUTH_", baseRedis)
	if err != nil {
		return Config{}, err
	}
	redisRL, err := parseRedisConfigFromEnv("REDIS_RL_", baseRedis)
	if err != nil {
		return Config{}, err
	}

	gateCfgEnv := strings.TrimSpace(os.Getenv("GATEWAY_CONFIG_PATH"))
	gatewayConfigPath := gateCfgEnv
	if gatewayConfigPath == "" {
		lowerSvc := strings.ToLower(serviceName)
		switch lowerSvc {
		case "artist-api-gateway", "artist_api_gateway":
			gatewayConfigPath = "/app/gateway.artist.yaml"
		default:
			gatewayConfigPath = "/app/gateway.yaml"
		}
	}

	lowerSvc := strings.ToLower(strings.TrimSpace(serviceName))
	isArtistGateway := lowerSvc == "artist-api-gateway" || lowerSvc == "artist_api_gateway"
	if isArtistGateway {
		if !strings.HasSuffix(strings.ToLower(gatewayConfigPath), "gateway.artist.yaml") {
			gatewayConfigPath = "/app/gateway.artist.yaml"
		}
	} else {
		if strings.HasSuffix(strings.ToLower(gatewayConfigPath), "gateway.artist.yaml") {
			gatewayConfigPath = "/app/gateway.yaml"
		}
	}

	telegramBotUsername := strings.TrimSpace(os.Getenv("EARFLOW_TELEGRAM_BOT_USERNAME"))
	if telegramBotUsername == "" {
		telegramBotUsername = strings.TrimSpace(os.Getenv("REACT_APP_TELEGRAM_BOT_USERNAME"))
	}

	instanceID := newInstanceID()

	authLegacyDefault := os.Getenv("AUTH_SERVICE_URL")
	if authLegacyDefault == "" {
		authLegacyDefault = "http://auth-service:3001"
	}

	upstreams := Upstreams{
		Auth:            splitCSVOrDefault(os.Getenv("AUTH_SERVICE_URL"), "http://auth-service:3001"),
		AuthLegacy:      splitCSVOrDefault(os.Getenv("AUTH_LEGACY_SERVICE_URL"), authLegacyDefault),
		Upload:          splitCSVOrDefault(os.Getenv("UPLOAD_SERVICE_URL"), "http://upload-service:3002"),
		Database:        splitCSVOrDefault(os.Getenv("DATABASE_SERVICE_URL"), "http://database-service:3003"),
		Recommendations: splitCSVOrDefault(os.Getenv("RECOMMENDATIONS_SERVICE_URL"), "http://recommendations-service:3006"),
		Playlist:        splitCSVOrDefault(os.Getenv("PLAYLIST_SERVICE_URL"), "http://playlist-service:3020"),
		Subscription:    splitCSVOrDefault(os.Getenv("SUBSCRIPTION_SERVICE_URL"), "http://subscription-service:3010"),
		Lyrics:          splitCSVOrDefault(os.Getenv("LYRICS_SERVICE_URL"), "http://lyrics-service:3010"),
		Party:           splitCSVOrDefault(os.Getenv("PARTY_SERVICE_URL"), "http://party-state-service:3130"),
		PartyV2State:    splitCSVOrDefault(os.Getenv("PARTY_V2_STATE_URL"), "http://party-state-service:3130"),
		PartyV2Gateway:  splitCSVOrDefault(os.Getenv("PARTY_V2_GATEWAY_URL"), "http://party-gateway-service:3131"),
		Ebap:            splitCSV(os.Getenv("EBAP_SERVICE_URL")),
		EbapHlsAdapter:  splitCSVOrDefault(os.Getenv("EBAP_HLS_ADAPTER_URL"), "http://ebap-hls-adapter:3095"),
		DirectStream:    splitCSVOrDefault(os.Getenv("DIRECT_STREAM_SERVICE_URL"), "http://direct-stream-service:3096"),
		Artist:          splitCSVOrDefault(os.Getenv("ARTIST_SERVICE_URL"), "http://artist-service:3040"),
		ArtistPortal:    splitCSVOrDefault(os.Getenv("ARTIST_PORTAL_SERVICE_URL"), "http://artist-portal-service:3085"),
		Search:          splitCSVOrDefault(os.Getenv("SEARCH_SERVICE_URL"), "http://search-service:3062"),
		MetadataParser:  splitCSVOrDefault(os.Getenv("METADATA_PARSER_SERVICE_URL"), "http://metadata-parser-service:3072"),
		ImportService:   splitCSVOrDefault(os.Getenv("IMPORT_SERVICE_URL"), "http://import-service:3073"),
		DeviceSync:      splitCSVOrDefault(os.Getenv("DEVICE_SYNC_SERVICE_URL"), "http://device-sync-service:3050"),
		Security:        splitCSVOrDefault(os.Getenv("SECURITY_SERVICE_URL"), "http://security-service:3074"),
	}

	adminUser := strings.TrimSpace(os.Getenv("GATEWAY_ADMIN_USER"))
	adminHash := strings.TrimSpace(os.Getenv("GATEWAY_ADMIN_PASSWORD_BCRYPT"))
	adminPass := strings.TrimSpace(os.Getenv("GATEWAY_ADMIN_PASSWORD"))
	if adminUser != "" {
		hasBcrypt := adminHash != ""
		hasPlain := adminPass != ""
		if hasBcrypt == hasPlain {
			return Config{}, errors.New("set exactly one of GATEWAY_ADMIN_PASSWORD_BCRYPT or GATEWAY_ADMIN_PASSWORD when GATEWAY_ADMIN_USER is set")
		}
	} else {
		if adminHash != "" || adminPass != "" {
			return Config{}, errors.New("GATEWAY_ADMIN_USER must be set when using admin password")
		}
	}

	return Config{
		Port:                  port,
		NodeEnv:               nodeEnv,
		IsProduction:          isProd,
		ClientErrorLogEnabled: clientErrorLogEnabled,
		AppVersion:            appVersion,
		GitSHA:                gitSHA,
		JWTSecret:             jwtSecret,
		JWTIssuer:             jwtIssuer,
		JWTAudience:           jwtAudience,
		ServiceName:           serviceName,
		ServiceKeyAPIGateway:  svcKey,
		RateLimitMultiplier:   rateLimitMultiplier,
		AllowedOrigins:        allowedOrigins,
		TrustProxy:            useTrustProxy,
		Cookie: CookieConfig{
			Domain:   cookieDomain,
			SameSite: sameSite,
			Secure:   secure,
		},
		CookieNames: CookieNamesConfig{
			Auth:    cookieAuthName,
			Refresh: cookieRefreshName,
			SID:     cookieSIDName,
			CSRF:    cookieCSRFName,
		},
		SessionTTL:          sessionTTL,
		Redis:               baseRedis,
		RedisAuth:           redisAuth,
		RedisRateLimit:      redisRL,
		Upstreams:           upstreams,
		AdminAuth:           AdminAuthConfig{Username: adminUser, PasswordBcrypt: adminHash, Password: adminPass},
		TelegramBotUsername: telegramBotUsername,
		InstanceID:          instanceID,
		GatewayConfigPath:   gatewayConfigPath,
	}, nil
}

func parseRateLimitMultiplier() (int, error) {
	raw := strings.TrimSpace(os.Getenv("GATEWAY_RATE_LIMIT_MULTIPLIER"))
	if raw == "" {
		raw = strings.TrimSpace(os.Getenv("LOAD_TEST_RATE_LIMIT_MULTIPLIER"))
	}
	if raw == "" {
		if isTruthy(os.Getenv("LOAD_TEST_MODE")) {
			return 30, nil
		}
		return 1, nil
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v < 1 || v > 100 {
		return 0, errors.New("GATEWAY_RATE_LIMIT_MULTIPLIER must be an integer between 1 and 100")
	}
	return v, nil
}

func isTruthy(raw string) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func parseRedisConfigFromEnv(prefix string, fallback RedisConfig) (RedisConfig, error) {
	host := strings.TrimSpace(os.Getenv(prefix + "HOST"))
	portRaw := strings.TrimSpace(os.Getenv(prefix + "PORT"))
	pass := strings.TrimSpace(os.Getenv(prefix + "PASSWORD"))
	dbRaw := strings.TrimSpace(os.Getenv(prefix + "DB"))

	if host == "" && portRaw == "" && pass == "" && dbRaw == "" {
		return fallback, nil
	}
	if host == "" {
		return RedisConfig{}, errors.New("invalid " + prefix + "HOST")
	}

	port := 6379
	if portRaw != "" {
		p, err := strconv.Atoi(portRaw)
		if err != nil || p <= 0 || p > 65535 {
			return RedisConfig{}, errors.New("invalid " + prefix + "PORT")
		}
		port = p
	}

	db := fallback.DB
	if dbRaw != "" {
		d, err := strconv.Atoi(dbRaw)
		if err != nil || d < 0 {
			return RedisConfig{}, errors.New("invalid " + prefix + "DB")
		}
		db = d
	}

	if pass == "" {
		pass = fallback.Password
	}

	return RedisConfig{
		Addr:     net.JoinHostPort(host, strconv.Itoa(port)),
		Password: pass,
		DB:       db,
	}, nil
}

func splitCSVOrDefault(v string, def string) []string {
	if strings.TrimSpace(v) == "" {
		return []string{def}
	}
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		s := strings.TrimSpace(p)
		if s == "" {
			continue
		}
		out = append(out, s)
	}
	if len(out) == 0 {
		return []string{def}
	}
	return out
}

func splitCSV(v string) []string {
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		s := strings.TrimSpace(p)
		if s == "" {
			continue
		}
		out = append(out, s)
	}
	return out
}

func parseAllowedOrigins(raw string, cookieDomain string, isProd bool) ([]string, error) {
	var base []string
	if strings.TrimSpace(raw) != "" {
		parts := strings.Split(raw, ",")
		for _, p := range parts {
			o := normalizeOrigin(strings.TrimSpace(p), isProd)
			if o == "" {
				continue
			}
			base = append(base, o)
			alt, _ := toggleWWW(o)
			if alt != "" {
				base = append(base, alt)
			}
		}
	} else {
		host := strings.TrimSpace(cookieDomain)
		host = strings.TrimPrefix(host, ".")
		if host == "" {
			host = "earflow.ru"
		}
		base = append(base, "https://"+host, "https://www."+host, "https://auth."+host, "https://artists."+host)
	}

	host := strings.TrimSpace(cookieDomain)
	host = strings.TrimPrefix(host, ".")
	if host != "" {
		scheme := "https"
		if !isProd {
			scheme = "http"
		}

		rootOrigin := scheme + "://" + host
		base = append(base, rootOrigin)
		altRoot, _ := toggleWWW(rootOrigin)
		if altRoot != "" {
			base = append(base, altRoot)
		}

		authOrigin := "https://auth." + host
		if !isProd {
			authOrigin = "http://auth." + host
		}
		base = append(base, authOrigin)
		alt, _ := toggleWWW(authOrigin)
		if alt != "" {
			base = append(base, alt)
		}

		artistsOrigin := scheme + "://artists." + host
		base = append(base, artistsOrigin)
		altArtists, _ := toggleWWW(artistsOrigin)
		if altArtists != "" {
			base = append(base, altArtists)
		}
	}

	uniq := make([]string, 0, len(base))
	seen := map[string]struct{}{}
	for _, o := range base {
		if o == "" {
			continue
		}
		if _, ok := seen[o]; ok {
			continue
		}
		seen[o] = struct{}{}
		uniq = append(uniq, o)
	}
	if len(uniq) == 0 {
		return nil, errors.New("no allowed origins")
	}
	return uniq, nil
}

func normalizeOrigin(raw string, isProd bool) string {
	cleaned := strings.TrimSpace(strings.TrimRight(raw, "/"))
	if cleaned == "" {
		return ""
	}
	if strings.Contains(cleaned, "://") {
		if !originRe.MatchString(cleaned) {
			return ""
		}
		u, err := url.Parse(cleaned)
		if err != nil || u.Scheme == "" || u.Host == "" {
			return ""
		}
		return u.Scheme + "://" + u.Host
	}
	if isProd {
		return "https://" + cleaned
	}
	return "http://" + cleaned
}

func toggleWWW(origin string) (string, bool) {
	u, err := url.Parse(origin)
	if err != nil {
		return "", false
	}
	host := u.Hostname()
	port := u.Port()
	if host == "" {
		return "", false
	}
	if strings.HasPrefix(host, "www.") {
		host = strings.TrimPrefix(host, "www.")
	} else {
		host = "www." + host
	}
	newHost := host
	if port != "" {
		newHost = host + ":" + port
	}
	return u.Scheme + "://" + newHost, true
}

func newInstanceID() string {
	buf := make([]byte, 8)
	_, _ = rand.Read(buf)
	return hex.EncodeToString(buf)
}
