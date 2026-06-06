// Package httpapi wires chi routes, middleware, and handlers. Everything
// private is unexported — public surface = New + mounted routes.
package httpapi

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"runtime/debug"
	"strconv"
	"sync"
	"time"

	"github.com/earflow/music-platform/device-sync-service/internal/auth"
	"github.com/earflow/music-platform/device-sync-service/internal/config"
	"github.com/earflow/music-platform/device-sync-service/internal/observability"
	"github.com/google/uuid"
	"golang.org/x/time/rate"
)

type ctxKey int

const requestIDKey ctxKey = 1

// requestID middleware assigns or propagates X-Request-Id so every log line
// of one request can be correlated.
func requestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-Id")
		if id == "" {
			id = uuid.NewString()
		}
		w.Header().Set("X-Request-Id", id)
		ctx := context.WithValue(r.Context(), requestIDKey, id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequestID extracts the propagated request id from ctx, "" if absent.
func RequestID(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	v, _ := ctx.Value(requestIDKey).(string)
	return v
}

// recoverer stops a panic from taking down the whole worker.
func recoverer(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					log.Error("panic",
						slog.Any("panic", rec),
						slog.String("path", r.URL.Path),
						slog.String("stack", string(debug.Stack())),
					)
					http.Error(w, "internal error", http.StatusInternalServerError)
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

// accessLog attaches a structured access log line with duration/status.
func accessLog(log *slog.Logger, m *observability.Metrics) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/health" || r.URL.Path == "/metrics" {
				next.ServeHTTP(w, r)
				return
			}
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w, status: 200}
			next.ServeHTTP(rec, r)
			d := time.Since(start)

			lvl := slog.LevelDebug
			if rec.status >= 500 {
				lvl = slog.LevelError
			} else if rec.status >= 400 {
				lvl = slog.LevelWarn
			} else if d > time.Second {
				lvl = slog.LevelWarn
			}
			log.Log(r.Context(), lvl, "request",
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.Int("status", rec.status),
				slog.Duration("duration", d),
				slog.String("request_id", RequestID(r.Context())),
			)
			if m != nil {
				m.HTTPRequests.WithLabelValues(r.Method, r.URL.Path, strconv.Itoa(rec.status)).Inc()
				m.HTTPDuration.WithLabelValues(r.Method, r.URL.Path).Observe(d.Seconds())
			}
		})
	}
}

// statusRecorder wraps http.ResponseWriter to capture the final status code
// for access logging. CRITICAL: it must proxy the interfaces the underlying
// writer implements — specifically http.Hijacker for WebSocket upgrades and
// http.Flusher for Server-Sent Events. Go's struct embedding does NOT
// transitively satisfy interfaces: a wrapper that embeds ResponseWriter is
// not a Hijacker unless we explicitly forward the method.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

// Hijack forwards to the underlying writer so that upgrading connections
// (WebSocket) works behind this middleware. coder/websocket.Accept() aborts
// with 501 Not Implemented when the writer isn't a Hijacker.
func (s *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hj, ok := s.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("underlying ResponseWriter does not implement http.Hijacker")
	}
	return hj.Hijack()
}

// Flush forwards a flush call if supported — useful for future SSE endpoints.
// No-op otherwise.
func (s *statusRecorder) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// authRequired maps the authenticated user into ctx. 401 on failure.
func authRequired(cfg *config.Config) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			u, err := auth.Identify(r, cfg)
			if err != nil || u == nil {
				writeJSON(w, http.StatusUnauthorized, errorBody("unauthorized", "NO_AUTH"))
				return
			}
			next.ServeHTTP(w, r.WithContext(auth.WithUser(r.Context(), u)))
		})
	}
}

// featureGate short-circuits every request with 503 while the feature flag is
// off. We still answer /health and /metrics normally (they bypass this).
func featureGate(cfg *config.Config) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !cfg.Enabled {
				writeJSON(w, http.StatusServiceUnavailable, errorBody("feature disabled", "FEATURE_DISABLED"))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// httpRateLimiter is per-IP token bucket. Safe for 100k+ DAU at ~120 rps/IP
// with bounded memory thanks to periodic eviction.
type httpRateLimiter struct {
	perSecond float64
	burst     int
	mu        sync.Mutex
	buckets   map[string]*rate.Limiter
	lastUse   map[string]int64
}

func newHTTPRateLimiter(cfg *config.Config) *httpRateLimiter {
	perSec := float64(cfg.HTTP.RateLimitMax) / cfg.HTTP.RateLimitWindow.Seconds()
	if perSec < 1 {
		perSec = 1
	}
	l := &httpRateLimiter{
		perSecond: perSec,
		burst:     cfg.HTTP.RateLimitMax,
		buckets:   make(map[string]*rate.Limiter, 1024),
		lastUse:   make(map[string]int64, 1024),
	}
	go l.sweeper()
	return l
}

func (l *httpRateLimiter) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)
		l.mu.Lock()
		lim, ok := l.buckets[ip]
		if !ok {
			lim = rate.NewLimiter(rate.Limit(l.perSecond), l.burst)
			l.buckets[ip] = lim
		}
		l.lastUse[ip] = time.Now().UnixNano()
		l.mu.Unlock()

		if !lim.Allow() {
			w.Header().Set("Retry-After", "1")
			writeJSON(w, http.StatusTooManyRequests, errorBody("too many requests", "RATE_LIMITED"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (l *httpRateLimiter) sweeper() {
	t := time.NewTicker(2 * time.Minute)
	defer t.Stop()
	for now := range t.C {
		cutoff := now.Add(-10 * time.Minute).UnixNano()
		l.mu.Lock()
		for k, u := range l.lastUse {
			if u < cutoff {
				delete(l.lastUse, k)
				delete(l.buckets, k)
			}
		}
		l.mu.Unlock()
	}
}

func clientIP(r *http.Request) string {
	// go-api-gateway sits in front: trust X-Forwarded-For first entry.
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		for i := 0; i < len(xff); i++ {
			if xff[i] == ',' {
				return xff[:i]
			}
		}
		return xff
	}
	if xri := r.Header.Get("X-Real-Ip"); xri != "" {
		return xri
	}
	host := r.RemoteAddr
	for i := len(host) - 1; i >= 0; i-- {
		if host[i] == ':' {
			return host[:i]
		}
	}
	return host
}

// =============================================================================
// JSON helpers — kept allocation-small for hot paths.
// =============================================================================

type jsonError struct {
	Error string `json:"error"`
	Code  string `json:"code,omitempty"`
}

func errorBody(msg, code string) jsonError {
	return jsonError{Error: msg, Code: code}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func readJSON(r *http.Request, maxBytes int64, dst any) error {
	r.Body = http.MaxBytesReader(nil, r.Body, maxBytes)
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return err
	}
	if dec.More() {
		return errors.New("unexpected trailing JSON")
	}
	return nil
}
