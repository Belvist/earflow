const MAIN_CSRF_COOKIE = 'mp_csrf';
const ARTIST_CSRF_COOKIE = 'mp_csrf_artists';
const MAIN_SID_COOKIE = 'mp_sid';
const ARTIST_SID_COOKIE = 'mp_sid_artists';

export const AUTH_CONTOUR_MAIN = 'main';
export const AUTH_CONTOUR_ARTIST = 'artist';

export function getAuthContour() {
    try {
        const host = String(window?.location?.hostname || '').toLowerCase();
        if (host === 'artists.earflow.ru' || host.endsWith('.artists.earflow.ru')) {
            return AUTH_CONTOUR_ARTIST;
        }
    } catch {
    }
    return AUTH_CONTOUR_MAIN;
}

export function getCookieValue(name) {
    try {
        if (typeof document === 'undefined') return null;
        const target = String(name || '').trim();
        if (!target) return null;

        const cookie = document.cookie;
        if (!cookie) return null;

        const parts = cookie.split(';');
        for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed) continue;
            const eq = trimmed.indexOf('=');
            if (eq <= 0) continue;

            const key = trimmed.slice(0, eq).trim();
            if (key !== target) continue;

            const value = trimmed.slice(eq + 1);
            try {
                return decodeURIComponent(value);
            } catch {
                return value;
            }
        }
    } catch {
    }
    return null;
}

export function getCsrfCookieName(contour = getAuthContour()) {
    return contour === AUTH_CONTOUR_ARTIST ? ARTIST_CSRF_COOKIE : MAIN_CSRF_COOKIE;
}

export function getSidCookieName(contour = getAuthContour()) {
    return contour === AUTH_CONTOUR_ARTIST ? ARTIST_SID_COOKIE : MAIN_SID_COOKIE;
}

export function getCsrfToken(contour = getAuthContour()) {
    return getCookieValue(getCsrfCookieName(contour));
}

export function hasSessionCookie(contour = getAuthContour()) {
    return !!getCookieValue(getSidCookieName(contour));
}
