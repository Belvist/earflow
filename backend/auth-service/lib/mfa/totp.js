'use strict';

const crypto = require('crypto');
const { fromBase32, toBase32 } = require('./base32');

function generateSecretBase32(bytes = 20) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n < 16 || n > 64) {
        throw new Error('generateSecretBase32: invalid bytes');
    }
    return toBase32(crypto.randomBytes(n));
}

function normalizeToken(raw) {
    return String(raw || '').replace(/\s+/g, '').trim();
}

function hotp({ key, counter, digits = 6 }) {
    const d = Number(digits);
    if (!Number.isFinite(d) || d < 6 || d > 8) {
        throw new Error('hotp: invalid digits');
    }

    const buf = Buffer.alloc(8);
    let c = BigInt(counter);
    for (let i = 7; i >= 0; i -= 1) {
        buf[i] = Number(c & 0xffn);
        c >>= 8n;
    }

    const hmac = crypto.createHmac('sha1', key).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const bin = ((hmac[offset] & 0x7f) << 24)
        | ((hmac[offset + 1] & 0xff) << 16)
        | ((hmac[offset + 2] & 0xff) << 8)
        | (hmac[offset + 3] & 0xff);

    const mod = 10 ** d;
    const code = String(bin % mod).padStart(d, '0');
    return code;
}

function totp({ secretBase32, timeMs = Date.now(), stepSeconds = 30, digits = 6 }) {
    const step = Number(stepSeconds);
    if (!Number.isFinite(step) || step < 15 || step > 120) {
        throw new Error('totp: invalid stepSeconds');
    }

    const t = Math.floor(Number(timeMs) / 1000);
    const counter = Math.floor(t / step);
    const key = fromBase32(secretBase32);
    return hotp({ key, counter, digits });
}

function timingSafeEqualString(a, b) {
    const aa = Buffer.from(String(a), 'utf8');
    const bb = Buffer.from(String(b), 'utf8');
    if (aa.length !== bb.length) return false;
    return crypto.timingSafeEqual(aa, bb);
}

function verifyTotp({ secretBase32, token, window = 1, stepSeconds = 30, digits = 6, timeMs = Date.now() }) {
    const w = Number(window);
    if (!Number.isFinite(w) || w < 0 || w > 4) {
        throw new Error('verifyTotp: invalid window');
    }

    const tok = normalizeToken(token);
    if (!/^[0-9]{6,8}$/.test(tok)) {
        return false;
    }

    const step = Number(stepSeconds);
    const current = Math.floor(Number(timeMs) / 1000);

    for (let i = -w; i <= w; i += 1) {
        const candidateTime = (current + i * step) * 1000;
        const expected = totp({ secretBase32, timeMs: candidateTime, stepSeconds: stepSeconds, digits });
        if (timingSafeEqualString(expected, tok)) {
            return true;
        }
    }

    return false;
}

function buildOtpauthUrl({ issuer, accountName, secretBase32, digits = 6, period = 30 }) {
    const iss = String(issuer || '').trim();
    const acc = String(accountName || '').trim();
    if (!iss) throw new Error('buildOtpauthUrl: issuer is required');
    if (!acc) throw new Error('buildOtpauthUrl: accountName is required');

    const label = `${iss}:${acc}`;
    const params = new URLSearchParams({
        secret: String(secretBase32 || '').trim(),
        issuer: iss,
        algorithm: 'SHA1',
        digits: String(digits),
        period: String(period),
    });

    return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

module.exports = {
    generateSecretBase32,
    buildOtpauthUrl,
    verifyTotp,
};
