package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/earflow/music-platform/security-service/internal/authz"
	"github.com/earflow/music-platform/security-service/internal/config"
	"github.com/earflow/music-platform/security-service/internal/domain"
	"github.com/earflow/music-platform/security-service/internal/store"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

type Deps struct {
	Config   config.Config
	Redis    *store.RedisClient
	Postgres *store.Postgres
	AuthSoT  *store.AuthSoT
	Logger   *slog.Logger
	Verifier authz.Verifier
}

func NewServer(d Deps) *http.Server {
	r := chi.NewRouter()
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(d.Config.HTTP.HandlerTimeout))
	r.Use(securityHeadersMiddleware)

	r.Get("/health", healthHandler(d))
	r.Get("/metrics", metricsHandler())

	r.Group(func(r chi.Router) {
		r.Use(authz.ServiceKeyMiddleware(d.Config.ServiceKeyGateway))
		r.Post("/internal/auth/v1/sessions/upsert", internalSessionUpsertHandler(d))
		r.Post("/internal/auth/v1/devices/upsert", internalDeviceUpsertHandler(d))
		r.Post("/internal/auth/v1/sessions/revoke", internalSessionRevokeHandler(d))
		r.Post("/internal/auth/v1/epochs/lookup", internalEpochsLookupHandler(d))
	})

	r.Group(func(r chi.Router) {
		r.Use(d.Verifier.Middleware())

		r.Get("/api/auth/security/overview", overviewHandler(d))

		r.Post("/api/auth/password/strength", passwordStrengthHandler(d))
		r.Post("/api/auth/password/change", passwordChangeHandler(d))

		r.Post("/api/auth/telegram/unlink", telegramUnlinkHandler(d))

		r.Get("/api/auth/sessions", listSessionsHandler(d))
		r.Post("/api/auth/sessions/revoke", revokeSessionHandler(d))
		r.Post("/api/auth/sessions/revoke-others", revokeOtherSessionsHandler(d))

		r.Post("/api/auth/2fa/recovery/regenerate", recoveryRegenerateHandler(d))
	})

	return &http.Server{
		Addr:              d.Config.HTTP.Addr(),
		Handler:           r,
		ReadHeaderTimeout: d.Config.HTTP.ReadHeaderTimeout,
		ReadTimeout:       d.Config.HTTP.ReadTimeout,
		WriteTimeout:      d.Config.HTTP.WriteTimeout,
		IdleTimeout:       d.Config.HTTP.IdleTimeout,
	}
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
			"service":  "security-service",
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

func writeRetry(w http.ResponseWriter, retryAfter int64, msg string) {
	if retryAfter > 0 {
		w.Header().Set("Retry-After", intToString(retryAfter))
	}
	writeJSON(w, http.StatusTooManyRequests, map[string]any{
		"error":      msg,
		"code":       "RATE_LIMITED",
		"retryAfter": retryAfter,
	})
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

func intToString(n int64) string {
	if n == 0 {
		return "0"
	}
	neg := false
	if n < 0 {
		neg = true
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

// helper to compute base SecurityContext from user state
func makeSecurityContext(u *store.User, stepUpActive bool, recoveryCount int) domain.SecurityContext {
	enabledAt := ""
	if u != nil && u.MFAEnabledAt != nil {
		enabledAt = u.MFAEnabledAt.UTC().Format(time.RFC3339)
	}
	return domain.SecurityContext{
		MFAEnabled:             u != nil && u.MFAEnabled,
		MFAEnabledAt:           enabledAt,
		HasPassword:            u != nil && u.HasPassword(),
		HasTelegram:            u != nil && u.HasTelegram(),
		RecoveryCodesRemaining: recoveryCount,
		StepUpActive:           stepUpActive,
	}
}
