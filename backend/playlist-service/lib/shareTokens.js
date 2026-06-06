const crypto = require('crypto');

function base64UrlEncode(input) {
    const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecodeToBuffer(input) {
    const normalized = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
    const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    return Buffer.from(normalized + pad, 'base64');
}

function timingSafeEqual(a, b) {
    if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) return false;
    if (a.length !== b.length) {
        crypto.timingSafeEqual(a, Buffer.alloc(a.length));
        return false;
    }
    return crypto.timingSafeEqual(a, b);
}

function signPayload(payload, secret) {
    const payloadJson = JSON.stringify(payload);
    const payloadB64 = base64UrlEncode(payloadJson);
    const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest();
    const sigB64 = base64UrlEncode(sig);
    return `v1.${payloadB64}.${sigB64}`;
}

function verifyToken(token, secret) {
    const raw = String(token || '');
    const parts = raw.split('.');
    if (parts.length !== 3) return null;
    if (parts[0] !== 'v1') return null;

    const payloadB64 = parts[1];
    const sigB64 = parts[2];

    let payload;
    try {
        const payloadBuf = base64UrlDecodeToBuffer(payloadB64);
        payload = JSON.parse(payloadBuf.toString('utf8'));
    } catch {
        return null;
    }

    const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest();
    const providedSig = base64UrlDecodeToBuffer(sigB64);
    if (!timingSafeEqual(expectedSig, providedSig)) return null;

    if (payload && typeof payload.exp === 'number' && Date.now() > payload.exp) {
        return null;
    }

    return payload;
}

module.exports = {
    signPayload,
    verifyToken,
};
