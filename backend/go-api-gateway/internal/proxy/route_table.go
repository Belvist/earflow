package proxy

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/earflow/music-platform/go-api-gateway/internal/auth"
	"github.com/earflow/music-platform/go-api-gateway/internal/config"
	"github.com/earflow/music-platform/go-api-gateway/internal/ratelimit"
	"github.com/earflow/music-platform/go-api-gateway/internal/service"
	"github.com/go-chi/chi/v5"
)

type RouteTableConfig struct {
	Gateway           config.GatewayYAML
	Upstreams         config.Upstreams
	ServiceTokens     *service.ServiceTokenManager
	Sessions          *auth.SessionManager
	Limiter           *ratelimit.Limiter
	ResponseCache     *ResponseCache
	IsProduction      bool
	InstanceID        string
	NodeEnv           string
	ServiceName       string
	GatewayConfigPath string
	AdminAuth         config.AdminAuthConfig
}

type RouteTable struct {
	cfg   RouteTableConfig
	proxy *ReverseProxy
}

func NewRouteTable(cfg RouteTableConfig) (*RouteTable, error) {
	if len(cfg.Gateway.Routes) == 0 {
		return nil, errors.New("no routes")
	}
	px, err := NewReverseProxy(cfg)
	if err != nil {
		return nil, err
	}
	return &RouteTable{cfg: cfg, proxy: px}, nil
}

func (t *RouteTable) Handler() http.Handler {
	r := chi.NewRouter()

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		mem := &runtime.MemStats{}
		runtime.ReadMemStats(mem)
		resp := map[string]any{
			"gateway":   "healthy",
			"timestamp": time.Now().UTC().Format(time.RFC3339),
			"uptime":    time.Since(startedAt).Seconds(),
			"memory": map[string]any{
				"rss":       mem.Sys,
				"heapUsed":  mem.HeapAlloc,
				"heapTotal": mem.HeapSys,
			},
		}

		if r.URL.Query().Get("detailed") == "true" {
			resp["services"] = t.checkServices(r.Context())
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	})

	r.Get("/api/version", func(w http.ResponseWriter, r *http.Request) {
		_ = r
		version := "unknown"
		if v := getenvFirst("APP_VERSION", "RELEASE_VERSION", "GIT_SHA"); v != "" {
			version = v
		}
		cfgBase := ""
		if strings.TrimSpace(t.cfg.GatewayConfigPath) != "" {
			cfgBase = filepath.Base(strings.TrimSpace(t.cfg.GatewayConfigPath))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(
			`{"version":"` + escapeJSON(version) +
				`","nodeEnv":"` + escapeJSON(t.cfg.NodeEnv) +
				`","service":"` + escapeJSON(t.cfg.ServiceName) +
				`","gatewayConfig":"` + escapeJSON(cfgBase) +
				`"}`,
		))
	})

	var promHandler http.Handler = t.proxy.metrics.PrometheusHandler()
	var jsonHandler http.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mem := &runtime.MemStats{}
		runtime.ReadMemStats(mem)
		metrics := map[string]any{
			"uptime_seconds":          time.Since(startedAt).Seconds(),
			"memory_heap_used_bytes":  mem.HeapAlloc,
			"memory_heap_total_bytes": mem.HeapSys,
			"memory_rss_bytes":        mem.Sys,
			"node_version":            runtime.Version(),
			"environment":             t.cfg.NodeEnv,
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(metrics)
	})

	if t.cfg.AdminAuth.Username != "" {
		jsonHandler = AdminAuthMiddleware(t.cfg.AdminAuth)(jsonHandler)
	} else {
		a := NewAdmin(t.cfg.Sessions, t.proxy.metrics, t.cfg.AdminAuth)
		jsonHandler = a.requireAdmin(jsonHandler)
	}

	r.Get("/metrics", promHandler.ServeHTTP)
	r.Get("/metrics.json", jsonHandler.ServeHTTP)

	r.Mount("/admin", NewAdmin(t.cfg.Sessions, t.proxy.metrics, t.cfg.AdminAuth).Handler())

	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		t.proxy.ServeHTTP(w, r)
	})
	return r
}

func (t *RouteTable) checkServices(ctx context.Context) map[string]any {
	client := &http.Client{Timeout: 2 * time.Second}

	check := func(raw string) string {
		u := strings.TrimRight(strings.TrimSpace(raw), "/")
		if u == "" {
			return "unhealthy"
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u+"/health", nil)
		if err != nil {
			return "unhealthy"
		}
		resp, err := client.Do(req)
		if err != nil {
			return "unhealthy"
		}
		_ = resp.Body.Close()
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return "healthy"
		}
		return "unhealthy"
	}

	services := map[string]any{}
	if len(t.cfg.Upstreams.Auth) > 0 {
		services["auth"] = check(t.cfg.Upstreams.Auth[0])
	}
	if len(t.cfg.Upstreams.Database) > 0 {
		services["database"] = check(t.cfg.Upstreams.Database[0])
	}
	if len(t.cfg.Upstreams.Upload) > 0 {
		services["upload"] = check(t.cfg.Upstreams.Upload[0])
	}
	if len(t.cfg.Upstreams.Artist) > 0 {
		services["artist"] = check(t.cfg.Upstreams.Artist[0])
	}
	if len(t.cfg.Upstreams.ArtistPortal) > 0 {
		services["artist_portal"] = check(t.cfg.Upstreams.ArtistPortal[0])
	}
	if len(t.cfg.Upstreams.Search) > 0 {
		services["search"] = check(t.cfg.Upstreams.Search[0])
	}
	if len(t.cfg.Upstreams.Subscription) > 0 {
		services["subscription"] = check(t.cfg.Upstreams.Subscription[0])
	}
	return services
}
