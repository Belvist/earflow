package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/earflow/music-platform/search-service/internal/meili"
	"github.com/earflow/music-platform/search-service/internal/observability"
	"github.com/earflow/music-platform/search-service/internal/search"
	"github.com/earflow/music-platform/search-service/internal/searchwall"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ServerConfig struct {
	Addr           string
	Logger         *slog.Logger
	Meili          *meili.Client
	DB             *pgxpool.Pool
	PublicMaxLimit int
	AuthedMaxLimit int
	RequestTimeout time.Duration
	Metrics        *observability.Metrics
}

func NewServer(cfg ServerConfig) *http.Server {
	r := chi.NewRouter()
	metrics := cfg.Metrics
	if metrics == nil {
		metrics = observability.NewMetrics()
	}
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(cfg.RequestTimeout))
	r.Use(metrics.Middleware(routeName))
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("Pragma", "no-cache")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("X-Frame-Options", "DENY")
			w.Header().Set("Referrer-Policy", "no-referrer")
			next.ServeHTTP(w, r)
		})
	})

	svc := search.NewService(search.ServiceConfig{
		Meili:          cfg.Meili,
		DB:             cfg.DB,
		Logger:         cfg.Logger,
		PublicMaxLimit: cfg.PublicMaxLimit,
		AuthedMaxLimit: cfg.AuthedMaxLimit,
	})

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "healthy", "service": "search-service"})
		_ = r
	})
	r.Handle("/metrics", metrics.Handler())

	fwCfg := searchwall.DefaultConfig()
	fwCfg.RequireSingleValueKeys = true
	fw := searchwall.New(fwCfg)

	r.With(fw.Middleware).Get("/api/search/v1", func(w http.ResponseWriter, r *http.Request) {
		uid := strings.TrimSpace(r.Header.Get("X-User-Id"))
		if uid == "" {
			uid = strings.TrimSpace(r.Header.Get("x-user-id"))
		}
		authed := uid != ""

		q := strings.TrimSpace(r.URL.Query().Get("q"))
		if q == "" {
			limit := parseInt(r.URL.Query().Get("limit"), 0)
			resp, err := svc.Search(r.Context(), search.Request{Query: "", Limit: limit, Offset: 0, IsAuthed: authed})
			if err != nil {
				resp = search.Response{Query: "", Tracks: []search.Track{}, Artists: []search.Artist{}, Albums: []search.Album{}, Recommendations: []search.Track{}, Meta: search.Meta{}}
			}
			metrics.RecordSearch("empty", authed, len(resp.Recommendations), 0, 0)
			writeJSON(w, http.StatusOK, resp)
			return
		}

		limit := parseInt(r.URL.Query().Get("limit"), 0)
		offset := parseInt(r.URL.Query().Get("offset"), 0)

		resp, err := svc.Search(r.Context(), search.Request{Query: q, Limit: limit, Offset: offset, IsAuthed: authed})
		if err != nil {
			if errors.Is(err, context.DeadlineExceeded) {
				metrics.RecordSearch("timeout", authed, 0, 0, 0)
				writeJSON(w, http.StatusGatewayTimeout, map[string]any{"error": "Search timeout", "code": "TIMEOUT"})
				return
			}
			metrics.RecordSearch("unavailable", authed, 0, 0, 0)
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "Search unavailable", "code": "SEARCH_UNAVAILABLE"})
			return
		}
		outcome := "ok"
		if len(resp.Tracks)+len(resp.Artists)+len(resp.Albums) == 0 {
			outcome = "empty_results"
		}
		metrics.RecordSearch(outcome, authed, len(resp.Tracks), len(resp.Artists), len(resp.Albums))
		writeJSON(w, http.StatusOK, resp)
	})

	return &http.Server{
		Addr:              cfg.Addr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      0,
		IdleTimeout:       60 * time.Second,
	}
}

func routeName(r *http.Request) string {
	if r == nil || r.URL == nil {
		return "unknown"
	}
	switch r.URL.Path {
	case "/health":
		return "health"
	case "/metrics":
		return "metrics"
	case "/api/search/v1":
		return "search_v1"
	default:
		return "other"
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func parseInt(raw string, def int) int {
	v := strings.TrimSpace(raw)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}
