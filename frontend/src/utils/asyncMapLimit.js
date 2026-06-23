export default async function asyncMapLimit(items, limit, mapper) {
    const list = Array.isArray(items) ? items : [];
    const concurrency = Math.max(1, Math.floor(Number(limit) || 1));
    const fn = typeof mapper === 'function' ? mapper : null;
    if (!fn) throw new TypeError('mapper must be a function');

    const results = new Array(list.length);
    let nextIndex = 0;

    const runWorker = async () => {
        while (true) {
            const idx = nextIndex;
            nextIndex += 1;
            if (idx >= list.length) return;
            results[idx] = await fn(list[idx], idx);
        }
    };

    const workers = Array.from({ length: Math.min(concurrency, list.length) }, () => runWorker());
    await Promise.all(workers);
    return results;
}
