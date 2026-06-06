package proxy

import (
	"net/http"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

type RouteMetricsSnapshot struct {
	Count    uint64
	Errors   uint64
	Inflight int64
	P50Ms    int64
	P95Ms    int64
	LastCode int
}

type Metrics struct {
	mu     sync.RWMutex
	routes map[string]*routeMetrics
	reg    *prometheus.Registry
	active *activeUsers

	reqTotal     *prometheus.CounterVec
	reqDuration  *prometheus.HistogramVec
	reqInflight  *prometheus.GaugeVec
	respBytesSum *prometheus.CounterVec
	cacheTotal   *prometheus.CounterVec
}

type routeMetrics struct {
	count    atomic.Uint64
	errors   atomic.Uint64
	inflight atomic.Int64
	lastCode atomic.Int64
	latency  latencyWindow
	upstream atomic.Value
}

type ActiveUserSnapshot struct {
	UserID     string
	LastSeenAt time.Time
}

type activeUsers struct {
	mu     sync.Mutex
	byID   map[string]int64
	window time.Duration
}

func newActiveUsers(window time.Duration) *activeUsers {
	if window <= 0 {
		window = 5 * time.Minute
	}
	return &activeUsers{byID: map[string]int64{}, window: window}
}

func (a *activeUsers) Touch(userID string, now time.Time) {
	uid := strings.TrimSpace(userID)
	if uid == "" {
		return
	}
	ts := now.Unix()
	a.mu.Lock()
	a.byID[uid] = ts
	a.mu.Unlock()
}

func (a *activeUsers) snapshot(now time.Time) []ActiveUserSnapshot {
	cutoff := now.Add(-a.window).Unix()
	a.mu.Lock()
	defer a.mu.Unlock()
	out := make([]ActiveUserSnapshot, 0, len(a.byID))
	for uid, ts := range a.byID {
		if ts < cutoff {
			delete(a.byID, uid)
			continue
		}
		out = append(out, ActiveUserSnapshot{UserID: uid, LastSeenAt: time.Unix(ts, 0).UTC()})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].LastSeenAt.After(out[j].LastSeenAt) })
	return out
}

func (a *activeUsers) Count(now time.Time) int {
	return len(a.snapshot(now))
}

type latencyWindow struct {
	idx    atomic.Uint64
	values []atomic.Int64
}

func newLatencyWindow(size int) latencyWindow {
	if size <= 0 {
		size = 128
	}
	vals := make([]atomic.Int64, size)
	return latencyWindow{values: vals}
}

func (w *latencyWindow) Record(d time.Duration) {
	us := d.Microseconds()
	if us <= 0 {
		us = 1
	}
	i := w.idx.Add(1) - 1
	w.values[int(i%uint64(len(w.values)))].Store(us)
}

func (w *latencyWindow) Snapshot() []int64 {
	out := make([]int64, 0, len(w.values))
	for i := range w.values {
		v := w.values[i].Load()
		if v > 0 {
			out = append(out, v)
		}
	}
	return out
}

func NewMetrics() *Metrics {
	m := &Metrics{
		routes: map[string]*routeMetrics{},
		reg:    prometheus.NewRegistry(),
		active: newActiveUsers(5 * time.Minute),
	}

	m.reqTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "gateway_http_requests_total",
		Help: "Total HTTP requests processed by the gateway reverse proxy.",
	}, []string{"route", "upstream", "method", "status_class"})

	m.reqDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "gateway_http_request_duration_seconds",
		Help:    "HTTP request duration in seconds observed by the gateway reverse proxy.",
		Buckets: []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10},
	}, []string{"route", "upstream", "method"})

	m.reqInflight = prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "gateway_http_inflight_requests",
		Help: "In-flight HTTP requests currently being processed by the gateway reverse proxy.",
	}, []string{"route", "upstream"})

	m.respBytesSum = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "gateway_http_response_bytes_total",
		Help: "Total HTTP response bytes written by the gateway reverse proxy.",
	}, []string{"route", "upstream"})

	m.cacheTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "gateway_response_cache_total",
		Help: "Gateway Redis response cache outcomes by route.",
	}, []string{"route", "outcome"})

	m.reg.MustRegister(
		prometheus.NewGoCollector(),
		prometheus.NewProcessCollector(prometheus.ProcessCollectorOpts{}),
		m.reqTotal,
		m.reqDuration,
		m.reqInflight,
		m.respBytesSum,
		m.cacheTotal,
		prometheus.NewGaugeFunc(prometheus.GaugeOpts{
			Name: "gateway_active_users_estimate",
			Help: "Estimated number of unique authenticated users seen within the last 5 minutes (per gateway instance, summed in Prometheus).",
		}, func() float64 { return float64(m.active.Count(time.Now().UTC())) }),
	)

	return m
}

func (m *Metrics) Cache(routeID string, outcome string) {
	if m == nil || m.cacheTotal == nil {
		return
	}
	out := strings.ToUpper(strings.TrimSpace(outcome))
	if out == "" {
		out = "UNKNOWN"
	}
	m.cacheTotal.WithLabelValues(routeID, out).Inc()
}

func (m *Metrics) Begin(routeID string, upstream string, method string, userID string) {
	rm := m.get(routeID)
	up := normalizeUpstreamLabel(upstream)
	rm.upstream.Store(up)
	rm.inflight.Add(1)
	rm.count.Add(1)
	m.reqInflight.WithLabelValues(routeID, up).Inc()
	m.active.Touch(userID, time.Now().UTC())
	_ = method
}

func (m *Metrics) End(routeID string, upstream string, method string, started time.Time, rec *statusRecorder) {
	rm := m.get(routeID)
	rm.inflight.Add(-1)
	code := httpStatusFromRecorder(rec)
	rm.lastCode.Store(int64(code))
	if code >= 500 {
		rm.errors.Add(1)
	}
	rm.latency.Record(time.Since(started))

	up := normalizeUpstreamLabel(upstream)
	cls := statusClass(code)
	if method == "" {
		method = "UNKNOWN"
	}
	method = strings.ToUpper(strings.TrimSpace(method))

	m.reqTotal.WithLabelValues(routeID, up, method, cls).Inc()
	m.reqDuration.WithLabelValues(routeID, up, method).Observe(time.Since(started).Seconds())
	m.reqInflight.WithLabelValues(routeID, up).Dec()
	if rec != nil {
		m.respBytesSum.WithLabelValues(routeID, up).Add(float64(rec.BytesWritten()))
	}
}

func (m *Metrics) PrometheusHandler() http.Handler {
	return promhttp.HandlerFor(m.reg, promhttp.HandlerOpts{})
}

func (m *Metrics) ActiveUsersSnapshot(limit int) []ActiveUserSnapshot {
	if limit <= 0 {
		limit = 200
	}
	list := m.active.snapshot(time.Now().UTC())
	if len(list) > limit {
		return list[:limit]
	}
	return list
}

func normalizeUpstreamLabel(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "unknown"
	}
	return s
}

func statusClass(code int) string {
	if code >= 200 && code <= 299 {
		return "2xx"
	}
	if code >= 300 && code <= 399 {
		return "3xx"
	}
	if code >= 400 && code <= 499 {
		return "4xx"
	}
	if code >= 500 && code <= 599 {
		return "5xx"
	}
	return "unknown"
}

func (m *Metrics) Snapshot() map[string]RouteMetricsSnapshot {
	m.mu.RLock()
	defer m.mu.RUnlock()

	out := make(map[string]RouteMetricsSnapshot, len(m.routes))
	for id, rm := range m.routes {
		p50, p95 := rm.latencyQuantilesMs()
		out[id] = RouteMetricsSnapshot{
			Count:    rm.count.Load(),
			Errors:   rm.errors.Load(),
			Inflight: rm.inflight.Load(),
			P50Ms:    p50,
			P95Ms:    p95,
			LastCode: int(rm.lastCode.Load()),
		}
	}
	return out
}

func (m *Metrics) get(routeID string) *routeMetrics {
	m.mu.RLock()
	rm := m.routes[routeID]
	m.mu.RUnlock()
	if rm != nil {
		return rm
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if rm = m.routes[routeID]; rm != nil {
		return rm
	}
	rm = &routeMetrics{latency: newLatencyWindow(256)}
	m.routes[routeID] = rm
	return rm
}

func (rm *routeMetrics) latencyQuantilesMs() (int64, int64) {
	vals := rm.latency.Snapshot()
	if len(vals) == 0 {
		return 0, 0
	}
	sort.Slice(vals, func(i, j int) bool { return vals[i] < vals[j] })
	p50us := percentile(vals, 0.50)
	p95us := percentile(vals, 0.95)
	return p50us / 1000, p95us / 1000
}

func percentile(sorted []int64, p float64) int64 {
	if len(sorted) == 0 {
		return 0
	}
	if p <= 0 {
		return sorted[0]
	}
	if p >= 1 {
		return sorted[len(sorted)-1]
	}
	idx := int(float64(len(sorted)-1) * p)
	if idx < 0 {
		idx = 0
	}
	if idx >= len(sorted) {
		idx = len(sorted) - 1
	}
	return sorted[idx]
}

func httpStatusFromRecorder(rec *statusRecorder) int {
	if rec == nil {
		return 0
	}
	st := rec.Status()
	if st <= 0 {
		return 0
	}
	return st
}
