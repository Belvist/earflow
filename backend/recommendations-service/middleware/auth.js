/**
 * Authentication Middleware
 * Circuit breaker защита + LRU кэширование токенов
 * @module middleware/auth
 */

const axios = require('axios');
const CircuitBreaker = require('opossum');
const { LRUCache } = require('lru-cache');
const config = require('../config');
const { createLogger, logError, logEvent } = require('../lib/logger');

const logger = createLogger('auth-middleware');

// ============================================
// Token Cache (LRU)
// ============================================

const tokenCache = new LRUCache({
  max: 10000,                    // Максимум 10k токенов
  ttl: 5 * 60 * 1000,            // TTL 5 минут
  updateAgeOnGet: true,
});

// ============================================
// Auth Service Call
// ============================================

/**
 * Вызов auth-service для верификации токена
 * @param {string} token
 * @returns {Promise<{valid: boolean, user?: {id: number}}>}
 */
async function verifyTokenCall(token) {
  const response = await axios.post(
    `${config.auth.serviceUrl}/api/verify`,
    { token },
    { timeout: config.auth.timeoutMs }
  );

  if (!response.data || !response.data.valid || !response.data.user) {
    throw new Error('INVALID_TOKEN');
  }

  const user = response.data.user;
  const userId = user.id || user.userId;

  if (!userId) {
    throw new Error('INVALID_USER');
  }

  return { valid: true, userId };
}

// ============================================
// Circuit Breaker Configuration
// ============================================

const authCircuitBreaker = new CircuitBreaker(verifyTokenCall, {
  timeout: config.auth.timeoutMs,              // Timeout per request
  errorThresholdPercentage: 50,                // Open if 50% errors
  resetTimeout: 30000,                         // Try again after 30s
  volumeThreshold: 10,                         // Min calls before tripping
  rollingCountTimeout: 10000,                  // Rolling window 10s
  rollingCountBuckets: 10,                     // 10 buckets
  name: 'auth-service',
  errorFilter: (err) => {
    // Не считаем ошибки авторизации как сбой сервиса
    return err.message === 'INVALID_TOKEN' || err.message === 'INVALID_USER';
  },
});

// Event listeners для мониторинга
authCircuitBreaker.on('open', () => {
  logEvent('auth-circuit-open', { state: 'open' });
  logger.warn('Auth service circuit breaker OPENED');
});

authCircuitBreaker.on('halfOpen', () => {
  logEvent('auth-circuit-half-open', { state: 'half-open' });
  logger.info('Auth service circuit breaker HALF-OPEN');
});

authCircuitBreaker.on('close', () => {
  logEvent('auth-circuit-close', { state: 'closed' });
  logger.info('Auth service circuit breaker CLOSED');
});

authCircuitBreaker.on('fallback', () => {
  logger.debug('Auth service fallback triggered');
});

// ============================================
// Middleware
// ============================================

/**
 * Middleware для аутентификации с circuit breaker и кэшированием
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function authenticateUser(req, res, next) {
  try {
    let token = req.headers.authorization;

    if (token && token.startsWith('Bearer ')) {
      token = token.substring('Bearer '.length);
    }

    if (!token) {
      return res.status(401).json({ error: 'Authorization token is required' });
    }

    // Проверяем кэш
    const cachedResult = tokenCache.get(token);
    if (cachedResult) {
      req.user = { id: cachedResult.userId };
      return next();
    }

    // Вызываем auth-service через circuit breaker
    const result = await authCircuitBreaker.fire(token);

    // Кэшируем успешный результат
    tokenCache.set(token, result);

    req.user = { id: result.userId };
    next();
  } catch (err) {
    // Ошибки валидации токена
    if (err.message === 'INVALID_TOKEN' || err.message === 'INVALID_USER') {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // HTTP 401/403 от auth-service
    if (err.response && (err.response.status === 401 || err.response.status === 403)) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Circuit breaker открыт
    if (err.code === 'EOPENBREAKER') {
      logger.warn('Auth circuit breaker open, rejecting request');
      return res.status(503).json({
        error: 'Authentication service temporarily unavailable',
        retryAfter: 30,
      });
    }

    // Timeout
    if (err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED') {
      logError(err, 'auth-timeout');
      return res.status(503).json({
        error: 'Authentication service timeout',
        retryAfter: 5,
      });
    }

    // Другие ошибки
    logError(err, 'auth-verify');
    return res.status(500).json({ error: 'Authentication service error' });
  }
}

/**
 * Получает состояние circuit breaker
 * @returns {object}
 */
function getAuthCircuitState() {
  const stats = authCircuitBreaker.stats;
  return {
    state: authCircuitBreaker.opened ? 'open' : (authCircuitBreaker.halfOpen ? 'half-open' : 'closed'),
    failures: stats.failures,
    successes: stats.successes,
    rejects: stats.rejects,
    fallbacks: stats.fallbacks,
    timeouts: stats.timeouts,
    cacheSize: tokenCache.size,
  };
}

/**
 * Очищает кэш токенов (для тестирования)
 */
function clearTokenCache() {
  tokenCache.clear();
}

module.exports = {
  authenticateUser,
  getAuthCircuitState,
  clearTokenCache,
};
