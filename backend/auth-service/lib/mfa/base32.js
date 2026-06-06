'use strict';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function toBase32(buffer) {
    if (!Buffer.isBuffer(buffer)) {
        throw new TypeError('toBase32: buffer is required');
    }

    let bits = 0;
    let value = 0;
    let output = '';

    for (const byte of buffer) {
        value = (value << 8) | byte;
        bits += 8;

        while (bits >= 5) {
            output += alphabet[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }

    if (bits > 0) {
        output += alphabet[(value << (5 - bits)) & 31];
    }

    return output;
}

function fromBase32(raw) {
    const input = String(raw || '').toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '');
    if (!input) {
        throw new Error('fromBase32: empty input');
    }

    let bits = 0;
    let value = 0;
    const bytes = [];

    for (const ch of input) {
        const idx = alphabet.indexOf(ch);
        if (idx === -1) {
            throw new Error('fromBase32: invalid character');
        }

        value = (value << 5) | idx;
        bits += 5;

        if (bits >= 8) {
            bytes.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }

    return Buffer.from(bytes);
}

module.exports = { toBase32, fromBase32 };
