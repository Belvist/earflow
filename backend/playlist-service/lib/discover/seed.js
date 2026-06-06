const crypto = require('node:crypto');

function normalizeSeed(raw) {
    const seed = (raw || '').toString().trim();
    if (!seed) return '';
    if (seed.length > 128) return seed.slice(0, 128);
    return seed;
}

function getDaySeed(now = new Date()) {
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function getTimeBucketSeed(now = new Date()) {
    const rawHours = process.env.DISCOVER_SEED_BUCKET_HOURS;
    const parsed = rawHours != null && String(rawHours).trim() !== ''
        ? Number.parseInt(String(rawHours), 10)
        : 6;
    const hours = Number.isFinite(parsed) && parsed > 0 && parsed <= 24 ? parsed : 6;

    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const bucket = Math.floor(now.getUTCHours() / hours);
    return `${yyyy}-${mm}-${dd}:${bucket}`;
}

function computeDiscoverSeed({ seed, userId }) {
    const normalized = normalizeSeed(seed);
    const base = normalized || getTimeBucketSeed();
    const scope = userId ? `u:${userId}` : 'anon';
    return `${base}:${scope}`;
}

function hashToInt64(input) {
    const h = crypto.createHash('sha256').update(String(input)).digest();
    const hi = h.readUInt32BE(0);
    const lo = h.readUInt32BE(4);
    return BigInt(hi) << 32n | BigInt(lo);
}

module.exports = {
    computeDiscoverSeed,
    normalizeSeed,
    getDaySeed,
    getTimeBucketSeed,
    hashToInt64,
};
