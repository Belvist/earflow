package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/earflow/music-platform/auth-core/internal/authn"
	"github.com/earflow/music-platform/auth-core/internal/config"
	"github.com/earflow/music-platform/auth-core/internal/store"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

type Deps struct {
	Config   config.Config
	Redis    *store.RedisClient
	Postgres *store.Postgres
	Logger   *slog.Logger
	Svc      *authn.Service
}

func NewServer(d Deps) *http.Server {
	r := chi.NewRouter()
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(d.Config.HTTP.HandlerTimeout))
	r.Use(securityHeadersMiddleware)
	r.Use(clientMetadataMiddleware)

	r.Get("/health", healthHandler(d))
	r.Get("/metrics", metricsHandler())

	r.Post("/api/auth/email/register", throttleAuthIP(d)(emailRegisterHandler(d)))
	r.Post("/api/auth/email/login", emailLoginHandler(d))
	r.Post("/api/auth/telegram/login", throttleAuthIP(d)(telegramLoginHandler(d)))
	r.Post("/api/auth/refresh", refreshHandler(d))
	r.Post("/api/verify", verifyHandler(d))
	r.Get("/api/profile", profileHandler(d))
	r.Get("/api/auth/profile", profileHandler(d))

	return &http.Server{
		Addr:              d.Config.HTTP.Addr(),
		Handler:           r,
		ReadHeaderTimeout: d.Config.HTTP.ReadHeaderTimeout,
		ReadTimeout:       d.Config.HTTP.ReadTimeout,
		WriteTimeout:      d.Config.HTTP.WriteTimeout,
		IdleTimeout:       d.Config.HTTP.IdleTimeout,
	}
}

// clientMetadataMiddleware captures the client IP/UA from the gateway-forwarded
// headers into the request context (mirrors Node extractSessionMetadata).
func clientMetadataMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)
		ua := strings.TrimSpace(r.UserAgent())
		if len(ua) > 512 {
			ua = ua[:512]
		}
		next.ServeHTTP(w, r.WithContext(authn.WithClientMetadata(r.Context(), ip, ua)))
	})
}

// clientIP resolves the real client IP for throttling/session meta without
// trusting spoofable client-controlled headers.
//
// Edge: nginx overwrites X-Real-IP with the TCP peer ($remote_addr), so it is
// authoritative for browser traffic (any client-supplied X-Real-IP is replaced).
// X-Forwarded-For is intentionally NOT trusted here: its leftmost entry is
// client-controlled and would allow bypassing the per-IP login throttle.
// Fallback: socket peer (post-RealIP) for direct/internal callers (healthchecks).
func clientIP(r *http.Request) string {
	if xr := strings.TrimSpace(r.Header.Get("X-Real-IP")); xr != "" {
		if len(xr) > 60 {
			return ""
		}
		return xr
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		if host != "" {
			return host
		}
	}
	return strings.TrimSpace(r.RemoteAddr)
}

// throttleAuthIP mirrors Node authLimiter (10 attempts/15min per client IP,
// successful requests not counted) on identity routes Node covers that lack a
// per-email lockout: register + telegram login. Login keeps its own dual
// lockout (email + IP). Errors are swallowed — throttling must not fail the path.
func throttleAuthIP(d Deps) func(http.HandlerFunc) http.HandlerFunc {
	return func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			cfg := d.Config.Auth
			ip := clientIP(r)
			if ip == "" {
				next(w, r)
				return
			}
			if blocked, retry := d.Redis.CheckIPFailures(r.Context(), ip, cfg.AuthEndpointIPMax); blocked {
				writeAPIError(w, &authn.APIError{
					Status:     http.StatusTooManyRequests,
					Message:    "Слишком много попыток. Попробуйте позже.",
					Code:       "LOGIN_RATE_LIMITED",
					RetryAfter: retry,
				})
				return
			}
			rec := &statusRecorder{ResponseWriter: w, code: http.StatusOK}
			next(rec, r)
			if rec.code >= http.StatusBadRequest {
				d.Redis.RecordIPFailure(r.Context(), ip, cfg.AuthEndpointIPMax, cfg.AuthEndpointIPWindow, cfg.AuthEndpointIPWindow)
			}
		}
	}
}

// statusRecorder captures the status code written by a handler.
type statusRecorder struct {
	http.ResponseWriter
	code int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.code = code
	s.ResponseWriter.WriteHeader(code)
}

func securityHeadersMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Pragma", "no-cache")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

func healthHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()

		status := "healthy"
		redisOK := true
		pgOK := true

		if err := d.Redis.Ping(ctx); err != nil {
			redisOK = false
			status = "degraded"
		}
		if err := d.Postgres.Ping(ctx); err != nil {
			pgOK = false
			status = "degraded"
		}

		code := http.StatusOK
		if !redisOK || !pgOK {
			code = http.StatusServiceUnavailable
		}

		writeJSON(w, code, map[string]any{
			"status":   status,
			"service":  "auth-core",
			"redis":    boolState(redisOK),
			"postgres": boolState(pgOK),
			"time":     time.Now().UTC().Format(time.RFC3339),
		})
	}
}

func boolState(ok bool) string {
	if ok {
		return "connected"
	}
	return "disconnected"
}

func metricsHandler() http.HandlerFunc {
	startedAt := time.Now()
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"uptime_seconds": int64(time.Since(startedAt).Seconds()),
			"time":           time.Now().UTC().Format(time.RFC3339),
		})
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]any{"error": msg, "code": code})
}

func writeAPIError(w http.ResponseWriter, apiErr *authn.APIError) {
	if apiErr == nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Внутренняя ошибка сервера")
		return
	}
	if apiErr.RetryAfter > 0 {
		w.Header().Set("Retry-After", intString(int64(apiErr.RetryAfter.Seconds())))
	}
	body := map[string]any{"error": apiErr.Message}
	if apiErr.Code != "" {
		body["code"] = apiErr.Code
	}
	if apiErr.Recoverable {
		body["recoverable"] = true
	}
	if apiErr.ReauthRequired {
		body["reauthRequired"] = true
	}
	writeJSON(w, apiErr.Status, body)
}

func readJSON(r *http.Request, limit int64, v any) error {
	if r.Body == nil {
		return errors.New("empty body")
	}
	lr := io.LimitReader(r.Body, limit+1)
	data, err := io.ReadAll(lr)
	if err != nil {
		return err
	}
	if int64(len(data)) > limit {
		return errors.New("body too large")
	}
	if len(data) == 0 {
		return nil
	}
	return json.Unmarshal(data, v)
}

func intString(n int64) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	buf := [20]byte{}
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
