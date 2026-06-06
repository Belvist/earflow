/**
 * Worker Health Check Server
 * HTTP сервер для мониторинга состояния воркеров
 * @module lib/workerHealth
 */

const http = require('node:http');
const { createLogger } = require('./logger');

const logger = createLogger('worker-health');

/**
 * @typedef {Object} WorkerStatus
 * @property {string} status - 'healthy' | 'degraded' | 'unhealthy'
 * @property {string} workerId - ID воркера
 * @property {number} uptime - Время работы в секундах
 * @property {number} lastActivityAt - Timestamp последней активности
 * @property {Object} metrics - Дополнительные метрики
 */

/**
 * Создаёт HTTP сервер для health check воркера
 * @param {Object} options
 * @param {number} options.port - Порт для HTTP сервера
 * @param {string} options.workerId - ID воркера
 * @param {function(): WorkerStatus} options.getStatus - Функция получения статуса
 * @returns {{ server: http.Server, updateActivity: function, updateMetrics: function }}
 */
function createHealthServer(options) {
  const { port, workerId, getStatus } = options;
  const startTime = Date.now();

  // Состояние воркера
  let lastActivityAt = Date.now();
  let customMetrics = {};

  /**
   * Обновляет timestamp последней активности
   */
  function updateActivity() {
    lastActivityAt = Date.now();
  }

  /**
   * Обновляет кастомные метрики
   * @param {Object} metrics
   */
  function updateMetrics(metrics) {
    customMetrics = { ...customMetrics, ...metrics };
  }

  /**
   * Определяет статус воркера
   * @returns {string}
   */
  function determineStatus() {
    const inactivityMs = Date.now() - lastActivityAt;
    const MAX_INACTIVITY_MS = 5 * 60 * 1000; // 5 минут

    if (inactivityMs > MAX_INACTIVITY_MS) {
      return 'unhealthy';
    }
    if (inactivityMs > MAX_INACTIVITY_MS / 2) {
      return 'degraded';
    }
    return 'healthy';
  }

  /**
   * Получает полный статус
   * @returns {WorkerStatus}
   */
  function getFullStatus() {
    const customStatus = typeof getStatus === 'function' ? getStatus() : {};

    return {
      status: determineStatus(),
      workerId,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      startedAt: new Date(startTime).toISOString(),
      lastActivityAt: new Date(lastActivityAt).toISOString(),
      inactivitySeconds: Math.floor((Date.now() - lastActivityAt) / 1000),
      metrics: customMetrics,
      ...customStatus,
    };
  }

  // HTTP сервер
  const server = http.createServer((req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    if (req.url === '/health' || req.url === '/health/live') {
      const status = getFullStatus();
      const httpStatus = status.status === 'healthy' ? 200 : (status.status === 'degraded' ? 200 : 503);

      res.writeHead(httpStatus);
      res.end(JSON.stringify(status));
      return;
    }

    if (req.url === '/health/ready') {
      const status = getFullStatus();
      const isReady = status.status !== 'unhealthy';

      res.writeHead(isReady ? 200 : 503);
      res.end(JSON.stringify({
        ready: isReady,
        status: status.status,
      }));
      return;
    }

    if (req.url === '/metrics') {
      const status = getFullStatus();

      // Prometheus-style metrics
      const prometheusMetrics = [
        `# HELP worker_uptime_seconds Worker uptime in seconds`,
        `# TYPE worker_uptime_seconds gauge`,
        `worker_uptime_seconds{worker_id="${workerId}"} ${status.uptime}`,
        `# HELP worker_last_activity_timestamp Last activity timestamp`,
        `# TYPE worker_last_activity_timestamp gauge`,
        `worker_last_activity_timestamp{worker_id="${workerId}"} ${lastActivityAt}`,
        `# HELP worker_healthy Worker health status (1=healthy, 0=unhealthy)`,
        `# TYPE worker_healthy gauge`,
        `worker_healthy{worker_id="${workerId}"} ${status.status === 'healthy' ? 1 : 0}`,
      ];

      // Добавляем кастомные метрики
      for (const [key, value] of Object.entries(customMetrics)) {
        if (typeof value === 'number') {
          prometheusMetrics.push(`worker_${key}{worker_id="${workerId}"} ${value}`);
        }
      }

      res.setHeader('Content-Type', 'text/plain');
      res.writeHead(200);
      res.end(prometheusMetrics.join('\n'));
      return;
    }

    // 404
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.warn({ port }, 'Health check port already in use, skipping');
    } else {
      logger.error({ err, port }, 'Health server error');
    }
  });

  // Запускаем сервер
  server.listen(port, '0.0.0.0', () => {
    logger.info({ port, workerId }, 'Worker health server started');
  });

  return {
    server,
    updateActivity,
    updateMetrics,
    getStatus: getFullStatus,
    close: () => {
      return new Promise((resolve) => {
        server.close(() => {
          logger.info({ port, workerId }, 'Worker health server stopped');
          resolve();
        });
      });
    },
  };
}

module.exports = {
  createHealthServer,
};
