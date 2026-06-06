'use strict';

const jwt = require('jsonwebtoken');
const { getCookieValue } = require('../lib/http/cookies');
const crypto = require('crypto');

const AUTH_COOKIE_NAMES = Object.freeze(['mp_auth', 'mp_auth_artists']);
const REFRESH_COOKIE_NAMES = Object.freeze(['mp_refresh', 'mp_refresh_artists']);
const SESSION_COOKIE_NAMES = Object.freeze([...AUTH_COOKIE_NAMES, ...REFRESH_COOKIE_NAMES]);
const CSRF_COOKIE_NAMES = Object.freeze(['mp_csrf', 'mp_csrf_artists']);

function readAnyCookie(req, names) {
    for (const name of names) {
        const value = getCookieValue(req, name);
        if (value) return value;
    }
    return '';
}

function isSafeMethod(method) {
    const m = String(method || '').toUpperCase();
    return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
}

function getOriginOrRefererOrigin(req) {
    const origin = req.headers.origin;
    if (origin) return origin;
    const referer = req.headers.referer;
    if (!referer) return null;
    try {
        const u = new URL(referer);
        return u.origin;
    } catch {
        return null;
    }
}

function isLikelyBearerAuth(req) {
    const raw = req && req.headers ? req.headers.authorization : null;
    if (!raw) return false;
    const v = String(raw).trim();
    return v.toLowerCase().startsWith('bearer ');
}

function getSidFromJwtCookie(token, jwtSecret) {
    if (!token || !jwtSecret) return null;
    try {
        const decoded = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
        if (!decoded || !decoded.sid) return null;
        if (decoded.type && decoded.type !== 'access' && decoded.type !== 'refresh') return null;
        return decoded.sid;
    } catch {
        return null;
    }
}

function verifyCsrfToken({ sid, secret, token }) {
    if (!sid || !secret || !token) return false;
    const parts = String(token).split('.');
    if (parts.length !== 2) return false;
    const [nonce, sig] = parts;
    if (!nonce || !sig) return false;
    const expected = crypto.createHmac('sha256', secret).update(`${sid}.${nonce}`).digest('base64url');
    try {
        const a = Buffer.from(sig);
        const b = Buffer.from(expected);
        if (a.length !== b.length) return false;
        return crypto.timingSafeEqual(a, b);
    } catch {
        return false;
    }
}

function applyCsrfProtection(app, { jwtSecret, allowedOrigins, telegramOriginPatterns, devOriginPatterns, nodeEnv }) {
    if (!app || typeof app.use !== 'function') {
        throw new TypeError('applyCsrfProtection: app.use is required');
    }

    const origins = Array.isArray(allowedOrigins) ? allowedOrigins : [];
    const telegramPatterns = Array.isArray(telegramOriginPatterns) ? telegramOriginPatterns : [];
    const devPatterns = Array.isArray(devOriginPatterns) ? devOriginPatterns : [];
    const env = String(nodeEnv || process.env.NODE_ENV || 'development');

    app.use((req, res, next) => {
        try {
            if (isSafeMethod(req.method)) return next();

            const path = String(req.path || '');
            if (path === '/health' || path === '/metrics') {
                return next();
            }

            const hasSessionCookie = !!readAnyCookie(req, SESSION_COOKIE_NAMES);
            const bearerAuth = isLikelyBearerAuth(req);
            if (!hasSessionCookie && bearerAuth) {
                return next();
            }
            if (!hasSessionCookie) return next();

            const requestOrigin = getOriginOrRefererOrigin(req);
            if (requestOrigin) {
                const allowed = (
                    origins.includes(requestOrigin) ||
                    telegramPatterns.some((p) => p.test(requestOrigin)) ||
                    (env !== 'production' && devPatterns.some((p) => p.test(requestOrigin)))
                );

                if (!allowed) {
                    return res.status(403).json({ error: 'CSRF blocked', code: 'CSRF_BAD_ORIGIN' });
                }
            } else {
                const secFetchSite = req.headers['sec-fetch-site'];
                if (secFetchSite && String(secFetchSite).toLowerCase() === 'cross-site') {
                    return res.status(403).json({ error: 'CSRF blocked', code: 'CSRF_FETCH_METADATA' });
                }
            }

            const csrfCookie = readAnyCookie(req, CSRF_COOKIE_NAMES);
            const csrfHeader = String(req.headers['x-csrf-token'] || '');
            if (!csrfCookie || !csrfHeader) {
                return res.status(403).json({ error: 'CSRF blocked', code: 'CSRF_MISSING' });
            }
            if (csrfCookie.length !== csrfHeader.length) {
                return res.status(403).json({ error: 'CSRF blocked', code: 'CSRF_MISMATCH' });
            }
            try {
                const eq = crypto.timingSafeEqual(Buffer.from(csrfCookie), Buffer.from(csrfHeader));
                if (!eq) {
                    return res.status(403).json({ error: 'CSRF blocked', code: 'CSRF_MISMATCH' });
                }
            } catch {
                return res.status(403).json({ error: 'CSRF blocked', code: 'CSRF_MISMATCH' });
            }

            if (!jwtSecret) {
                return res.status(403).json({ error: 'CSRF blocked', code: 'CSRF_CONFIG_ERROR' });
            }

            const sid = (
                getSidFromJwtCookie(readAnyCookie(req, REFRESH_COOKIE_NAMES), jwtSecret) ||
                getSidFromJwtCookie(readAnyCookie(req, AUTH_COOKIE_NAMES), jwtSecret)
            );

            if (!sid) {
                return res.status(403).json({ error: 'CSRF blocked', code: 'CSRF_NO_SESSION' });
            }

            if (!verifyCsrfToken({ sid, secret: jwtSecret, token: String(csrfCookie) })) {
                return res.status(403).json({ error: 'CSRF blocked', code: 'CSRF_INVALID' });
            }

            return next();
        } catch {
            return res.status(403).json({ error: 'CSRF blocked', code: 'CSRF_ERROR' });
        }
    });
}

module.exports = {
    applyCsrfProtection,
};
