package ratelimit

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

type LimiterConfig struct {
	Redis               *redis.Client
	IsProduction        bool
	TrustProxy          bool
	RateLimitMultiplier int
}

type Limiter struct {
	rdb                 *redis.Client
	isProduction        bool
	trustProxy          bool
	rateLimitMultiplier int
}

type LimitProfile struct {
	Max       int
	Window    time.Duration
	SkipOnDev bool
}

func NewLimiter(cfg LimiterConfig) *Limiter {
	multiplier := cfg.RateLimitMultiplier
	if multiplier < 1 {
		multiplier = 1
	}
	if multiplier > 100 {
		multiplier = 100
	}
	return &Limiter{rdb: cfg.Redis, isProduction: cfg.IsProduction, trustProxy: cfg.TrustProxy, rateLimitMultiplier: multiplier}
}

func (l *Limiter) GlobalMiddleware() func(http.Handler) http.Handler {
	profile := LimitProfile{Max: 10000, Window: time.Minute}
	if l.isProduction {
		profile.Max = 2000
	}
	return l.MiddlewareWithKeyFunc("global", profile, func(r *http.Request) bool {
		p := r.URL.Path
		return isStaticAsset(p)
	}, func(r *http.Request) string {
		return l.keyForIP("global", r)
	})
}

func (l *Limiter) UserMiddleware() func(http.Handler) http.Handler {
	profile := LimitProfile{Max: 20000, Window: time.Minute}
	if l.isProduction {
		profile.Max = 6000
	}
	return l.MiddlewareWithKeyFunc("user", profile, func(r *http.Request) bool {
		uid := strings.TrimSpace(r.Header.Get("X-User-Id"))
		if uid == "" {
			uid = strings.TrimSpace(r.Header.Get("x-user-id"))
		}
		return uid == ""
	}, func(r *http.Request) string {
		return l.keyForUID("user", r)
	})
}

func (l *Limiter) Middleware(name string, profile LimitProfile, skip func(*http.Request) bool) func(http.Handler) http.Handler {
	return l.MiddlewareWithKeyFunc(name, profile, skip, func(r *http.Request) string {
		return l.keyForAuto(name, r)
	})
}

func (l *Limiter) MiddlewareWithKeyFunc(name string, profile LimitProfile, skip func(*http.Request) bool, keyFunc func(*http.Request) string) func(http.Handler) http.Handler {
	profile = l.scaleProfile(profile)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if skip != nil && skip(r) {
				next.ServeHTTP(w, r)
				return
			}
			if profile.SkipOnDev && !l.isProduction {
				next.ServeHTTP(w, r)
				return
			}

			key := ""
			if keyFunc != nil {
				key = keyFunc(r)
			}
			if key == "" {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
			ok, err := l.allow(r.Context(), key, profile)
			if err != nil {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
			if !ok {
				origin := strings.TrimSpace(r.Header.Get("Origin"))
				if origin != "" {
					w.Header().Set("Access-Control-Allow-Origin", origin)
					w.Header().Set("Vary", "Origin")
					w.Header().Set("Access-Control-Allow-Credentials", "true")
				}
				w.Header().Set("Cross-Origin-Resource-Policy", "cross-origin")
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusTooManyRequests)
				_ = json.NewEncoder(w).Encode(map[string]string{"error": "Too many requests, please slow down"})
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func (l *Limiter) scaleProfile(profile LimitProfile) LimitProfile {
	if l.rateLimitMultiplier <= 1 || profile.Max <= 0 {
		return profile
	}
	profile.Max *= l.rateLimitMultiplier
	return profile
}

func (l *Limiter) allow(ctx context.Context, key string, profile LimitProfile) (bool, error) {
	pipe := l.rdb.TxPipeline()
	incr := pipe.Incr(ctx, key)
	pipe.ExpireNX(ctx, key, profile.Window)
	_, err := pipe.Exec(ctx)
	if err != nil {
		return false, err
	}
	v, err := incr.Result()
	if err != nil {
		return false, err
	}
	return int(v) <= profile.Max, nil
}

func (l *Limiter) keyForAuto(scope string, r *http.Request) string {
	userID := strings.TrimSpace(r.Header.Get("X-User-Id"))
	if userID == "" {
		userID = strings.TrimSpace(r.Header.Get("x-user-id"))
	}
	if userID != "" {
		return l.keyForUID(scope, r)
	}
	return l.keyForIP(scope, r)
}

func (l *Limiter) keyForIP(scope string, r *http.Request) string {
	ip := l.clientIP(r)
	if ip == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(ip))
	h := hex.EncodeToString(sum[:])
	return "rl:" + scope + ":ip:" + h
}

func (l *Limiter) keyForUID(scope string, r *http.Request) string {
	uid := strings.TrimSpace(r.Header.Get("X-User-Id"))
	if uid == "" {
		uid = strings.TrimSpace(r.Header.Get("x-user-id"))
	}
	if uid == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(uid))
	h := hex.EncodeToString(sum[:])
	return "rl:" + scope + ":uid:" + h
}

func (l *Limiter) remoteIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (l *Limiter) clientIP(r *http.Request) string {
	if !l.trustProxy {
		ip := strings.TrimSpace(l.remoteIP(r))
		if net.ParseIP(ip) == nil {
			return ""
		}
		return ip
	}

	for _, key := range []string{"CF-Connecting-IP", "X-Real-IP"} {
		v := strings.TrimSpace(r.Header.Get(key))
		if v == "" {
			continue
		}
		if net.ParseIP(v) != nil {
			return v
		}
	}

	if xff := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); xff != "" {
		parts := strings.Split(xff, ",")
		if len(parts) > 0 {
			first := strings.TrimSpace(parts[0])
			if net.ParseIP(first) != nil {
				return first
			}
		}
	}

	ip := strings.TrimSpace(l.remoteIP(r))
	if net.ParseIP(ip) == nil {
		return ""
	}
	return ip
}

func isStaticAsset(path string) bool {
	if strings.HasPrefix(path, "/health") {
		return true
	}
	if path == "/metrics" {
		return true
	}
	if strings.HasPrefix(path, "/covers") {
		return true
	}
	if strings.HasPrefix(path, "/api/songs/cover/") || strings.HasPrefix(path, "/api/songs/cover") {
		return true
	}
	if strings.HasSuffix(path, ".webp") || strings.HasSuffix(path, ".jpg") || strings.HasSuffix(path, ".jpeg") || strings.HasSuffix(path, ".png") {
		return true
	}
	return false
}
