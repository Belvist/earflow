import { getArtistRuntimeConfig } from '../transport/runtimeConfig';

const getCookie = (name) => {
    try {
        const v = typeof document !== 'undefined' ? String(document.cookie || '') : '';
        if (!v) return '';

        const parts = v.split(';');
        let last = '';
        for (const p of parts) {
            const s = p.trim();
            if (!s) continue;
            const idx = s.indexOf('=');
            if (idx <= 0) continue;
            const k = s.slice(0, idx).trim();
            if (k !== name) continue;
            last = s.slice(idx + 1);
        }
        if (!last) return '';
        try {
            return decodeURIComponent(last);
        } catch {
            return last;
        }
    } catch {
        return '';
    }
};

export const getArtistCsrfCookieName = () => {
    try {
        if (typeof window === 'undefined') return 'mp_csrf_artists';
        const cfg = getArtistRuntimeConfig();
        const n = cfg?.csrfCookieName;
        return typeof n === 'string' && n.trim() ? n.trim() : 'mp_csrf_artists';
    } catch {
        return 'mp_csrf_artists';
    }
};

export const getArtistCsrfToken = () => {
    const primary = getArtistCsrfCookieName();
    const v = getCookie(primary);
    if (v) return v;
    if (primary !== 'mp_csrf') {
        return getCookie('mp_csrf');
    }
    return '';
};
