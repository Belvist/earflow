/**
 * Prometheus Metrics
 * Централизованный модуль метрик для всего сервиса
 * @module metrics
 */

const promClient = require('prom-client');

// Ленивая загрузка конфига для избежания циклических зависимостей
let METRICS_PREFIX = 'reco_';
try {
  const config = require('./config');
  METRICS_PREFIX = config.metrics?.prefix || 'reco_';
} catch {
  METRICS_PREFIX = process.env.RECO_METRICS_PREFIX || 'reco_';
}

const register = new promClient.Registry();

promClient.collectDefaultMetrics({
  register,
  prefix: METRICS_PREFIX,
});

const httpRequestDuration = new promClient.Histogram({
  name: `${METRICS_PREFIX}http_request_duration_seconds`,
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

const httpRequestsTotal = new promClient.Counter({
  name: `${METRICS_PREFIX}http_requests_total`,
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const feedbackEventsProcessed = new promClient.Counter({
  name: `${METRICS_PREFIX}feedback_events_processed_total`,
  help: 'Total number of feedback events processed',
  labelNames: ['type', 'status'],
  registers: [register],
});

const feedbackBatchSize = new promClient.Histogram({
  name: `${METRICS_PREFIX}feedback_batch_size`,
  help: 'Size of feedback batches processed',
  buckets: [1, 5, 10, 25, 50, 100, 200, 500],
  registers: [register],
});

const feedbackProcessingDuration = new promClient.Histogram({
  name: `${METRICS_PREFIX}feedback_processing_duration_seconds`,
  help: 'Duration of feedback batch processing in seconds',
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [register],
});

const feedbackQueueSize = new promClient.Gauge({
  name: `${METRICS_PREFIX}feedback_queue_size`,
  help: 'Current size of feedback queue',
  labelNames: ['queue'],
  registers: [register],
});

const feedbackRetriesTotal = new promClient.Counter({
  name: `${METRICS_PREFIX}feedback_retries_total`,
  help: 'Total number of feedback event retries',
  registers: [register],
});

const feedbackDlqTotal = new promClient.Counter({
  name: `${METRICS_PREFIX}feedback_dlq_total`,
  help: 'Total number of events sent to DLQ',
  registers: [register],
});

const dbQueryDuration = new promClient.Histogram({
  name: `${METRICS_PREFIX}db_query_duration_seconds`,
  help: 'Duration of database queries in seconds',
  labelNames: ['operation'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

const dbCircuitState = new promClient.Gauge({
  name: `${METRICS_PREFIX}db_circuit_state`,
  help: 'Database circuit breaker state (0=closed, 1=half-open, 2=open)',
  registers: [register],
});

const redisOperationDuration = new promClient.Histogram({
  name: `${METRICS_PREFIX}redis_operation_duration_seconds`,
  help: 'Duration of Redis operations in seconds',
  labelNames: ['operation'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [register],
});

const recommendationsServed = new promClient.Counter({
  name: `${METRICS_PREFIX}recommendations_served_total`,
  help: 'Total number of recommendation requests served',
  labelNames: ['endpoint', 'source'],
  registers: [register],
});

const recommendationImpressionsTotal = new promClient.Counter({
  name: `${METRICS_PREFIX}recommendation_impressions_total`,
  help: 'Total number of tracks served in recommendation responses',
  labelNames: ['endpoint', 'source'],
  registers: [register],
});

const recommendationEmptyResponsesTotal = new promClient.Counter({
  name: `${METRICS_PREFIX}recommendation_empty_responses_total`,
  help: 'Total number of recommendation responses with zero tracks',
  labelNames: ['endpoint'],
  registers: [register],
});

const recommendationHitsTotal = new promClient.Counter({
  name: `${METRICS_PREFIX}recommendation_hits_total`,
  help: 'Total number of positive interactions (like/complete) on previously served recommendations',
  labelNames: ['action'],
  registers: [register],
});

const recommendationGenreDiversityRatio = new promClient.Gauge({
  name: `${METRICS_PREFIX}recommendation_genre_diversity_ratio`,
  help: 'Unique genres / total tracks for the last response',
  labelNames: ['endpoint'],
  registers: [register],
});

const sessionsCreated = new promClient.Counter({
  name: `${METRICS_PREFIX}sessions_created_total`,
  help: 'Total number of recommendation sessions created',
  registers: [register],
});

function metricsMiddleware(req, res, next) {
  const startTime = Date.now();

  res.on('finish', () => {
    const duration = (Date.now() - startTime) / 1000;
    const route = req.route ? req.route.path : req.path;
    const labels = {
      method: req.method,
      route,
      status_code: res.statusCode,
    };

    httpRequestDuration.observe(labels, duration);
    httpRequestsTotal.inc(labels);
  });

  next();
}

async function getMetrics() {
  return register.metrics();
}

function getContentType() {
  return register.contentType;
}

module.exports = {
  register,
  metricsMiddleware,
  getMetrics,
  getContentType,
  httpRequestDuration,
  httpRequestsTotal,
  feedbackEventsProcessed,
  feedbackBatchSize,
  feedbackProcessingDuration,
  feedbackQueueSize,
  feedbackRetriesTotal,
  feedbackDlqTotal,
  dbQueryDuration,
  dbCircuitState,
  redisOperationDuration,
  recommendationsServed,
  recommendationImpressionsTotal,
  recommendationEmptyResponsesTotal,
  recommendationHitsTotal,
  recommendationGenreDiversityRatio,
  sessionsCreated,
};
