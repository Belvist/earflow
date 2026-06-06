export function safeText(v) {
    if (v === null || v === undefined) return '';
    return String(v);
}

export function formatCompactNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return '0';
    try {
        return new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
    } catch {
        return String(Math.round(n));
    }
}

export function formatDateShort(value) {
    const raw = safeText(value).trim();
    if (!raw) return '—';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    try {
        return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }).format(d);
    } catch {
        return d.toLocaleDateString();
    }
}

export function pluralRu(count, forms) {
    const n = Math.abs(Number(count) || 0) % 100;
    const n1 = n % 10;
    if (n > 10 && n < 20) return forms[2];
    if (n1 > 1 && n1 < 5) return forms[1];
    if (n1 === 1) return forms[0];
    return forms[2];
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
