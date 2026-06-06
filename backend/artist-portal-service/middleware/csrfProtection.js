'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const AUTH_COOKIE_NAMES = Object.freeze(['mp_auth', 'mp_auth_artists']);
const REFRESH_COOKIE_NAMES = Object.freeze(['mp_refresh', 'mp_refresh_artists']);
const SESSION_COOKIE_NAMES = Object.freeze([...AUTH_COOKIE_NAMES, ...REFRESH_COOKIE_NAMES]);
const CSRF_COOKIE_NAMES = Object.freeze(['mp_csrf', 'mp_csrf_artists']);

function getCookieValue(req, cookieName) {
    const header = req && req.headers && typeof req.headers.cookie === 'string' ? req.headers.cookie : '';
    if (!header) return '';

    const parts = header.split(';');
    for (const part of parts) {
        const idx = part.indexOf('=');
        if (idx <= 0) continue;
        const key = part.slice(0, idx).trim();
        if (key !== cookieName) continue;
        return part.slice(idx + 1).trim();
    }
    return '';
}

function readAnyCookie(req, names) {
    for (const name of names) {
        const v = getCookieValue(req, name);
        if (v) return v;
    }
    return '';
}

function isSafeMethod(method) {
    const m = String(method || '').toUpperCase();
    return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
}

function isLikelyBearerAuth(req) {
    const raw = req && req.headers ? req.headers.authorization : '';
    const v = raw ? String(raw).trim() : '';
    return v.toLowerCase().startsWith('bearer ');
}

function getRequestOrigin(req) {
    const origin = req && req.headers ? String(req.headers.origin || '').trim() : '';
    if (origin) return origin;

    const referer = req && req.headers ? String(req.headers.referer || '').trim() : '';
    if (!referer) return '';
    try {
        return new URL(referer).origin;
    } catch {
        return '';
    }
}

function getSidFromJwtCookie(token, jwtSecret) {
    if (!token || !jwtSecret) return '';
    try {
        const decoded = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
        if (!decoded || typeof decoded !== 'object') return '';
        if (decoded.type && decoded.type !== 'access' && decoded.type !== 'refresh') return '';
        const sid = typeof decoded.sid === 'string' ? decoded.sid : '';
        return sid;
    } catch {
        return '';
    }
}

function verifyCsrfHmac({ sid, secret, token }) {
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

/**
 * Double-submit cookie CSRF protection with HMAC token binding to session.
 *
 * Checks (in order) for unsafe methods when session cookies are present:
 *   1. Origin/Referer must match allowlist (or Sec-Fetch-Site must not be cross-site).
 *   2. `X-CSRF-Token` header must match `mp_csrf` / `mp_csrf_artists` cookie.
 *   3. If `jwtSecret` is provided, HMAC of token is verified against session id
 *      extracted from auth/refresh JWT, preventing cookie injection attacks.
 *
 * Safe methods (GET/HEAD/OPTIONS) and unauthenticated requests pass through.
 * Bearer-only API clients (no session cookies) pass through because they are
 * not subject to CSRF by design.
 *
 * @param {import('express').Express} app
 * @param {{
 *   jwtSecret?: string,
 *   allowedOrigins: string[],
 *   devOriginPatterns?: RegExp[],
 *   nodeEnv?: string,
 * }} options
 */
function applyCsrfProtection(app, options) {
    if (!app || typeof app.use !== 'function') {
        throw new TypeError('applyCsrfProtection: app.use is required');
    }

    const jwtSecret = typeof options?.jwtSecret === 'string' ? options.jwtSecret : '';
    const allowedOrigins = Array.isArray(options?.allowedOrigins) ? options.allowedOrigins : [];
    const devOriginPatterns = Array.isArray(options?.devOriginPatterns) ? options.devOriginPatterns : [];
    const env = String(options?.nodeEnv || process.env.NODE_ENV || 'development');

    app.use((req, res, next) => {
        try {
            if (isSafeMethod(req.method)) return next();

            const path = String(req.path || '');
            if (path === '/health' || path === '/metrics') return next();

            const hasSessionCookie = !!readAnyCookie(req, SESSION_COOKIE_NAMES);
            const bearerAuth = isLikelyBearerAuth(req);

            if (!hasSessionCookie && bearerAuth) return next();
            if (!hasSessionCookie) return next();

            const requestOrigin = getRequestOrigin(req);
            if (requestOrigin) {
                const allowed = (
                    allowedOrigins.includes(requestOrigin) ||
                    (env !== 'production' && devOriginPatterns.some((p) => p.test(requestOrigin)))
                );
                if (!allowed) {
                    return res.status(403).json({ error: 'CSRF blocked', code: 'CSRF_BAD_ORIGIN' });
                }
            } else {
                const secFetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
                if (secFetchSite === 'cross-site') {
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

            const refreshToken = readAnyCookie(req, REFRESH_COOKIE_NAMES);
            const authToken = readAnyCookie(req, AUTH_COOKIE_NAMES);
            const sid = (
                getSidFromJwtCookie(refreshToken, jwtSecret) ||
                getSidFromJwtCookie(authToken, jwtSecret)
            );

            if (!sid) {
                return res.status(403).json({ error: 'CSRF blocked', code: 'CSRF_NO_SESSION' });
            }

            if (!verifyCsrfHmac({ sid, secret: jwtSecret, token: csrfCookie })) {
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
