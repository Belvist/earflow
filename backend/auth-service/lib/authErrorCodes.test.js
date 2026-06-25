'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AUTH_ERROR_CODES, sendAuthError } = require('./authErrorCodes');

test('AUTH_ERROR_CODES includes login contract codes', () => {
    assert.equal(AUTH_ERROR_CODES.INVALID_CREDENTIALS, 'INVALID_CREDENTIALS');
    assert.equal(AUTH_ERROR_CODES.LOGIN_RATE_LIMITED, 'LOGIN_RATE_LIMITED');
    assert.equal(AUTH_ERROR_CODES.MFA_REQUIRED, 'MFA_REQUIRED');
    assert.equal(AUTH_ERROR_CODES.AUTH_UNAVAILABLE, 'AUTH_UNAVAILABLE');
    assert.equal(AUTH_ERROR_CODES.SERVER_ERROR, 'SERVER_ERROR');
    assert.equal(AUTH_ERROR_CODES.SESSION_EXPIRED, 'SESSION_EXPIRED');
    assert.equal(AUTH_ERROR_CODES.VALIDATION_ERROR, 'VALIDATION_ERROR');
    assert.equal(AUTH_ERROR_CODES.EMAIL_ALREADY_REGISTERED, 'EMAIL_ALREADY_REGISTERED');
});

test('sendAuthError returns stable code and optional retryAfterSeconds', () => {
    const headers = {};
    const res = {
        statusCode: 0,
        body: null,
        setHeader(name, value) {
            headers[name] = value;
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
    };

    sendAuthError(res, 429, AUTH_ERROR_CODES.LOGIN_RATE_LIMITED, 'Too many attempts', {
        retryAfterSeconds: 60,
    });

    assert.equal(res.statusCode, 429);
    assert.equal(res.body.code, 'LOGIN_RATE_LIMITED');
    assert.equal(res.body.error, 'Too many attempts');
    assert.equal(res.body.retryAfterSeconds, 60);
    assert.equal(headers['Retry-After'], '60');
});
