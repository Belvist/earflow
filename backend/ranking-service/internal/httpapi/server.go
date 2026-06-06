package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"ranking-service/internal/home"
	"ranking-service/internal/observability"
	"ranking-service/internal/ranking"
)

type ServerConfig struct {
	MaxBodyBytes int64
	Metrics      *observability.Metrics
	Home         *home.Service
}

type server struct {
	maxBodyBytes int64
	metrics      *observability.Metrics
	home         *home.Service
}

func NewServer(addr string, cfg ServerConfig) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           NewHandler(cfg),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
}

func NewHandler(cfg ServerConfig) http.Handler {
	metrics := cfg.Metrics
	if metrics == nil {
		metrics = observability.NewMetrics()
	}
	maxBodyBytes := cfg.MaxBodyBytes
	if maxBodyBytes <= 0 {
		maxBodyBytes = 2 * 1024 * 1024
	}

	s := server{maxBodyBytes: maxBodyBytes, metrics: metrics, home: cfg.Home}
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		s.handleHealth(w, r)
	})
	mux.Handle("/metrics", metrics.Handler())
	mux.HandleFunc("/rank", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		s.handleRank(w, r)
	})
	mux.HandleFunc("/home-playlists", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		s.handleHomePlaylists(w, r)
	})

	return metrics.Middleware(routeName)(cors(mux))
}

func (s server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

func (s server) handleRank(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		s.metrics.RecordRank("method_not_allowed", 0, 0)
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	r.Body = http.MaxBytesReader(w, r.Body, s.maxBodyBytes)

	var req ranking.Request
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		s.metrics.RecordRank("invalid_payload", 0, 0)
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": "invalid_payload"})
		return
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		s.metrics.RecordRank("invalid_payload", len(req.Candidates), 0)
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": "invalid_payload"})
		return
	}

	out, err := ranking.RankCandidates(req)
	if err != nil {
		s.metrics.RecordRank("failed", len(req.Candidates), 0)
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": "rank_failed"})
		return
	}

	s.metrics.RecordRank("ok", len(req.Candidates), len(out))
	_ = json.NewEncoder(w).Encode(ranking.Response{Ranked: out})
}

func (s server) handleHomePlaylists(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if s.home == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": "home_composer_unavailable"})
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, s.maxBodyBytes)
	var req home.Request
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": "invalid_payload"})
		return
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": "invalid_payload"})
		return
	}
	if req.UserID < 0 {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": "invalid_user"})
		return
	}
	if len(req.Seed) > 128 {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": "invalid_seed"})
		return
	}

	ctx, cancel := contextWithTimeout(r, 2500*time.Millisecond)
	defer cancel()
	resp, err := s.home.Compose(ctx, req)
	if err != nil {
		s.metrics.RecordHome("error", "none", "unknown", false, 0, 0, nil, nil)
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": "home_composer_failed"})
		return
	}
	playlistCount := 0
	for _, rail := range resp.Rails {
		playlistCount += len(rail.Playlists)
	}
	outcome := "ok"
	if playlistCount == 0 {
		outcome = "empty"
	}
	s.metrics.RecordHome(outcome, resp.Source, resp.CacheStatus, resp.Diagnostics.FallbackUsed, len(resp.Rails), playlistCount, resp.Diagnostics.BucketCounts, resp.Diagnostics.RealtimeCounts)
	_ = json.NewEncoder(w).Encode(resp)
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Accept,Authorization,Content-Type")
		w.Header().Set("Access-Control-Max-Age", "300")
		next.ServeHTTP(w, r)
	})
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
	case "/rank":
		return "rank"
	case "/home-playlists":
		return "home_playlists"
	default:
		return "other"
	}
}

func contextWithTimeout(r *http.Request, timeout time.Duration) (context.Context, context.CancelFunc) {
	if r == nil {
		return context.WithTimeout(context.Background(), timeout)
	}
	return context.WithTimeout(r.Context(), timeout)
}
