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
	RankRequests   *prometheus.CounterVec
	RankCandidates *prometheus.HistogramVec
	HomeRequests   *prometheus.CounterVec
	HomeRails      prometheus.Histogram
	HomePlaylists  prometheus.Histogram
	HomeCache      *prometheus.CounterVec
	HomeFallback   *prometheus.CounterVec
	HomeBuckets    *prometheus.CounterVec
	HomeRealtime   *prometheus.CounterVec
}

func NewMetrics() *Metrics {
	reg := prometheus.NewRegistry()
	reg.MustRegister(
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
	)

	m := &Metrics{reg: reg}
	m.HTTPRequests = prometheus.NewCounterVec(prometheus.CounterOpts{
		Namespace: "ranking", Subsystem: "http",
		Name: "requests_total",
		Help: "HTTP requests by route and status code.",
	}, []string{"method", "route", "status"})
	m.HTTPDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "ranking", Subsystem: "http",
		Name:    "request_duration_seconds",
		Help:    "HTTP request duration in seconds by route.",
		Buckets: []float64{0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5},
	}, []string{"method", "route"})
	m.RankRequests = prometheus.NewCounterVec(prometheus.CounterOpts{
		Namespace: "ranking", Subsystem: "rank",
		Name: "requests_total",
		Help: "Ranking requests by outcome.",
	}, []string{"outcome"})
	m.RankCandidates = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "ranking", Subsystem: "rank",
		Name:    "candidates_total",
		Help:    "Number of input and returned ranking candidates.",
		Buckets: []float64{0, 1, 5, 10, 20, 50, 100, 250, 500, 1000},
	}, []string{"phase"})
	m.HomeRequests = prometheus.NewCounterVec(prometheus.CounterOpts{
		Namespace: "ranking", Subsystem: "home",
		Name: "requests_total",
		Help: "Home playlist composer requests by outcome and source.",
	}, []string{"outcome", "source"})
	m.HomeRails = prometheus.NewHistogram(prometheus.HistogramOpts{
		Namespace: "ranking", Subsystem: "home",
		Name:    "rails_total",
		Help:    "Number of rails returned by the home playlist composer.",
		Buckets: []float64{0, 1, 2, 3, 5, 8, 13},
	})
	m.HomePlaylists = prometheus.NewHistogram(prometheus.HistogramOpts{
		Namespace: "ranking", Subsystem: "home",
		Name:    "playlists_total",
		Help:    "Number of playlists returned by the home playlist composer.",
		Buckets: []float64{0, 1, 2, 4, 8, 12, 16, 24},
	})
	m.HomeCache = prometheus.NewCounterVec(prometheus.CounterOpts{
		Namespace: "ranking", Subsystem: "home",
		Name: "cache_events_total",
		Help: "Home playlist composer cache events.",
	}, []string{"status"})
	m.HomeFallback = prometheus.NewCounterVec(prometheus.CounterOpts{
		Namespace: "ranking", Subsystem: "home",
		Name: "fallback_events_total",
		Help: "Home playlist composer fallback path events.",
	}, []string{"status"})
	m.HomeBuckets = prometheus.NewCounterVec(prometheus.CounterOpts{
		Namespace: "ranking", Subsystem: "home",
		Name: "bucket_tracks_total",
		Help: "Home playlist composer selected tracks by bucket.",
	}, []string{"bucket"})
	m.HomeRealtime = prometheus.NewCounterVec(prometheus.CounterOpts{
		Namespace: "ranking", Subsystem: "home",
		Name: "realtime_matches_total",
		Help: "Home playlist composer realtime Redis matches by type.",
	}, []string{"type"})

	reg.MustRegister(m.HTTPRequests, m.HTTPDuration, m.RankRequests, m.RankCandidates, m.HomeRequests, m.HomeRails, m.HomePlaylists, m.HomeCache, m.HomeFallback, m.HomeBuckets, m.HomeRealtime)
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
			m.HTTPRequests.WithLabelValues(method, route, strconv.Itoa(rec.status)).Inc()
			m.HTTPDuration.WithLabelValues(method, route).Observe(time.Since(start).Seconds())
		})
	}
}

func (m *Metrics) RecordRank(outcome string, inputCandidates int, rankedCandidates int) {
	m.RankRequests.WithLabelValues(normalizeLabel(outcome)).Inc()
	m.RankCandidates.WithLabelValues("input").Observe(float64(nonNegative(inputCandidates)))
	m.RankCandidates.WithLabelValues("ranked").Observe(float64(nonNegative(rankedCandidates)))
}

func (m *Metrics) RecordHome(outcome string, source string, cacheStatus string, fallbackUsed bool, rails int, playlists int, bucketCounts map[string]int, realtimeCounts map[string]int) {
	m.HomeRequests.WithLabelValues(normalizeLabel(outcome), normalizeLabel(source)).Inc()
	m.HomeRails.Observe(float64(nonNegative(rails)))
	m.HomePlaylists.Observe(float64(nonNegative(playlists)))
	m.HomeCache.WithLabelValues(normalizeLabel(cacheStatus)).Inc()
	m.HomeFallback.WithLabelValues(boolStatus(fallbackUsed)).Inc()
	for bucket, count := range bucketCounts {
		m.HomeBuckets.WithLabelValues(normalizeLabel(bucket)).Add(float64(nonNegative(count)))
	}
	for typ, count := range realtimeCounts {
		m.HomeRealtime.WithLabelValues(normalizeLabel(typ)).Add(float64(nonNegative(count)))
	}
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

func boolStatus(v bool) string {
	if v {
		return "used"
	}
	return "not_used"
}
