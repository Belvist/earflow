/**
 * Authentication middleware for Playlist Service
 * Supports both user JWT tokens and service-to-service tokens
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET;
const SERVICE_JWT_ISSUER = process.env.SERVICE_JWT_ISSUER || 'database-service';
const SERVICE_JWT_AUDIENCE = process.env.SERVICE_JWT_AUDIENCE || 'playlist-service';

function getServiceJwtPublicKey() {
    const raw = process.env.SERVICE_JWT_PUBLIC_KEY;
    const b64 = process.env.SERVICE_JWT_PUBLIC_KEY_B64;
    if (b64) {
        try {
            return Buffer.from(b64, 'base64').toString('utf8');
        } catch {
            return null;
        }
    }
    return raw || null;
}

// Allowed internal services
const ALLOWED_SERVICES = [
    'api-gateway',
    'auth-service',
    'upload-service',
    'recommendations-service'
];

/**
 * Timing-safe string comparison to prevent timing attacks
 */
function timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') {
        return false;
    }

    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);

    if (bufA.length !== bufB.length) {
        // Still do comparison to prevent timing leak
        crypto.timingSafeEqual(bufA, Buffer.alloc(bufA.length));
        return false;
    }

    return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Authenticate user via JWT token (from Authorization header)
 */
function authenticateToken(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : null;

    if (!token) {
        return res.status(401).json({ error: 'Токен отсутствует' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });

        // Extract user ID from various possible fields
        const userId = decoded.userId || decoded.user_id || decoded.id;

        if (!userId) {
            return res.status(401).json({ error: 'Некорректный токен' });
        }

        req.user = {
            id: parseInt(userId, 10),
            ...decoded
        };

        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Токен истёк' });
        }
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Недействительный токен' });
        }
        return res.status(401).json({ error: 'Ошибка авторизации' });
    }
}

/**
 * Authenticate internal service via service token
 */
function authenticateService(req, res, next) {
    const serviceToken = req.headers['x-service-token'];

    if (!serviceToken) {
        return res.status(401).json({ error: 'Service token required' });
    }

    try {
        const publicKey = getServiceJwtPublicKey();
        if (!publicKey) {
            return res.status(500).json({ error: 'Service auth misconfigured' });
        }

        const decoded = jwt.verify(serviceToken, publicKey, {
            algorithms: ['RS256'],
            issuer: SERVICE_JWT_ISSUER,
            audience: SERVICE_JWT_AUDIENCE,
        });

        if (!decoded || decoded.type !== 'service') {
            return res.status(401).json({ error: 'Invalid service token' });
        }

        if (!decoded.serviceName || !ALLOWED_SERVICES.includes(decoded.serviceName)) {
            return res.status(403).json({ error: 'Service not authorized' });
        }

        req.service = {
            name: decoded.serviceName,
            ...decoded
        };

        // If user ID is provided in headers, attach it
        const userIdHeader = req.headers['x-user-id'];
        if (userIdHeader) {
            const userId = parseInt(userIdHeader, 10);
            if (Number.isFinite(userId) && userId > 0) {
                req.user = { id: userId };
            }
        }

        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Service token expired' });
        }
        return res.status(401).json({ error: 'Invalid service token' });
    }
}

/**
 * Optional authentication - doesn't fail if no token
 */
function optionalAuth(req, res, next) {
    const userIdHeader = req.headers['x-user-id'];
    if (userIdHeader) {
        const userId = parseInt(userIdHeader, 10);
        if (Number.isFinite(userId) && userId > 0) {
            req.user = { id: userId };
        }
    }

    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : null;

    if (!token) {
        return next();
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        const userId = decoded.userId || decoded.user_id || decoded.id;

        if (userId) {
            req.user = {
                id: parseInt(userId, 10),
                ...decoded
            };
        }
    } catch {
        // Ignore token errors for optional auth
    }

    next();
}

/**
 * Check if user owns a resource or is admin
 */
function requireOwnership(getOwnerId) {
    return async (req, res, next) => {
        try {
            const ownerId = await getOwnerId(req);

            if (ownerId === null) {
                return res.status(404).json({ error: 'Ресурс не найден' });
            }

            if (req.user.id !== ownerId && !req.user.isAdmin) {
                return res.status(403).json({ error: 'Доступ запрещён' });
            }

            next();
        } catch (error) {
            next(error);
        }
    };
}

module.exports = {
    authenticateToken,
    authenticateService,
    optionalAuth,
    requireOwnership,
    timingSafeEqual
};
