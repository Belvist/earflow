package observability

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Metrics is the private namespace for every Prometheus collector we emit.
// Only this struct is exported — everything else is private so we can refactor
// labels later without breaking callers.
type Metrics struct {
	reg *prometheus.Registry

	WSConnections    prometheus.Gauge
	WSMessages       *prometheus.CounterVec
	WSErrors         *prometheus.CounterVec
	Commands         *prometheus.CounterVec
	RedisPubDropped  prometheus.Counter
	HTTPRequests     *prometheus.CounterVec
	HTTPDuration     *prometheus.HistogramVec
	DevicesActive    prometheus.Gauge
	Transfers        prometheus.Counter
	TransferFailed   prometheus.Counter
	RevokeAudio      prometheus.Counter
	StaleRejected    *prometheus.CounterVec
	RevisionRejected prometheus.Counter
	Reconcile        *prometheus.CounterVec
	CommandRejected  *prometheus.CounterVec
}

// New returns a wired-up Metrics instance and registers default process/go
// collectors. The returned handler is ready to be mounted on /metrics.
func NewMetrics() *Metrics {
	reg := prometheus.NewRegistry()
	reg.MustRegister(
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
	)

	m := &Metrics{reg: reg}

	m.WSConnections = prometheus.NewGauge(prometheus.GaugeOpts{
		Namespace: "dsync", Subsystem: "ws",
		Name: "connections_active",
		Help: "Current number of open WebSocket connections",
	})
	m.WSMessages = prometheus.NewCounterVec(prometheus.CounterOpts{
		Namespace: "dsync", Subsystem: "ws",
		Name: "messages_total",
		Help: "WebSocket messages processed, by direction and type",
	}, []string{"direction", "type"})
	m.WSErrors = prometheus.NewCounterVec(prometheus.CounterOpts{
		Namespace: "dsync", Subsystem: "ws",
		Name: "errors_total",
		Help: "WebSocket errors by reason",
	}, []string{"reason"})
	m.Commands = prometheus.NewCounterVec(prometheus.CounterOpts{
		Namespace: "dsync", Subsystem: "cmd",
		Name: "total",
		Help: "Device commands issued (accepted) by command name",
	}, []string{"cmd"})
	m.RedisPubDropped = prometheus.NewCounter(prometheus.CounterOpts{
		Namespace: "dsync", Subsystem: "redis",
		Name: "pub_dropped_total",
		Help: "Redis pub/sub publish attempts that failed before reaching Redis",
	})
	m.HTTPRequests = prometheus.NewCounterVec(prometheus.CounterOpts{
		Namespace: "dsync", Subsystem: "http",
		Name: "requests_total",
		Help: "HTTP requests by route and status code",
	}, []string{"method", "route", "status"})
	m.HTTPDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "dsync", Subsystem: "http",
		Name:    "request_duration_seconds",
		Help:    "HTTP request duration in seconds by route",
		Buckets: prometheus.ExponentialBuckets(0.001, 2, 14),
	}, []string{"method", "route"})
	m.DevicesActive = prometheus.NewGauge(prometheus.GaugeOpts{
		Namespace: "dsync", Subsystem: "devices",
		Name: "active",
		Help: "Devices currently registered across all users on this instance",
	})
	m.Transfers = prometheus.NewCounter(prometheus.CounterOpts{
		Namespace: "dsync", Subsystem: "transfer",
		Name: "total",
		Help: "Playback transfers performed",
	})
	m.TransferFailed = prometheus.NewCounter(prometheus.CounterOpts{
		Namespace: "dsync", Subsystem: "transfer",
		Name: "failed_total",
		Help: "Playback transfer attempts rejected or failed",
	})
	m.RevokeAudio = prometheus.NewCounter(prometheus.CounterOpts{
		Namespace: "dsync",
		Name:      "revoke_audio_total",
		Help:      "Server-originated local audio revocations sent to previous outputs",
	})
	m.StaleRejected = prometheus.NewCounterVec(prometheus.CounterOpts{
		Namespace: "dsync",
		Name:      "stale_rejected_total",
		Help:      "Stale now-playing writes rejected by reason",
	}, []string{"reason"})
	m.RevisionRejected = prometheus.NewCounter(prometheus.CounterOpts{
		Namespace: "dsync",
		Name:      "revision_rejected_total",
		Help:      "Writes or commands rejected by activeRevision fencing",
	})
	m.Reconcile = prometheus.NewCounterVec(prometheus.CounterOpts{
		Namespace: "dsync",
		Name:      "reconcile_total",
		Help:      "Server/client reconciliation events by result",
	}, []string{"result"})
	m.CommandRejected = prometheus.NewCounterVec(prometheus.CounterOpts{
		Namespace: "dsync", Subsystem: "cmd",
		Name: "rejected_total",
		Help: "Device commands rejected by reason",
	}, []string{"reason"})

	reg.MustRegister(
		m.WSConnections, m.WSMessages, m.WSErrors, m.Commands,
		m.RedisPubDropped, m.HTTPRequests, m.HTTPDuration,
		m.DevicesActive, m.Transfers, m.TransferFailed, m.RevokeAudio,
		m.StaleRejected, m.RevisionRejected, m.Reconcile, m.CommandRejected,
	)
	return m
}

// Handler returns an http.Handler serving /metrics in the Prometheus text
// format. Keep it private-port bound behind the ops network.
func (m *Metrics) Handler() http.Handler {
	return promhttp.HandlerFor(m.reg, promhttp.HandlerOpts{
		EnableOpenMetrics: true,
		Registry:          m.reg,
	})
}
