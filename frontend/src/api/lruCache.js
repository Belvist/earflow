export class LruCache {
    constructor(options = {}) {
        const maxEntries = Number(options.maxEntries);
        const ttlMs = Number(options.ttlMs);
        this._maxEntries = Number.isFinite(maxEntries) && maxEntries > 0 ? (maxEntries | 0) : 256;
        this._ttlMs = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : 0;
        this._map = new Map();
    }

    get size() {
        return this._map.size;
    }

    keys() {
        return this._map.keys();
    }

    has(key) {
        return this.get(key) !== undefined;
    }

    get(key) {
        const entry = this._map.get(key);
        if (!entry) return undefined;

        const exp = entry.expiresAtMs;
        if (typeof exp === 'number' && exp > 0 && Date.now() > exp) {
            this._map.delete(key);
            return undefined;
        }

        this._map.delete(key);
        this._map.set(key, entry);
        return entry.value;
    }

    set(key, value, ttlOverrideMs) {
        const ttlMsRaw = ttlOverrideMs === undefined ? this._ttlMs : Number(ttlOverrideMs);
        const ttlMs = Number.isFinite(ttlMsRaw) && ttlMsRaw > 0 ? ttlMsRaw : 0;
        const expiresAtMs = ttlMs ? Date.now() + ttlMs : 0;

        if (this._map.has(key)) {
            this._map.delete(key);
        }

        this._map.set(key, { value, expiresAtMs });

        this._evict();
    }

    delete(key) {
        this._map.delete(key);
    }

    clear() {
        this._map.clear();
    }

    _evict() {
        const now = Date.now();
        while (this._map.size > this._maxEntries) {
            const firstKey = this._map.keys().next().value;
            if (firstKey === undefined) break;
            this._map.delete(firstKey);
        }

        while (this._map.size > 0) {
            const firstKey = this._map.keys().next().value;
            if (firstKey === undefined) break;
            const entry = this._map.get(firstKey);
            const exp = entry && typeof entry.expiresAtMs === 'number' ? entry.expiresAtMs : 0;
            if (!exp || now <= exp) {
                break;
            }
            this._map.delete(firstKey);
        }
    }
}
