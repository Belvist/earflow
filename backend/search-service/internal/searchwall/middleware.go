package searchwall

import (
	"encoding/json"
	"net"
	"net/http"
	"strings"
	"time"
)

type Firewall struct {
	cfg       Config
	throttler *Throttler
}

func New(cfg Config) *Firewall {
	c := cfg
	if c.MaxQueryRunes <= 0 {
		c = DefaultConfig()
	}
	return &Firewall{cfg: c, throttler: NewThrottler(c)}
}

func (f *Firewall) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		values := r.URL.Query()
		q, ok := validateQuery(f.cfg, values)
		if !ok {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Invalid search query", "code": "INVALID_QUERY"})
			return
		}

		id := identityKey(r)
		now := time.Now()
		if !f.throttler.Allow(id, q, now) {
			w.Header().Set("Retry-After", "1")
			writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": "Too many requests", "code": "THROTTLED"})
			return
		}

		next.ServeHTTP(w, r)
	})
}

func identityKey(r *http.Request) string {
	uid := strings.TrimSpace(r.Header.Get("X-User-Id"))
	if uid == "" {
		uid = strings.TrimSpace(r.Header.Get("x-user-id"))
	}
	if uid != "" {
		return "u:" + uid
	}
	ip := strings.TrimSpace(r.Header.Get("CF-Connecting-IP"))
	if ip == "" {
		ip = strings.TrimSpace(r.Header.Get("X-Forwarded-For"))
		if ip != "" {
			parts := strings.Split(ip, ",")
			if len(parts) > 0 {
				ip = strings.TrimSpace(parts[0])
			}
		}
	}
	if ip == "" {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err == nil {
			ip = host
		}
	}
	if ip != "" {
		return "ip:" + ip
	}
	return "ip:unknown"
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
