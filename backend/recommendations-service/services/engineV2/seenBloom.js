const config = require('../../config');
const redis = require('../../lib/redis');

function bloomKey(userId) {
    return `${config.redisKeys.prefix}bf:seen48h:${userId}`;
}

function hash64(seed, value) {
    let x = BigInt(seed) ^ BigInt(value);
    x ^= x >> 33n;
    x *= 0xff51afd7ed558ccdn;
    x ^= x >> 33n;
    x *= 0xc4ceb9fe1a85ec53n;
    x ^= x >> 33n;
    return x & 0xffffffffffffffffn;
}

function offsetsFor(id, m, k) {
    const out = [];
    const base = hash64(0x9e3779b97f4a7c15n, BigInt(id));
    const step = hash64(0xc2b2ae3d27d4eb4fn, BigInt(id)) | 1n;

    for (let i = 0; i < k; i += 1) {
        const h = (base + BigInt(i) * step) % BigInt(m);
        out.push(Number(h));
    }
    return out;
}

async function bloomFilterIds(userId, ids) {
    const uid = Number.parseInt(String(userId), 10);
    const list = Array.isArray(ids) ? ids : [];
    if (!Number.isFinite(uid) || uid <= 0 || list.length === 0) {
        return [];
    }

    const m = config.engineV2.bloomBits;
    const k = config.engineV2.bloomHashes;

    const bitfieldArgs = [];
    const perId = [];

    for (const raw of list) {
        const id = Number.parseInt(raw, 10);
        if (!Number.isFinite(id) || id <= 0) continue;
        const offs = offsetsFor(id, m, k);
        perId.push({ id, offs });
        for (const off of offs) {
            bitfieldArgs.push('GET');
            bitfieldArgs.push('u1');
            bitfieldArgs.push(String(off));
        }
    }

    if (bitfieldArgs.length === 0) {
        return [];
    }

    const client = await redis.getClient();
    const key = bloomKey(uid);

    const values = await client.sendCommand(['BITFIELD_RO', key, ...bitfieldArgs]);

    const out = [];
    let idx = 0;
    for (const entry of perId) {
        let seen = true;
        for (let i = 0; i < entry.offs.length; i += 1) {
            const v = values[idx];
            idx += 1;
            if (Number(v) !== 1) {
                seen = false;
            }
        }
        if (!seen) {
            out.push(entry.id);
        }
    }

    return out;
}

async function bloomMarkSeen(userId, ids) {
    const uid = Number.parseInt(String(userId), 10);
    const list = Array.isArray(ids) ? ids : [];
    if (!Number.isFinite(uid) || uid <= 0 || list.length === 0) {
        return;
    }

    const m = config.engineV2.bloomBits;
    const k = config.engineV2.bloomHashes;

    const args = [];

    for (const raw of list) {
        const id = Number.parseInt(raw, 10);
        if (!Number.isFinite(id) || id <= 0) continue;
        const offs = offsetsFor(id, m, k);
        for (const off of offs) {
            args.push('SET');
            args.push('u1');
            args.push(String(off));
            args.push('1');
        }
    }

    if (args.length === 0) {
        return;
    }

    const client = await redis.getClient();
    const key = bloomKey(uid);

    const ttlSeconds = config.engineV2.seenTtlSeconds;

    await client.sendCommand(['BITFIELD', key, ...args]);
    await client.expire(key, ttlSeconds);
}

module.exports = {
    bloomFilterIds,
    bloomMarkSeen,
};
