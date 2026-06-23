/**
 * Health & Metrics Routes
 * @module routes/health
 */

const express = require('express');
const config = require('../config');
const { checkConnection: checkDb, getCircuitState } = require('../lib/database');
const { isReady: isRedisReady } = require('../lib/redis');
const { getMetrics, getContentType } = require('../metrics');
const { getBuildInfo } = require('../lib/buildInfo');

const router = express.Router();

/**
 * GET /health
 * Health check endpoint
 */
router.get('/health', async (req, res) => {
  try {
    const dbOk = await checkDb();
    const redisOk = isRedisReady();
    const circuitState = getCircuitState();
    const buildInfo = getBuildInfo();

    const status = dbOk && redisOk && !circuitState.isOpen ? 'healthy' : 'degraded';
    const httpStatus = status === 'healthy' ? 200 : 503;

    res.setHeader('X-Service-Version', buildInfo.version);
    res.setHeader('X-Service-Build-Id', buildInfo.buildId);
    res.setHeader('X-Reco-Engine', config.engine);

    res.status(httpStatus).json({
      status,
      service: 'recommendations-service',
      engine: config.engine,
      timestamp: new Date().toISOString(),
      build: buildInfo,
      checks: {
        database: dbOk ? 'connected' : 'disconnected',
        redis: redisOk ? 'connected' : 'disconnected',
        circuitBreaker: circuitState.state,
      },
    });
  } catch (err) {
    res.status(503).json({
      status: 'unhealthy',
      service: 'recommendations-service',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /health/live
 * Kubernetes liveness probe
 */
router.get('/health/live', (req, res) => {
  res.status(200).json({ status: 'alive' });
});

/**
 * GET /health/ready
 * Kubernetes readiness probe
 */
router.get('/health/ready', async (req, res) => {
  try {
    const dbOk = await checkDb();
    const redisOk = isRedisReady();

    if (dbOk && redisOk) {
      res.status(200).json({ status: 'ready' });
    } else {
      res.status(503).json({
        status: 'not ready',
        database: dbOk,
        redis: redisOk,
      });
    }
  } catch (err) {
    res.status(503).json({ status: 'not ready' });
  }
});

/**
 * GET /metrics
 * Prometheus metrics endpoint
 */
router.get('/metrics', async (req, res) => {
  try {
    const metrics = await getMetrics();
    res.set('Content-Type', getContentType());
    res.end(metrics);
  } catch (err) {
    res.status(500).end();
  }
});

module.exports = router;
