'use strict';

const crypto = require('crypto');

function isEnabled() {
    return String(process.env.AUDIT_LOG_ENABLED || '').trim().toLowerCase() === 'true';
}

function getAuditSecret() {
    const explicit = String(process.env.AUDIT_LOG_SECRET || '').trim();
    if (explicit.length >= 16) return explicit;
    const fallback = String(process.env.JWT_SECRET || '').trim();
    if (fallback.length >= 32) return fallback;
    return null;
}

function stableHmac(value, secret) {
    const v = value === undefined || value === null ? '' : String(value);
    if (!v) return null;
    if (!secret) return null;
    return crypto.createHmac('sha256', secret).update(v).digest('hex');
}

function sanitizePrimitive(value) {
    if (value === null) return null;
    const t = typeof value;
    if (t === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    if (t === 'boolean') return value;
    if (t === 'string') {
        const s = value.trim();
        if (!s) return '';
        return s.length > 200 ? `${s.slice(0, 200)}…` : s;
    }
    return null;
}

function sanitizeDetails(details, secret) {
    if (!details || typeof details !== 'object') return {};

    const unsafeKeys = new Set([
        'token',
        'signature',
        'credential',
        'authorization',
        'cookie',
        'password',
        'secret',
        'key',
        'file_path',
        'filePath',
        'fileKey',
    ]);

    const out = {};

    for (const [k, v] of Object.entries(details)) {
        const key = String(k || '').trim();
        if (!key) continue;

        const lower = key.toLowerCase();
        if (unsafeKeys.has(key) || unsafeKeys.has(lower) || lower.includes('token') || lower.includes('secret') || lower.includes('password')) {
            continue;
        }

        if (lower === 'userid' || lower === 'user_id' || lower === 'user') {
            out.user_hash = stableHmac(v, secret);
            continue;
        }

        if (lower === 'ip' || lower === 'clientip' || lower === 'remote_addr') {
            out.ip_hash = stableHmac(v, secret);
            continue;
        }

        const sanitized = sanitizePrimitive(v);
        if (sanitized !== null) {
            out[key] = sanitized;
        }
    }

    return out;
}

function auditLog(event, details = {}) {
    if (!isEnabled()) return;

    const ev = String(event || '').trim();
    if (!ev) return;

    const secret = getAuditSecret();
    const payload = {
        audit: true,
        timestamp: new Date().toISOString(),
        event: ev,
        ...sanitizeDetails(details, secret),
    };

    try {
        process.stdout.write(`${JSON.stringify(payload)}\n`);
    } catch {
    }
}

module.exports = {
    auditLog,
};
