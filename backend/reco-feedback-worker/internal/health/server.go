package health

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"sync"
	"time"

	"reco-feedback-worker/internal/config"
	"reco-feedback-worker/internal/metrics"
)

type Server struct {
	cfg       config.HealthConfig
	m         *metrics.Metrics
	srv       *http.Server
	startTime time.Time

	mu            sync.RWMutex
	lastActivity  time.Time
	customMetrics map[string]any
}

type Status struct {
	Status            string         `json:"status"`
	Uptime            int64          `json:"uptime"`
	StartedAt         string         `json:"startedAt"`
	LastActivityAt    string         `json:"lastActivityAt"`
	InactivitySeconds int64          `json:"inactivitySeconds"`
	Metrics           map[string]any `json:"metrics"`
}

func NewServer(cfg config.Config, m *metrics.Metrics) *Server {
	s := &Server{
		cfg:           cfg.Health,
		m:             m,
		startTime:     time.Now(),
		lastActivity:  time.Now(),
		customMetrics: map[string]any{},
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/health/live", s.handleHealth)
	mux.HandleFunc("/health/ready", s.handleReady)
	mux.Handle("/metrics", m.Handler())

	s.srv = &http.Server{
		Addr:              ":" + itoa(cfg.Health.Port),
		Handler:           withCORS(mux),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
		BaseContext: func(_ net.Listener) context.Context {
			return context.Background()
		},
	}

	return s
}

func (s *Server) ListenAndServe() error {
	return s.srv.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
	return s.srv.Shutdown(ctx)
}

func (s *Server) UpdateActivity() {
	s.mu.Lock()
	s.lastActivity = time.Now()
	s.mu.Unlock()
}

func (s *Server) UpdateMetrics(kv map[string]any) {
	if kv == nil {
		return
	}
	s.mu.Lock()
	if s.customMetrics == nil {
		s.customMetrics = map[string]any{}
	}
	for k, v := range kv {
		s.customMetrics[k] = v
	}
	s.mu.Unlock()
}

func (s *Server) status() Status {
	s.mu.RLock()
	last := s.lastActivity
	custom := make(map[string]any, len(s.customMetrics))
	for k, v := range s.customMetrics {
		custom[k] = v
	}
	s.mu.RUnlock()

	inactive := time.Since(last)
	state := "healthy"
	if inactive > s.cfg.MaxInactivity {
		state = "unhealthy"
	} else if inactive > s.cfg.MaxInactivity/2 {
		state = "degraded"
	}

	return Status{
		Status:            state,
		Uptime:            int64(time.Since(s.startTime).Seconds()),
		StartedAt:         s.startTime.UTC().Format(time.RFC3339),
		LastActivityAt:    last.UTC().Format(time.RFC3339),
		InactivitySeconds: int64(inactive.Seconds()),
		Metrics:           custom,
	}
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	st := s.status()
	code := http.StatusOK
	if st.Status == "unhealthy" {
		code = http.StatusServiceUnavailable
	}
	writeJSON(w, code, st)
}

func (s *Server) handleReady(w http.ResponseWriter, _ *http.Request) {
	st := s.status()
	ready := st.Status != "unhealthy"
	code := http.StatusOK
	if !ready {
		code = http.StatusServiceUnavailable
	}
	writeJSON(w, code, map[string]any{"ready": ready, "status": st.Status})
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func itoa(v int) string {
	if v == 0 {
		return "0"
	}
	neg := false
	if v < 0 {
		neg = true
		v = -v
	}
	buf := make([]byte, 0, 16)
	for v > 0 {
		d := v % 10
		buf = append(buf, byte('0'+d))
		v /= 10
	}
	for i, j := 0, len(buf)-1; i < j; i, j = i+1, j-1 {
		buf[i], buf[j] = buf[j], buf[i]
	}
	if neg {
		buf = append([]byte{'-'}, buf...)
	}
	return string(buf)
}
