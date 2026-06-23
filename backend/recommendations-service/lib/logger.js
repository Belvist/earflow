/**
 * Структурированное логирование на базе Pino
 * Единая точка входа для всего логирования в сервисе
 * @module lib/logger
 */

const pino = require('pino');
const config = require('../config');

function sanitizeUrlForLogs(rawUrl) {
  try {
    const url = new URL(rawUrl, 'http://localhost');
    for (const key of [...url.searchParams.keys()]) {
      const lower = key.toLowerCase();
      if (lower === 'token' || lower.includes('token') || lower.includes('authorization') || lower.includes('password') || lower.includes('secret')) {
        url.searchParams.set(key, '[REDACTED]');
      }
    }
    return url.pathname + (url.search ? url.search : '');
  } catch {
    return String(rawUrl || '').replace(/([?&]token=)[^&]+/gi, '$1[REDACTED]');
  }
}

/**
 * Базовые опции логгера
 */
const baseOptions = {
  level: config.logging.level,
  name: 'recommendations-service',
  base: {
    pid: process.pid,
    env: config.env,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  redact: {
    paths: ['req.headers.authorization', 'password', 'token', '*.password', '*.token'],
    censor: '[REDACTED]',
  },
};

/**
 * Создание транспорта в зависимости от окружения
 */
function createTransport() {
  if (config.logging.prettyPrint) {
    return pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
        singleLine: false,
      },
    });
  }
  return undefined;
}

/**
 * Основной логгер
 */
const logger = pino(baseOptions, createTransport());

/**
 * Создаёт дочерний логгер с дополнительным контекстом
 * @param {string} component - Название компонента
 * @param {object} [bindings] - Дополнительные поля
 * @returns {pino.Logger}
 */
function createLogger(component, bindings = {}) {
  return logger.child({ component, ...bindings });
}

/**
 * Логгер для HTTP запросов
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {number} responseTime - Время ответа в мс
 */
function logRequest(req, res, responseTime) {
  const logData = {
    method: req.method,
    url: sanitizeUrlForLogs(req.originalUrl || req.url),
    statusCode: res.statusCode,
    responseTime,
    userAgent: req.headers['user-agent'],
    ip: req.ip || req.connection?.remoteAddress,
    userId: req.user?.id,
    correlationId: req.headers['x-correlation-id'],
  };

  if (res.statusCode >= 500) {
    logger.error(logData, 'HTTP request error');
  } else if (res.statusCode >= 400) {
    logger.warn(logData, 'HTTP request client error');
  } else {
    logger.info(logData, 'HTTP request completed');
  }
}

/**
 * Логгер для ошибок с полным стектрейсом
 * @param {Error} err - Объект ошибки
 * @param {string} [context] - Контекст ошибки
 * @param {object} [extra] - Дополнительные данные
 */
function logError(err, context = 'unknown', extra = {}) {
  logger.error(
    {
      err: {
        type: err.constructor?.name || 'Error',
        message: err.message,
        stack: err.stack,
        code: err.code,
        ...extra,
      },
      context,
    },
    `Error in ${context}: ${err.message}`
  );
}

/**
 * Логгер для событий бизнес-логики
 * @param {string} event - Название события
 * @param {object} data - Данные события
 */
function logEvent(event, data = {}) {
  logger.info({ event, ...data }, `Event: ${event}`);
}

/**
 * Логгер для метрик производительности
 * @param {string} operation - Название операции
 * @param {number} durationMs - Длительность в мс
 * @param {object} [metadata] - Дополнительные метаданные
 */
function logPerformance(operation, durationMs, metadata = {}) {
  // Не логируем blocking operations как warnings
  // Они ожидаемо занимают много времени (BLOCK в Redis)
  const isBlockingOperation = operation.includes('xreadgroup') ||
    operation.includes('blocking') ||
    metadata.blocking === true;

  // Для blocking operations: warn только если > 60 секунд (аномалия)
  // Для обычных operations: warn если > 1 секунды
  const warnThreshold = isBlockingOperation ? 60000 : 1000;

  // Для blocking operations с нормальным временем - не логируем вообще
  // чтобы не спамить логи
  if (isBlockingOperation && durationMs < warnThreshold) {
    return; // Не логируем нормальное blocking поведение
  }

  const level = durationMs > warnThreshold ? 'warn' : 'debug';
  logger[level](
    {
      operation,
      durationMs,
      ...metadata,
    },
    `Performance: ${operation} took ${durationMs}ms`
  );
}

/**
 * Middleware для Express логирования
 * @returns {Function} Express middleware
 */
function requestLogger() {
  return (req, res, next) => {
    const startTime = Date.now();

    // Добавляем correlation ID
    req.correlationId = req.headers['x-correlation-id'] || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    res.setHeader('X-Correlation-ID', req.correlationId);

    res.on('finish', () => {
      const responseTime = Date.now() - startTime;
      logRequest(req, res, responseTime);
    });

    next();
  };
}

module.exports = {
  logger,
  createLogger,
  logRequest,
  logError,
  logEvent,
  logPerformance,
  requestLogger,
};
