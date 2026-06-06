package metrics

import (
	"net/http"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

type Metrics struct {
	EventsProcessed      *prometheus.CounterVec
	BatchSize            prometheus.Histogram
	ProcessingDuration   prometheus.Histogram
	RetriesTotal         prometheus.Counter
	DlqTotal             prometheus.Counter
	RecommendationHits   *prometheus.CounterVec
	RealtimeDeltaUpdates *prometheus.CounterVec
}

func New() *Metrics {
	m := &Metrics{
		EventsProcessed: prometheus.NewCounterVec(
			prometheus.CounterOpts{Name: "reco_feedback_events_processed_total", Help: "Processed feedback interactions"},
			[]string{"status"},
		),
		BatchSize: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "reco_feedback_batch_size",
			Help:    "Interactions per batch",
			Buckets: []float64{1, 10, 50, 100, 200, 500, 1000, 2000},
		}),
		ProcessingDuration: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "reco_feedback_processing_duration_seconds",
			Help:    "Batch processing duration in seconds",
			Buckets: prometheus.DefBuckets,
		}),
		RetriesTotal: prometheus.NewCounter(prometheus.CounterOpts{Name: "reco_feedback_retries_total", Help: "Total feedback retries"}),
		DlqTotal:     prometheus.NewCounter(prometheus.CounterOpts{Name: "reco_feedback_dlq_total", Help: "Total moved to DLQ"}),
		RecommendationHits: prometheus.NewCounterVec(
			prometheus.CounterOpts{Name: "reco_recommendation_hits_total", Help: "Recommendation hits"},
			[]string{"action"},
		),
		RealtimeDeltaUpdates: prometheus.NewCounterVec(
			prometheus.CounterOpts{Name: "reco_feedback_realtime_delta_updates_total", Help: "Realtime Redis delta updates"},
			[]string{"status"},
		),
	}

	prometheus.MustRegister(
		m.EventsProcessed,
		m.BatchSize,
		m.ProcessingDuration,
		m.RetriesTotal,
		m.DlqTotal,
		m.RecommendationHits,
		m.RealtimeDeltaUpdates,
	)

	m.EventsProcessed.WithLabelValues("success").Add(0)
	m.EventsProcessed.WithLabelValues("error").Add(0)
	m.RecommendationHits.WithLabelValues("like").Add(0)
	m.RecommendationHits.WithLabelValues("complete").Add(0)
	m.RealtimeDeltaUpdates.WithLabelValues("success").Add(0)
	m.RealtimeDeltaUpdates.WithLabelValues("error").Add(0)

	return m
}

func (m *Metrics) Handler() http.Handler {
	return promhttp.Handler()
}

func (m *Metrics) ObserveDuration(d time.Duration) {
	m.ProcessingDuration.Observe(d.Seconds())
}
