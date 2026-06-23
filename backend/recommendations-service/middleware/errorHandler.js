/**
 * Error Handling Middleware
 * @module middleware/errorHandler
 */

const { ValidationError } = require('../lib/validators');
const { logError, createLogger } = require('../lib/logger');

const logger = createLogger('error-handler');

/**
 * Обработчик 404 ошибок
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    error: 'Not Found',
    path: req.path,
  });
}

/**
 * Централизованный обработчик ошибок
 * @param {Error} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function errorHandler(err, req, res, next) {
  // Если заголовки уже отправлены, делегируем Express
  if (res.headersSent) {
    return next(err);
  }

  // Ошибки валидации
  if (err instanceof ValidationError) {
    return res.status(err.statusCode || 400).json({
      error: err.message,
      field: err.field,
    });
  }

  // Ошибки CORS
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({
      error: 'CORS policy violation',
    });
  }

  // Ошибки circuit breaker
  if (err.code === 'DB_CIRCUIT_OPEN') {
    logError(err, 'circuit-breaker', { path: req.path });
    return res.status(503).json({
      error: 'Service temporarily unavailable',
      retryAfter: 30,
    });
  }

  // Ошибки базы данных
  if (err.code && err.code.startsWith('2') && err.code.length === 5) {
    // PostgreSQL error codes start with class codes
    logError(err, 'database-error', { path: req.path });
    return res.status(500).json({
      error: 'Database error',
    });
  }

  // Ошибки Redis
  if (err.message && err.message.includes('Redis')) {
    logError(err, 'redis-error', { path: req.path });
    return res.status(500).json({
      error: 'Cache service error',
    });
  }

  // Rate limit ошибки
  if (err.status === 429) {
    return res.status(429).json({
      error: 'Too many requests',
      retryAfter: err.retryAfter || 60,
    });
  }

  // Общие ошибки
  logError(err, 'unhandled-error', {
    path: req.path,
    method: req.method,
    userId: req.user?.id,
  });

  // В production не раскрываем детали ошибки
  const isProduction = process.env.NODE_ENV === 'production';

  return res.status(500).json({
    error: isProduction ? 'Internal server error' : err.message,
    ...(isProduction ? {} : { stack: err.stack }),
  });
}

module.exports = {
  notFoundHandler,
  errorHandler,
};
