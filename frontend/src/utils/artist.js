export function parseArtistNames(value) {
    const raw = value === undefined || value === null ? '' : String(value);
    const normalized = raw.normalize('NFC').trim();
    if (!normalized) return [];

    const parts = normalized
        .split(/\s*(?:;|,|&|\bfeat\.?\b|\bft\.?\b)\s*/i)
        .map((s) => s.trim())
        .filter(Boolean);

    const unique = [];
    const seen = new Set();
    for (const p of parts) {
        const key = p.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(p);
    }
    return unique;
}

export function normalizeArtistNameForRoute(value) {
    const list = parseArtistNames(value);
    return list.length ? list[0] : '';
}
