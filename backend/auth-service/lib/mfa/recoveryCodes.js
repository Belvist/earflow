'use strict';

const crypto = require('crypto');

function generateRecoveryCodes({ count = 10, bytesPerCode = 9 } = {}) {
    const n = Number(count);
    const b = Number(bytesPerCode);
    if (!Number.isFinite(n) || n < 6 || n > 20) {
        throw new Error('generateRecoveryCodes: invalid count');
    }
    if (!Number.isFinite(b) || b < 8 || b > 16) {
        throw new Error('generateRecoveryCodes: invalid bytesPerCode');
    }

    const out = [];
    for (let i = 0; i < n; i += 1) {
        const code = crypto.randomBytes(b).toString('base64url').toUpperCase();
        out.push(code);
    }
    return out;
}

function hashRecoveryCode({ userSalt, code }) {
    const s = String(userSalt || '').trim();
    const c = String(code || '').trim().toUpperCase();
    if (!s) throw new Error('hashRecoveryCode: userSalt is required');
    if (!c) throw new Error('hashRecoveryCode: code is required');
    return crypto.createHash('sha256').update(`${s}:${c}`, 'utf8').digest('hex');
}

function timingSafeEqualHex(a, b) {
    const aa = Buffer.from(String(a || ''), 'hex');
    const bb = Buffer.from(String(b || ''), 'hex');
    if (aa.length !== bb.length) return false;
    return crypto.timingSafeEqual(aa, bb);
}

function tryConsumeRecoveryCode({ userSalt, storedHashes, providedCode }) {
    const code = String(providedCode || '').trim();
    if (!code) return { ok: false, nextHashes: storedHashes };

    const hashes = Array.isArray(storedHashes) ? storedHashes.slice() : [];
    const want = hashRecoveryCode({ userSalt, code });

    for (let i = 0; i < hashes.length; i += 1) {
        const h = String(hashes[i] || '').trim();
        if (!h) continue;
        if (timingSafeEqualHex(h, want)) {
            hashes.splice(i, 1);
            return { ok: true, nextHashes: hashes };
        }
    }

    return { ok: false, nextHashes: hashes };
}

module.exports = {
    generateRecoveryCodes,
    hashRecoveryCode,
    tryConsumeRecoveryCode,
};
