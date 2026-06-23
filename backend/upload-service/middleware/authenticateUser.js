'use strict';

function parsePositiveInt(value) {
    const n = parseInt(String(value || ''), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function createAuthenticateUser({ authServiceUrl, jwtSecret, axios, jwt, getCookieValue }) {
    if (!authServiceUrl) {
        throw new Error('createAuthenticateUser: authServiceUrl is required');
    }
    if (!axios || typeof axios.post !== 'function') {
        throw new TypeError('createAuthenticateUser: axios client with post() is required');
    }
    if (!jwt || typeof jwt.verify !== 'function') {
        throw new TypeError('createAuthenticateUser: jwt is required');
    }
    if (typeof getCookieValue !== 'function') {
        throw new TypeError('createAuthenticateUser: getCookieValue must be a function');
    }

    const AUTH_CACHE_MAX = 2000;
    const authCache = new Map();

    function getCachedAuthUser(token) {
        if (!token) return null;
        const cached = authCache.get(token);
        if (!cached) return null;
        if (cached.expiresAt && cached.expiresAt <= Date.now()) {
            authCache.delete(token);
            return null;
        }
        return cached.user;
    }

    function setCachedAuthUser(token, user, expSeconds) {
        if (!token || !user) return;
        if (authCache.size >= AUTH_CACHE_MAX) {
            const keysToDelete = Array.from(authCache.keys()).slice(0, Math.floor(AUTH_CACHE_MAX / 4));
            for (const k of keysToDelete) authCache.delete(k);
        }
        const expiresAt = Number.isFinite(expSeconds) ? expSeconds * 1000 : Date.now() + 5 * 60 * 1000;
        authCache.set(token, { user, expiresAt });
    }

    return async function authenticateUser(req, res, next) {
        try {
            let token = req.headers.authorization?.replace('Bearer ', '');

            if (!token) {
                token = getCookieValue(req, 'mp_auth');
            }

            if (!token) {
                return res.status(401).json({ error: 'Токен отсутствует' });
            }

            const cachedUser = getCachedAuthUser(token);
            if (cachedUser) {
                req.user = cachedUser;
                return next();
            }

            if (jwtSecret && String(jwtSecret).length >= 32) {
                try {
                    const decoded = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
                    const userId = decoded?.userId || decoded?.user_id || decoded?.id || decoded?.sub;
                    const parsedUserId = parsePositiveInt(userId);
                    if (!parsedUserId) {
                        return res.status(401).json({ error: 'Некорректный токен' });
                    }
                    const user = { id: parsedUserId, isAdmin: decoded?.isAdmin === true };
                    setCachedAuthUser(token, user, decoded?.exp);
                    req.user = user;
                    return next();
                } catch (e) {
                    if (e && (e.name === 'TokenExpiredError' || e.name === 'JsonWebTokenError')) {
                        return res.status(401).json({ error: 'Недействительный токен' });
                    }
                }
            }

            const response = await axios.post(`${authServiceUrl}/api/verify`, { token });

            if (!response.data.valid) {
                return res.status(401).json({ error: 'Недействительный токен' });
            }

            const verifiedUser = response.data.user;
            const rawUserId = verifiedUser ? (verifiedUser.id ?? verifiedUser.userId ?? verifiedUser.user_id ?? verifiedUser.sub) : null;
            const parsedUserId = parsePositiveInt(rawUserId);

            req.user = verifiedUser && typeof verifiedUser === 'object'
                ? { ...verifiedUser, id: parsedUserId ?? verifiedUser.id }
                : verifiedUser;

            if (parsedUserId) {
                setCachedAuthUser(token, { id: parsedUserId, isAdmin: verifiedUser?.isAdmin === true }, null);
            }

            return next();
        } catch (error) {
            return res.status(401).json({ error: 'Ошибка аутентификации' });
        }
    };
}

module.exports = createAuthenticateUser;
