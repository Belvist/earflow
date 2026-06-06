const { hashToInt64 } = require('./seed');

function stableShuffle(items, { seed, salt, getKey } = {}) {
    if (!Array.isArray(items) || items.length < 2) return Array.isArray(items) ? items.slice() : [];
    const baseSeed = (seed || '').toString();
    const s = (salt || '').toString();
    const keyFn = typeof getKey === 'function' ? getKey : (v) => v;

    const decorated = items.map((item, idx) => {
        const k = keyFn(item);
        const h = hashToInt64(`${baseSeed}:${s}:${String(k)}:${idx}`);
        return { item, h, idx };
    });

    decorated.sort((a, b) => {
        if (a.h === b.h) return a.idx - b.idx;
        return a.h < b.h ? -1 : 1;
    });

    return decorated.map((d) => d.item);
}

module.exports = {
    stableShuffle,
};
