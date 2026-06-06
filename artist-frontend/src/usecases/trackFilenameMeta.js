export function safeText(v) {
    if (v === null || v === undefined) return '';
    return String(v);
}

export function currentYear() {
    return String(new Date().getFullYear());
}

function stripExtension(name) {
    const v = safeText(name).trim();
    const i = v.lastIndexOf('.');
    if (i <= 0) return v;
    return v.slice(0, i);
}

function normalizeSpaces(v) {
    return safeText(v)
        .replaceAll('_', ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function parseFilenameMeta(fileName) {
    const base = normalizeSpaces(stripExtension(fileName));
    if (!base) return { title: '', artist: '', feat: '', year: '' };

    const yearMatch = base.match(/(?:\(|\[|\s|^)(19\d{2}|20\d{2})(?:\)|\]|\s|$)/);
    const year = yearMatch ? yearMatch[1] : '';

    const cleaned = normalizeSpaces(base.replaceAll(/(?:\(|\[|\s|^)(19\d{2}|20\d{2})(?:\)|\]|\s|$)/g, ' '));

    const featMatch = cleaned.match(/\((?:feat\.|ft\.)\s*([^)]*)\)/i) || cleaned.match(/\b(?:feat\.|ft\.)\s+(.+)$/i);
    const feat = featMatch ? normalizeSpaces(featMatch[1]) : '';
    const withoutFeat = featMatch ? normalizeSpaces(cleaned.replace(featMatch[0], ' ')) : cleaned;

    const parts = withoutFeat.split(' - ').map((p) => normalizeSpaces(p)).filter(Boolean);
    if (parts.length >= 2) {
        return { artist: parts[0], title: parts.slice(1).join(' - '), feat, year };
    }
    return { artist: '', title: withoutFeat, feat, year };
}

export function isYearValid(v) {
    const s = safeText(v).trim();
    if (!s) return true;
    if (!/^\d{4}$/.test(s)) return false;
    const n = Number.parseInt(s, 10);
    const now = new Date().getFullYear();
    return Number.isFinite(n) && n >= 1900 && n <= now + 1;
}
