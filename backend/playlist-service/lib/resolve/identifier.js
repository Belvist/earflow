const { computeDiscoverSeed, normalizeSeed, hashToInt64 } = require('../discover/seed');

function isShareSlug(value) {
    const v = String(value || '').trim();
    return /^[A-Za-z0-9]{32}$/.test(v);
}

function isLikelyMixToken(value) {
    const v = String(value || '');
    return v.startsWith('v1.') && v.split('.').length === 3;
}

function parseStrictPositiveInt(value) {
    const s = value === undefined || value === null ? '' : String(value).trim();
    if (!s || !/^\d+$/.test(s)) return null;
    const n = Number(s);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function extractSeedBase(discoverSeed) {
    const s = discoverSeed === undefined || discoverSeed === null ? '' : String(discoverSeed).trim();
    if (!s) return null;
    const idx = s.lastIndexOf(':');
    if (idx <= 0) return null;
    const base = s.slice(0, idx);
    const scope = s.slice(idx + 1);
    if (scope === 'anon') return base;
    if (/^u:\d+$/.test(scope)) return base;
    return null;
}

function extractLegacyDiscoverSeed(identifier) {
    const raw = identifier === undefined || identifier === null ? '' : String(identifier).trim();
    if (!raw || !raw.includes(':')) return null;
    const parts = raw.split('_').filter(Boolean);
    if (parts.length < 2) return null;
    const last = parts[parts.length - 1];
    const lastIsIndex = /^\d+$/.test(last);
    const candidate = lastIsIndex ? parts[parts.length - 2] : last;
    return candidate && candidate.includes(':') ? candidate : null;
}

function extractLegacyDiscoverComponents(identifier) {
    const raw = identifier === undefined || identifier === null ? '' : String(identifier).trim();
    if (!raw || !raw.includes(':')) return null;

    const parts = raw.split('_').filter(Boolean);
    if (parts.length < 2) return null;

    const seedIdx = parts.findIndex((p) => String(p).includes(':'));
    if (seedIdx < 1) return null;

    const seedPart = parts[seedIdx];
    const tail = parts.slice(seedIdx + 1);
    const idx = tail.length === 1 && /^\d+$/.test(tail[0]) ? Number(tail[0]) : null;
    const baseId = parts.slice(0, seedIdx).join('_');

    if (!baseId) return null;
    return { baseId, seedPart, idx };
}

function isDiscoverId(value) {
    const v = String(value || '').trim();
    if (!v) return false;
    if (v.startsWith('gen_')) return false;
    return /^[a-z0-9_]{2,32}_[a-z0-9]{6,64}(?:_\d{1,3})?$/.test(v);
}

function computeDiscoverKeyBase36({ seedBase, userId }) {
    const seed = normalizeSeed(seedBase);
    const discoverSeed = computeDiscoverSeed({ seed, userId });
    return hashToInt64(discoverSeed).toString(36);
}

function resolvePlaylistIdentifier(rawIdentifier, { userId } = {}) {
    const input = rawIdentifier === undefined || rawIdentifier === null ? '' : String(rawIdentifier).trim();
    if (!input) return { kind: 'unknown' };

    const numericId = parseStrictPositiveInt(input);
    if (numericId) {
        return { kind: 'numeric', numericId };
    }

    if (isShareSlug(input)) {
        return { kind: 'share_slug', shareSlug: input };
    }

    if (isLikelyMixToken(input)) {
        return { kind: 'mix', mixToken: input };
    }

    if (isDiscoverId(input)) {
        return { kind: 'discover', discoverId: input };
    }

    const legacy = extractLegacyDiscoverComponents(input);
    const seedBase = legacy ? extractSeedBase(legacy.seedPart) : null;
    if (legacy && seedBase) {
        const key = computeDiscoverKeyBase36({ seedBase, userId });
        return {
            kind: 'legacy_discover',
            legacyIdentifier: input,
            seedBase,
            discoverKey: key,
            baseId: legacy.baseId,
            idx: legacy.idx,
        };
    }

    return { kind: 'unknown' };
}

module.exports = {
    isShareSlug,
    isLikelyMixToken,
    isDiscoverId,
    parseStrictPositiveInt,
    resolvePlaylistIdentifier,
    computeDiscoverKeyBase36,
};
