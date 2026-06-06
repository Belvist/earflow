const crypto = require('crypto');

function normalizeSongIds(songIds) {
    if (!Array.isArray(songIds)) return [];
    const ids = [];
    for (const v of songIds) {
        const n = parseInt(v, 10);
        if (Number.isFinite(n) && n > 0) ids.push(n);
    }
    return Array.from(new Set(ids)).sort((a, b) => a - b);
}

function computeFingerprint({ userId, songIds }) {
    const uid = Number.isFinite(userId) ? String(userId) : '0';
    const ids = normalizeSongIds(songIds);
    const payload = `${uid}:${ids.join(',')}`;
    return crypto.createHash('sha256').update(payload).digest('hex');
}

module.exports = {
    normalizeSongIds,
    computeFingerprint,
};
