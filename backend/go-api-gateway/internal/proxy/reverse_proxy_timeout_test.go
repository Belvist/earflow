package proxy

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/earflow/music-platform/go-api-gateway/internal/config"
)

func TestCompileRouteParsesTimeoutPolicy(t *testing.T) {
	route, err := compileRoute(config.Route{
		ID:       "search",
		Upstream: "search",
		Match:    config.Match{Type: "exact", Value: "/api/search/v1"},
		Policies: config.Policies{Timeout: "4s"},
	})
	if err != nil {
		t.Fatalf("compileRoute returned error: %v", err)
	}
	if route.timeout != 4*time.Second {
		t.Fatalf("timeout = %s, want 4s", route.timeout)
	}
}

func TestCompileRouteRejectsInvalidTimeoutPolicy(t *testing.T) {
	_, err := compileRoute(config.Route{
		ID:       "bad",
		Upstream: "search",
		Match:    config.Match{Type: "exact", Value: "/api/search/v1"},
		Policies: config.Policies{Timeout: "soon"},
	})
	if err == nil {
		t.Fatal("compileRoute returned nil error for invalid timeout")
	}
}

func TestRouteTimeoutReturnsGatewayTimeout(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-time.After(500 * time.Millisecond):
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("late"))
		case <-r.Context().Done():
		}
	}))
	defer upstream.Close()

	u, err := url.Parse(upstream.URL)
	if err != nil {
		t.Fatalf("parse upstream url: %v", err)
	}

	p := &ReverseProxy{
		metrics:   NewMetrics(),
		transport: http.DefaultTransport,
	}
	p.up.m = map[string]*rr{"slow": {urls: []*url.URL{u}}}

	route := compiledRoute{
		id:       "slow",
		upstream: "slow",
		match:    config.Match{Type: "exact", Value: "/slow"},
		timeout:  20 * time.Millisecond,
	}
	route.proxy = p.newRouteProxy(route)
	p.routes = []compiledRoute{route}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/slow", nil)
	p.ServeHTTP(rec, req)

	if rec.Code != http.StatusGatewayTimeout {
		t.Fatalf("status = %d, want %d, body=%q", rec.Code, http.StatusGatewayTimeout, rec.Body.String())
	}
	if got := rec.Body.String(); got != `{"error":"Service temporarily unavailable","code":"UPSTREAM_TIMEOUT"}` {
		t.Fatalf("body = %q", got)
	}
}
