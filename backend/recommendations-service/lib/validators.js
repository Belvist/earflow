/**
 * Централизованные валидаторы для recommendations-service
 * @module lib/validators
 */

const config = require('../config');

/**
 * Ошибка валидации с HTTP статусом
 */
class ValidationError extends Error {
  /**
   * @param {string} message
   * @param {string} [field]
   */
  constructor(message, field = null) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
    this.field = field;
  }

}

function isAllowedTokenCharCode(code) {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95 ||
    code === 58 ||
    code === 46 ||
    code === 45
  );
}

function assertSafeToken(value, fieldName, { allowEmpty = false } = {}) {
  if (value == null) {
    throw new ValidationError(`${fieldName} is required`, fieldName);
  }
  if (typeof value !== 'string') {
    throw new ValidationError(`${fieldName} must be a string`, fieldName);
  }

  const trimmed = value.trim();
  if (!allowEmpty && trimmed.length === 0) {
    throw new ValidationError(`${fieldName} is required`, fieldName);
  }

  for (let i = 0; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i);
    if (!isAllowedTokenCharCode(code)) {
      throw new ValidationError(`${fieldName} has invalid format`, fieldName);
    }
  }

  return trimmed;
}

/**
 * Парсит и валидирует положительное целое число
 * @param {any} value
 * @param {string} fieldName
 * @param {object} [options]
 * @param {number} [options.min]
 * @param {number} [options.max]
 * @param {boolean} [options.required]
 * @returns {number|null}
 */
function toPositiveInt(value, fieldName, options = {}) {
  const { min = 1, max = Number.MAX_SAFE_INTEGER, required = false } = options;

  if (value === undefined || value === null || value === '') {
    if (required) {
      throw new ValidationError(`${fieldName} is required`, fieldName);
    }
    return null;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new ValidationError(
      `${fieldName} must be an integer between ${min} and ${max}`,
      fieldName
    );
  }

  return parsed;
}

/**
 * Валидирует строку
 * @param {any} value
 * @param {string} fieldName
 * @param {object} [options]
 * @param {number} [options.minLength]
 * @param {number} [options.maxLength]
 * @param {RegExp} [options.pattern]
 * @param {boolean} [options.required]
 * @returns {string|null}
 */
function toString(value, fieldName, options = {}) {
  const { minLength = 0, maxLength = 1000, pattern, required = false } = options;

  if (value === undefined || value === null || value === '') {
    if (required) {
      throw new ValidationError(`${fieldName} is required`, fieldName);
    }
    return null;
  }

  if (typeof value !== 'string') {
    throw new ValidationError(`${fieldName} must be a string`, fieldName);
  }

  const trimmed = value.trim();

  if (trimmed.length < minLength || trimmed.length > maxLength) {
    throw new ValidationError(
      `${fieldName} must be between ${minLength} and ${maxLength} characters`,
      fieldName
    );
  }

  if (pattern && !pattern.test(trimmed)) {
    throw new ValidationError(`${fieldName} has invalid format`, fieldName);
  }

  return trimmed;
}

/**
 * Валидирует массив
 * @param {any} value
 * @param {string} fieldName
 * @param {object} [options]
 * @param {number} [options.maxLength]
 * @param {boolean} [options.required]
 * @returns {any[]|null}
 */
function toArray(value, fieldName, options = {}) {
  const { maxLength = 1000, required = false } = options;

  if (value === undefined || value === null) {
    if (required) {
      throw new ValidationError(`${fieldName} is required`, fieldName);
    }
    return null;
  }

  if (!Array.isArray(value)) {
    throw new ValidationError(`${fieldName} must be an array`, fieldName);
  }

  if (value.length > maxLength) {
    throw new ValidationError(
      `${fieldName} must have at most ${maxLength} elements`,
      fieldName
    );
  }

  return value;
}

/**
 * Валидирует action для feedback
 * @param {any} value
 * @returns {string}
 */
function validateAction(value) {
  const action = toString(value, 'action', { required: true });

  if (!action) {
    throw new ValidationError('action is required', 'action');
  }

  const normalized = action.toLowerCase();

  if (!config.feedback.allowedActions.includes(normalized)) {
    throw new ValidationError(
      `action must be one of: ${config.feedback.allowedActions.join(', ')}`,
      'action'
    );
  }

  return normalized;
}

/**
 * Валидирует duration (мс)
 * @param {any} value
 * @returns {number}
 */
function validateDurationMs(value) {
  if (value === undefined || value === null) {
    return 0;
  }

  const duration = Number.parseInt(value, 10);

  if (!Number.isFinite(duration) || duration < 0) {
    return 0;
  }

  return Math.min(duration, config.feedback.maxDurationMs);
}

/**
 * Валидирует progress (0-1)
 * @param {any} value
 * @returns {number|null}
 */
function validateProgress(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const progress = Number.parseFloat(value);

  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    return null;
  }

  return Math.round(progress * 1000) / 1000; // 3 decimal places
}

function validateOptionalToken(value, fieldName, { maxLength = 200 } = {}) {
  const raw = toString(value, fieldName, { maxLength });
  if (!raw) return null;
  return assertSafeToken(raw, fieldName);
}

function validateEventTime(value) {
  if (value === undefined || value === null || value === '') {
    return Date.now();
  }

  let ms;
  if (typeof value === 'number') {
    ms = value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) return Date.now();
    const asInt = Number.parseInt(trimmed, 10);
    if (Number.isFinite(asInt) && String(asInt) === trimmed) {
      ms = asInt;
    } else {
      ms = Date.parse(trimmed);
    }
  } else {
    return Date.now();
  }

  if (!Number.isFinite(ms)) {
    return Date.now();
  }

  const now = Date.now();
  const min = now - 30 * 24 * 60 * 60 * 1000;
  const max = now + 5 * 60 * 1000;
  if (ms < min || ms > max) {
    return now;
  }

  return Math.floor(ms);
}

function validateSchemaVersion(value) {
  const v = toPositiveInt(value, 'schemaVersion', { min: 1, max: 100 });
  return v || 1;
}

function validateContext(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch {
    return null;
  }

  if (typeof encoded !== 'string' || encoded.length > 2000) {
    return null;
  }

  return value;
}

/**
 * Валидирует payload для /init endpoint
 * @param {number} authUserId - ID пользователя из токена
 * @param {object} body - Request body
 * @returns {object}
 */
function validateInitPayload(authUserId, body) {
  const userId = toPositiveInt(body.userId, 'userId');

  // Если userId передан, он должен совпадать с authUserId
  if (userId !== null && userId !== authUserId) {
    throw new ValidationError('userId mismatch with authenticated user', 'userId');
  }

  const finalUserId = userId || authUserId;

  if (!finalUserId || finalUserId <= 0) {
    throw new ValidationError('Valid userId is required', 'userId');
  }

  // Preferences - опциональный объект
  let preferences = null;
  if (body.preferences && typeof body.preferences === 'object') {
    preferences = {
      genres: toArray(body.preferences.genres, 'preferences.genres'),
      artists: toArray(body.preferences.artists, 'preferences.artists'),
    };
  }

  // forceNew - при true создаёт новую сессию без excludeIds
  const forceNew = body.forceNew === true;

  const limit = toPositiveInt(body.limit, 'limit', {
    min: 1,
    max: config.recommendations.maxBatchSize,
  });

  const excludeIdsRaw = toArray(body.excludeIds, 'excludeIds', {
    maxLength: config.recommendations.maxRequestExcludeIds,
  }) || [];

  const excludeIds = excludeIdsRaw
    .map((id) => Number.parseInt(id, 10))
    .filter((id) => Number.isFinite(id) && id > 0);

  return { userId: finalUserId, preferences, forceNew, limit, excludeIds };
}

/**
 * Валидирует payload для /next endpoint
 * @param {number} authUserId
 * @param {object} body
 * @returns {object}
 */
function validateNextPayload(authUserId, body) {
  const userId = toPositiveInt(body.userId, 'userId');

  if (userId !== null && userId !== authUserId) {
    throw new ValidationError('userId mismatch with authenticated user', 'userId');
  }

  const finalUserId = userId || authUserId;

  const sessionId = assertSafeToken(toString(body.sessionId, 'sessionId', {
    required: true,
    minLength: 1,
    maxLength: 200,
  }), 'sessionId');

  const count = toPositiveInt(body.count, 'count', {
    min: 1,
    max: config.recommendations.maxBatchSize,
  }) || config.recommendations.defaultBatchSize;

  const excludeIdsRaw = toArray(body.excludeIds, 'excludeIds', {
    maxLength: config.recommendations.maxRequestExcludeIds,
  }) || [];

  const excludeIds = excludeIdsRaw
    .map((id) => Number.parseInt(id, 10))
    .filter((id) => Number.isFinite(id) && id > 0);

  return { userId: finalUserId, sessionId, count, excludeIds };
}

/**
 * Валидирует payload для /infinite endpoint
 * @param {number} authUserId
 * @param {object} body
 * @returns {object}
 */
function validateInfinitePayload(authUserId, body) {
  const userId = toPositiveInt(body.userId, 'userId');

  if (userId !== null && userId !== authUserId) {
    throw new ValidationError('userId mismatch with authenticated user', 'userId');
  }

  const finalUserId = userId || authUserId;

  const sessionIdRaw = toString(body.sessionId, 'sessionId', {
    minLength: 1,
    maxLength: 200,
  });
  const sessionId = sessionIdRaw ? assertSafeToken(sessionIdRaw, 'sessionId') : null;

  const offset = toPositiveInt(body.offset, 'offset', { min: 0 }) || 0;

  const limit = toPositiveInt(body.limit, 'limit', {
    min: 1,
    max: config.recommendations.maxBatchSize,
  }) || config.recommendations.defaultBatchSize;

  const excludeIdsRaw = toArray(body.excludeIds, 'excludeIds', {
    maxLength: config.recommendations.maxRequestExcludeIds,
  }) || [];

  const excludeIds = excludeIdsRaw
    .map((id) => Number.parseInt(id, 10))
    .filter((id) => Number.isFinite(id) && id > 0);

  return { userId: finalUserId, sessionId, offset, limit, excludeIds };
}

/**
 * Валидирует payload для /feedback (single) endpoint
 * @param {number} authUserId
 * @param {object} body
 * @returns {object}
 */
function validateFeedbackPayload(authUserId, body) {
  const userId = toPositiveInt(body.userId, 'userId');

  if (userId !== null && userId !== authUserId) {
    throw new ValidationError('userId mismatch with authenticated user', 'userId');
  }

  const finalUserId = userId || authUserId;

  const sessionIdRaw = toString(body.sessionId, 'sessionId', {
    maxLength: 200,
  });
  const sessionId = sessionIdRaw ? assertSafeToken(sessionIdRaw, 'sessionId') : null;

  const trackId = toPositiveInt(body.trackId, 'trackId', { required: true });
  const action = validateAction(body.action);
  const duration = validateDurationMs(body.duration);
  const progress = validateProgress(body.progress);

  const eventId = validateOptionalToken(body.eventId, 'eventId', { maxLength: 200 });
  const playbackSessionId = validateOptionalToken(body.playbackSessionId, 'playbackSessionId', { maxLength: 200 });
  const schemaVersion = validateSchemaVersion(body.schemaVersion);
  const eventTime = validateEventTime(body.eventTime);
  const context = validateContext(body.context);

  return { userId: finalUserId, sessionId, trackId, action, duration, progress, eventId, playbackSessionId, schemaVersion, eventTime, context };
}

/**
 * Валидирует payload для /batch-complete endpoint
 * @param {number} authUserId
 * @param {object} body
 * @returns {object}
 */
function validateBatchFeedbackPayload(authUserId, body) {
  const userId = toPositiveInt(body.userId, 'userId');

  if (userId !== null && userId !== authUserId) {
    throw new ValidationError('userId mismatch with authenticated user', 'userId');
  }

  const finalUserId = userId || authUserId;

  const sessionIdRaw = toString(body.sessionId, 'sessionId', {
    maxLength: 200,
  });
  const sessionId = sessionIdRaw ? assertSafeToken(sessionIdRaw, 'sessionId') : null;

  const batchIdRaw = toString(body.batchId, 'batchId', {
    maxLength: 100,
  });
  const batchId = batchIdRaw ? assertSafeToken(batchIdRaw, 'batchId', { allowEmpty: true }) : null;

  const interactionsRaw = toArray(body.interactions, 'interactions', {
    required: true,
    maxLength: config.feedback.maxInteractionsPerBatch,
  });

  if (!interactionsRaw || interactionsRaw.length === 0) {
    throw new ValidationError('interactions array cannot be empty', 'interactions');
  }

  const interactions = interactionsRaw.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new ValidationError(`interactions[${index}] must be an object`, `interactions[${index}]`);
    }

    const trackId = toPositiveInt(item.trackId, `interactions[${index}].trackId`, { required: true });
    const action = validateAction(item.action);
    const duration = validateDurationMs(item.duration);
    const progress = validateProgress(item.progress);

    const eventId = validateOptionalToken(item.eventId, `interactions[${index}].eventId`, { maxLength: 200 });
    const playbackSessionId = validateOptionalToken(item.playbackSessionId, `interactions[${index}].playbackSessionId`, { maxLength: 200 });
    const schemaVersion = validateSchemaVersion(item.schemaVersion);
    const eventTime = validateEventTime(item.eventTime);
    const context = validateContext(item.context);

    return { trackId, action, duration, progress, eventId, playbackSessionId, schemaVersion, eventTime, context };
  });

  return { userId: finalUserId, sessionId, batchId, interactions };
}

function isAllowedGenreCharCode(code) {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 32 ||
    code === 95 ||
    code === 45 ||
    code === 46 ||
    code === 38 ||
    code === 39 ||
    code === 40 ||
    code === 41 ||
    code === 47 ||
    code === 44
  );
}

function sanitizeGenre(value) {
  const raw = toString(value, 'genre', { required: true, maxLength: 100 });
  if (!raw) {
    throw new ValidationError('genre is required', 'genre');
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new ValidationError('genre is required', 'genre');
  }

  let out = '';
  for (let i = 0; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i);
    if (isAllowedGenreCharCode(code)) {
      out += trimmed[i];
    } else {
      throw new ValidationError('genre has invalid format', 'genre');
    }
  }

  return out.toLowerCase();
}

function validatePlaybackRate(value) {
  const rate = Number.parseFloat(value);
  if (!Number.isFinite(rate)) {
    throw new ValidationError('playbackRate must be a number', 'playbackRate');
  }
  if (rate < 0.5 || rate > 2.0) {
    throw new ValidationError('playbackRate out of range', 'playbackRate');
  }
  return rate;
}

function validatePlaybackRatePreferencePayload(authUserId, body) {
  const userId = toPositiveInt(body.userId, 'userId');
  if (userId !== null && userId !== authUserId) {
    throw new ValidationError('userId mismatch with authenticated user', 'userId');
  }

  const finalUserId = userId || authUserId;
  const genre = sanitizeGenre(body.genre);
  const playbackRate = validatePlaybackRate(body.playbackRate);

  return { userId: finalUserId, genre, playbackRate };
}

/**
 * Санитизирует userId для использования в Redis ключах
 * @param {any} userId
 * @returns {number}
 */
function sanitizeUserId(userId) {
  const parsed = Number.parseInt(userId, 10);

  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > Number.MAX_SAFE_INTEGER) {
    throw new ValidationError('Invalid userId for Redis key', 'userId');
  }

  return parsed;
}

/**
 * Санитизирует sessionId для использования в Redis ключах
 * @param {any} sessionId
 * @returns {string}
 */
function sanitizeSessionId(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') {
    throw new ValidationError('Invalid sessionId', 'sessionId');
  }

  const trimmed = sessionId.trim();
  let out = '';
  for (let i = 0; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i);
    if (isAllowedTokenCharCode(code)) {
      out += trimmed[i];
    }
  }

  if (out.length === 0 || out.length > 200) {
    throw new ValidationError('Invalid sessionId format', 'sessionId');
  }

  return out;
}

module.exports = {
  ValidationError,
  toPositiveInt,
  toString,
  toArray,
  validateAction,
  validateDurationMs,
  validateProgress,
  validateInitPayload,
  validateNextPayload,
  validateInfinitePayload,
  validateFeedbackPayload,
  validateBatchFeedbackPayload,
  validatePlaybackRatePreferencePayload,
  sanitizeUserId,
  sanitizeSessionId,
};
