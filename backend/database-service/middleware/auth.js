const jwt = require('jsonwebtoken');

const SERVICE_JWT_ISSUER = process.env.SERVICE_JWT_ISSUER || 'database-service';
const SERVICE_JWT_AUDIENCE = process.env.SERVICE_JWT_AUDIENCE || 'database-service';

function readPemFromEnv(raw, b64) {
  if (b64) {
    try {
      return Buffer.from(b64, 'base64').toString('utf8');
    } catch {
      return null;
    }
  }
  return raw || null;
}

function getServiceJwtPublicKey() {
  return readPemFromEnv(process.env.SERVICE_JWT_PUBLIC_KEY, process.env.SERVICE_JWT_PUBLIC_KEY_B64);
}

function getServiceJwtPrivateKey() {
  return readPemFromEnv(process.env.SERVICE_JWT_PRIVATE_KEY, process.env.SERVICE_JWT_PRIVATE_KEY_B64);
}

const DEFAULT_ALLOWED_SERVICES = [
  'auth-service',
  'upload-service',
  'api-gateway',
  'artist-api-gateway',
  'ebap-hls-adapter',
  'track-processor',
  'recommendations-service',
  'audio-features-worker',
];

const ALLOWED_SERVICES = (() => {
  const raw = process.env.ALLOWED_SERVICES;
  const fromEnv = raw
    ? raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    : [];

  const merged = new Set(DEFAULT_ALLOWED_SERVICES);
  for (const name of fromEnv) {
    merged.add(name);
  }
  return Array.from(merged);
})();

/**
 * Middleware для проверки токена сервиса
 */
function authenticateService(req, res, next) {
  try {
    const token = req.headers['x-service-token'];

    if (!token) {
      return res.status(401).json({
        error: 'Отсутствует токен аутентификации',
        code: 'NO_TOKEN'
      });
    }

    const publicKey = getServiceJwtPublicKey();
    if (!publicKey) {
      return res.status(500).json({
        error: 'Service auth misconfigured',
        code: 'SERVICE_AUTH_MISCONFIGURED'
      });
    }

    const decoded = jwt.verify(token, publicKey, {
      algorithms: ['RS256'],
      issuer: SERVICE_JWT_ISSUER,
      audience: SERVICE_JWT_AUDIENCE,
    });

    if (!decoded || decoded.type !== 'service') {
      return res.status(401).json({
        error: 'Недействительный токен',
        code: 'INVALID_TOKEN'
      });
    }

    // Проверяем, что сервис в списке разрешенных
    if (!ALLOWED_SERVICES.includes(decoded.serviceName)) {
      return res.status(403).json({
        error: 'Сервис не авторизован',
        code: 'SERVICE_NOT_AUTHORIZED'
      });
    }

    // Добавляем информацию о сервисе в запрос
    req.service = {
      name: decoded.serviceName,
      tokenId: decoded.tokenId
    };

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'Недействительный токен',
        code: 'INVALID_TOKEN'
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Токен истек',
        code: 'TOKEN_EXPIRED'
      });
    }
    console.error('❌ Ошибка аутентификации сервиса:', error);
    res.status(500).json({
      error: 'Ошибка аутентификации',
      code: 'AUTH_ERROR'
    });
  }
}

/**
 * Генерация токена для сервиса
 */
function generateServiceToken(serviceName, tokenId, audience = null) {
  const privateKey = getServiceJwtPrivateKey();
  if (!privateKey) {
    console.error('FATAL: SERVICE_JWT_PRIVATE_KEY(_B64) must be set to issue service tokens');
    process.exit(1);
  }

  const effectiveAudience = audience || SERVICE_JWT_AUDIENCE;

  return jwt.sign(
    {
      serviceName,
      tokenId,
      type: 'service'
    },
    privateKey,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || '24h',
      algorithm: 'RS256',
      issuer: SERVICE_JWT_ISSUER,
      audience: effectiveAudience,
    }
  );
}

module.exports = {
  authenticateService,
  generateServiceToken,
  ALLOWED_SERVICES
};
