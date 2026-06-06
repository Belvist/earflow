package observability

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

type Metrics struct {
	reg *prometheus.Registry

	HTTPRequests   *prometheus.CounterVec
	HTTPDuration   *prometheus.HistogramVec
	SearchRequests *prometheus.CounterVec
	SearchResults  *prometheus.HistogramVec
}

func NewMetrics() *Metrics {
	reg := prometheus.NewRegistry()
	reg.MustRegister(
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
	)

	m := &Metrics{reg: reg}
	m.HTTPRequests = prometheus.NewCounterVec(prometheus.CounterOpts{
		Namespace: "search", Subsystem: "http",
		Name: "requests_total",
		Help: "HTTP requests by route and status code.",
	}, []string{"method", "route", "status"})
	m.HTTPDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "search", Subsystem: "http",
		Name:    "request_duration_seconds",
		Help:    "HTTP request duration in seconds by route.",
		Buckets: []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5},
	}, []string{"method", "route"})
	m.SearchRequests = prometheus.NewCounterVec(prometheus.CounterOpts{
		Namespace: "search", Subsystem: "query",
		Name: "requests_total",
		Help: "Search requests by outcome and authentication state.",
	}, []string{"outcome", "authed"})
	m.SearchResults = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "search", Subsystem: "query",
		Name:    "results_total",
		Help:    "Number of search results returned by kind.",
		Buckets: []float64{0, 1, 2, 3, 5, 10, 20, 50, 100},
	}, []string{"kind"})

	reg.MustRegister(m.HTTPRequests, m.HTTPDuration, m.SearchRequests, m.SearchResults)
	return m
}

func (m *Metrics) Handler() http.Handler {
	return promhttp.HandlerFor(m.reg, promhttp.HandlerOpts{
		EnableOpenMetrics: true,
		Registry:          m.reg,
	})
}

func (m *Metrics) Middleware(routeName func(*http.Request) string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(rec, r)

			route := "unknown"
			if routeName != nil {
				route = routeName(r)
			}
			method := strings.ToUpper(strings.TrimSpace(r.Method))
			if method == "" {
				method = "UNKNOWN"
			}
			status := strconv.Itoa(rec.status)
			m.HTTPRequests.WithLabelValues(method, route, status).Inc()
			m.HTTPDuration.WithLabelValues(method, route).Observe(time.Since(start).Seconds())
		})
	}
}

func (m *Metrics) RecordSearch(outcome string, authed bool, tracks int, artists int, albums int) {
	authLabel := "false"
	if authed {
		authLabel = "true"
	}
	m.SearchRequests.WithLabelValues(normalizeLabel(outcome), authLabel).Inc()
	m.SearchResults.WithLabelValues("tracks").Observe(float64(nonNegative(tracks)))
	m.SearchResults.WithLabelValues("artists").Observe(float64(nonNegative(artists)))
	m.SearchResults.WithLabelValues("albums").Observe(float64(nonNegative(albums)))
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func normalizeLabel(v string) string {
	s := strings.TrimSpace(strings.ToLower(v))
	if s == "" {
		return "unknown"
	}
	return s
}

func nonNegative(v int) int {
	if v < 0 {
		return 0
	}
	return v
}
