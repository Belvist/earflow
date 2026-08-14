package httpapi

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/earflow/music-platform/auth-core/internal/config"
	"github.com/earflow/music-platform/auth-core/internal/store"
)

func TestClientIPPrefersXRealIP(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/auth/email/login", nil)
	// Attacker-supplied X-Forwarded-For must be ignored when nginx-set
	// X-Real-IP (TCP peer) is present.
	req.Header.Set("X-Forwarded-For", "1.2.3.4, 5.6.7.8")
	req.Header.Set("X-Real-IP", "8.8.4.4")

	if got := clientIP(req); got != "8.8.4.4" {
		t.Fatalf("clientIP = %q, want nginx X-Real-IP 8.8.4.4", got)
	}
}

func TestClientIPIgnoresSpoofedXFF(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/auth/email/login", nil)
	// Without X-Real-IP the header must not leak the client-controlled first
	// XFF entry into throttles; fall back to the socket peer.
	req.Header.Set("X-Forwarded-For", "6.6.6.6")
	req.RemoteAddr = "10.0.0.5:4444"

	if got := clientIP(req); got != "10.0.0.5" {
		t.Fatalf("clientIP = %q, want socket peer 10.0.0.5 (XFF ignored)", got)
	}
}

func TestClientIPBareRemoteAddr(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/auth/email/login", nil)
	req.RemoteAddr = "127.0.0.1"

	if got := clientIP(req); got != "127.0.0.1" {
		t.Fatalf("clientIP = %q, want 127.0.0.1", got)
	}
}

func TestThrottleAuthIPBlocksAfterMaxFailures(t *testing.T) {
	mr := miniredis.RunT(t)
	defer mr.Close()

	host, portStr, err := net.SplitHostPort(mr.Addr())
	if err != nil {
		t.Fatalf("miniredis addr: %v", err)
	}
	port, _ := strconv.Atoi(portStr)

	rd, err := store.NewRedis(context.Background(), config.RedisConfig{
		Host:        host,
		Port:        port,
		DialTimeout: 2 * time.Second,
	})
	if err != nil {
		t.Fatalf("redis connect: %v", err)
	}
	defer rd.Close()

	cfg := config.Config{}
	cfg.Auth.AuthEndpointIPMax = 3
	cfg.Auth.AuthEndpointIPWindow = 60 * time.Second
	d := Deps{Config: cfg, Redis: rd}

	var lastCode int
	inner := func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(lastCode)
	}
	throttled := throttleAuthIP(d)(inner)

	newPair := func() (*httptest.ResponseRecorder, *http.Request) {
		req := httptest.NewRequest(http.MethodPost, "/api/auth/email/register", nil)
		req.Header.Set("X-Real-IP", "1.2.3.4")
		return httptest.NewRecorder(), req
	}

	// Successes must NOT count (skipSuccessful semantics).
	for i := 0; i < 5; i++ {
		lastCode = http.StatusCreated
		rec, req := newPair()
		throttled(rec, req)
	}
	if mr.Exists("auth:ip_fail:1.2.3.4") {
		t.Fatal("successful requests must not be counted")
	}

	// max (3) failing requests are allowed, the next one is blocked.
	for i := 0; i < 3; i++ {
		lastCode = http.StatusBadRequest
		rec, req := newPair()
		throttled(rec, req)
	}
	lastCode = http.StatusBadRequest
	rec, req := newPair()
	throttled(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 after max failures, got %d", rec.Code)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Fatal("expected Retry-After header on throttle response")
	}
}

func TestStatusRecorderCapturesCode(t *testing.T) {
	rec := httptest.NewRecorder()
	sr := &statusRecorder{ResponseWriter: rec, code: http.StatusOK}
	sr.WriteHeader(http.StatusCreated)
	if sr.code != http.StatusCreated {
		t.Fatalf("captured %d, want 201", sr.code)
	}
}
