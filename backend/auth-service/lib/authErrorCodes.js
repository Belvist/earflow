/**
 * Stable auth error codes — machine contract for Gateway / iOS / web clients.
 * Human `error` strings may change locale; `code` must not.
 *
 * @see docs/AUTH_ERROR_CODES.md (contract)
 * @see docs/IOS_APP.md §8
 */

const AUTH_ERROR_CODES = Object.freeze({
    INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
    LOGIN_RATE_LIMITED: 'LOGIN_RATE_LIMITED',
    MFA_REQUIRED: 'MFA_REQUIRED',
    MFA_REQUIRED_TO_SET_PASSWORD: 'MFA_REQUIRED_TO_SET_PASSWORD',
    SESSION_EXPIRED: 'SESSION_EXPIRED',
    SESSION_REVOKED: 'SESSION_REVOKED',
    NO_SESSION: 'NO_SESSION',
    SESSION_UNVERIFIED: 'SESSION_UNVERIFIED',
    CSRF_FAILED: 'CSRF_FAILED',
    DEVICE_PROOF_REQUIRED: 'DEVICE_PROOF_REQUIRED',
    DEVICE_PROOF_INVALID: 'DEVICE_PROOF_INVALID',
    DEVICE_PROOF_EXPIRED: 'DEVICE_PROOF_EXPIRED',
    DEVICE_REVOKED: 'DEVICE_REVOKED',
    AUTH_UNAVAILABLE: 'AUTH_UNAVAILABLE',
    SERVER_ERROR: 'SERVER_ERROR',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    EMAIL_ALREADY_REGISTERED: 'EMAIL_ALREADY_REGISTERED',
    RATE_LIMITED: 'RATE_LIMITED',
});

/**
 * @param {import('express').Response} res
 * @param {number} status
 * @param {string} code - stable machine code from AUTH_ERROR_CODES
 * @param {string} error - human-readable message
 * @param {{ retryAfterSeconds?: number }} [extra]
 */
function sendAuthError(res, status, code, error, extra = {}) {
    const body = { error, code };
    if (extra.retryAfterSeconds != null && Number.isFinite(extra.retryAfterSeconds)) {
        body.retryAfterSeconds = Math.max(0, Math.floor(extra.retryAfterSeconds));
        res.setHeader('Retry-After', String(body.retryAfterSeconds));
    }
    return res.status(status).json(body);
}

module.exports = {
    AUTH_ERROR_CODES,
    sendAuthError,
};
