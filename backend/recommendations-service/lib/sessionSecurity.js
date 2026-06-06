/**
 * Session Security - HMAC защита sessionId
 * Предотвращает угадывание/брутфорс чужих сессий
 * @module lib/sessionSecurity
 */

const crypto = require('node:crypto');
const config = require('../config');

// Секретный ключ для HMAC (должен быть в env!)
const SESSION_SECRET = process.env.RECO_SESSION_SECRET;

if (config.isProduction && (!SESSION_SECRET || typeof SESSION_SECRET !== 'string' || SESSION_SECRET.length < 32)) {
  throw new Error('RECO_SESSION_SECRET must be set in production and be at least 32 characters');
}

const EFFECTIVE_SESSION_SECRET = SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// Длина случайной части
const RANDOM_BYTES_LENGTH = 16;

// HMAC алгоритм
const HMAC_ALGORITHM = 'sha256';

// Разделитель между частями sessionId
const SEPARATOR = '.';

/**
 * Генерирует безопасный sessionId для пользователя
 * Формат: {userId}.{randomPart}.{hmac}
 * 
 * @param {number} userId - ID пользователя
 * @returns {string} - Безопасный sessionId
 * 
 * @example
 * const sessionId = generateSecureSessionId(123);
 * // "123.a1b2c3d4e5f6g7h8.hmac_signature"
 */
function generateSecureSessionId(userId) {
  if (!userId || typeof userId !== 'number' || userId <= 0) {
    throw new Error('Invalid userId for session generation');
  }

  // Генерируем случайную часть
  const randomPart = crypto.randomBytes(RANDOM_BYTES_LENGTH).toString('hex');

  // Создаём данные для подписи
  const dataToSign = `${userId}${SEPARATOR}${randomPart}`;

  // Вычисляем HMAC
  const hmac = crypto
    .createHmac(HMAC_ALGORITHM, EFFECTIVE_SESSION_SECRET)
    .update(dataToSign)
    .digest('hex');

  // Формируем финальный sessionId
  return `${userId}${SEPARATOR}${randomPart}${SEPARATOR}${hmac}`;
}

/**
 * Проверяет, является ли sessionId legacy форматом (UUID без HMAC)
 * @param {string} sessionId
 * @returns {boolean}
 */
function isLegacySessionId(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return false;
  // Legacy UUID формат: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  return uuidPattern.test(sessionId);
}

/**
 * Валидирует sessionId и извлекает userId
 * Поддерживает как новый HMAC формат, так и legacy UUID формат
 * 
 * @param {string} sessionId - SessionId для валидации
 * @param {number} [expectedUserId] - Ожидаемый userId для legacy сессий
 * @returns {{ valid: boolean, userId: number | null, error?: string, isLegacy?: boolean }}
 * 
 * @example
 * const result = validateSecureSessionId("123.abc123.hmac");
 * if (result.valid) {
 *   console.log('User:', result.userId);
 * }
 */
function validateSecureSessionId(sessionId, expectedUserId = null) {
  if (!sessionId || typeof sessionId !== 'string') {
    return { valid: false, userId: null, error: 'INVALID_FORMAT' };
  }

  // Поддержка legacy UUID формата (backwards compatibility)
  if (isLegacySessionId(sessionId)) {
    // Для legacy сессий требуем expectedUserId
    if (expectedUserId && Number.isFinite(expectedUserId) && expectedUserId > 0) {
      return { valid: true, userId: expectedUserId, isLegacy: true };
    }
    // Без expectedUserId не можем валидировать legacy сессию
    return { valid: false, userId: null, error: 'LEGACY_SESSION_NO_USER', isLegacy: true };
  }

  const parts = sessionId.split(SEPARATOR);

  // Должно быть 3 части: userId, randomPart, hmac
  if (parts.length !== 3) {
    return { valid: false, userId: null, error: 'INVALID_STRUCTURE' };
  }

  const [userIdStr, randomPart, providedHmac] = parts;

  // Парсим userId
  const userId = Number.parseInt(userIdStr, 10);
  if (Number.isNaN(userId) || userId <= 0) {
    return { valid: false, userId: null, error: 'INVALID_USER_ID' };
  }

  // Проверяем длину randomPart
  if (randomPart.length !== RANDOM_BYTES_LENGTH * 2) {
    return { valid: false, userId: null, error: 'INVALID_RANDOM_PART' };
  }

  // Вычисляем ожидаемый HMAC
  const dataToSign = `${userId}${SEPARATOR}${randomPart}`;
  const expectedHmac = crypto
    .createHmac(HMAC_ALGORITHM, EFFECTIVE_SESSION_SECRET)
    .update(dataToSign)
    .digest('hex');

  // Сравниваем HMAC (timing-safe comparison)
  const providedBuffer = Buffer.from(providedHmac, 'hex');
  const expectedBuffer = Buffer.from(expectedHmac, 'hex');

  if (providedBuffer.length !== expectedBuffer.length) {
    return { valid: false, userId: null, error: 'INVALID_HMAC' };
  }

  const isValid = crypto.timingSafeEqual(providedBuffer, expectedBuffer);

  if (!isValid) {
    return { valid: false, userId: null, error: 'HMAC_MISMATCH' };
  }

  return { valid: true, userId };
}

/**
 * Извлекает userId из sessionId без полной валидации
 * Используется для логирования (без проверки HMAC)
 * 
 * @param {string} sessionId
 * @returns {number | null}
 */
function extractUserIdFromSession(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') {
    return null;
  }

  const parts = sessionId.split(SEPARATOR);
  if (parts.length < 1) {
    return null;
  }

  const userId = Number.parseInt(parts[0], 10);
  return Number.isNaN(userId) ? null : userId;
}

/**
 * Проверяет, принадлежит ли sessionId указанному пользователю
 * 
 * @param {string} sessionId
 * @param {number} userId
 * @returns {boolean}
 */
function sessionBelongsToUser(sessionId, userId) {
  const result = validateSecureSessionId(sessionId);
  return result.valid && result.userId === userId;
}

module.exports = {
  generateSecureSessionId,
  validateSecureSessionId,
  extractUserIdFromSession,
  sessionBelongsToUser,
  isLegacySessionId,
};
