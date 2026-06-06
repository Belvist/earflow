function safeText(v) {
    if (v === null || v === undefined) return '';
    return String(v);
}

function slugify(value) {
    const raw = safeText(value).normalize('NFC').trim().toLowerCase();
    if (!raw) return '';
    const replaced = raw
        .replaceAll(/['"`]/g, '')
        .replaceAll(/[^\p{L}\p{N}]+/gu, '-')
        .replaceAll(/-+/g, '-')
        .replaceAll(/(^-)|(-$)/g, '');
    return replaced;
}

function getPublicSiteBaseUrl() {
    const env = typeof process !== 'undefined' && process.env ? process.env.REACT_APP_PUBLIC_SITE_URL : undefined;
    const raw = safeText(env).trim();
    const candidate = raw || 'https://earflow.ru';
    try {
        const url = new URL(candidate);
        const host = url.hostname.toLowerCase();
        const isEarflowHost = host === 'earflow.ru';
        const isLocalHost = host === 'localhost' || host === '127.0.0.1';
        if (!isEarflowHost && !isLocalHost) return 'https://earflow.ru';
        if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHost)) return 'https://earflow.ru';
        return url.origin.replace(/\/+$/, '');
    } catch {
        return 'https://earflow.ru';
    }
}

export function coverUrlFromPath(pathValue) {
    const raw = safeText(pathValue).trim();
    if (!raw) return '';
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
        try {
            const url = new URL(raw);
            const host = url.hostname.toLowerCase();
            const isLocalHost = host === 'localhost' || host === '127.0.0.1';
            const isEarflowHost = host === 'earflow.ru' || host === 'api.earflow.ru';
            if (!isEarflowHost && !isLocalHost) return '';
            if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHost)) return '';
            const filename = url.pathname.split('/').pop();
            return filename ? `/covers/${encodeURIComponent(filename)}` : '';
        } catch {
            return '';
        }
    }
    const normalized = raw.replace(/^\/+/, '');
    if (!normalized || normalized.includes('..') || normalized.includes('\\')) return '';
    const filename = normalized.split('/').pop();
    return filename ? `/covers/${encodeURIComponent(filename)}` : '';
}

export function buildPublicArtistUrl({ artistPublicId, artistName }) {
    const pid = safeText(artistPublicId).trim().toLowerCase();
    const slug = slugify(artistName);
    if (!/^[a-f0-9]{32}$/.test(pid)) return '';
    const suffix = slug ? `-${encodeURIComponent(slug)}` : '';
    const path = `/artist/${encodeURIComponent(pid)}${suffix}`;
    return `${getPublicSiteBaseUrl()}${path}`;
}

export function isSafePublicArtistUrl(value) {
    const raw = safeText(value).trim();
    if (!raw) return false;
    try {
        const url = new URL(raw);
        const base = new URL(getPublicSiteBaseUrl());
        if (url.origin !== base.origin) return false;
        return /^\/artist\/[a-f0-9]{32}(?:-|$)/i.test(url.pathname);
    } catch {
        return false;
    }
}

const publicLinks = {
    coverUrlFromPath,
    buildPublicArtistUrl,
    isSafePublicArtistUrl,
};

export default publicLinks;
