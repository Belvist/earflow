'use strict';

const config = require('../config');

function isAllowedOrigin(origin) {
    if (!origin || typeof origin !== 'string') {
        return false;
    }

    const allowed = Array.isArray(config.cors.allowedOrigins) ? config.cors.allowedOrigins : [];
    if (allowed.length > 0) {
        return allowed.includes(origin);
    }

    return Boolean(config.cors.allowEmptyInDev);
}

function applyCorsHeaders(req, res) {
    const origin = req.headers?.origin;
    if (!origin || typeof origin !== 'string') {
        return;
    }

    if (!isAllowedOrigin(origin)) {
        return;
    }

    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Credentials', 'true');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Correlation-ID');
}

module.exports = {
    applyCorsHeaders,
    isAllowedOrigin,
};
