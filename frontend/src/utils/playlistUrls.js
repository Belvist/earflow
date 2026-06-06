export function getAppOrigin() {
    try {
        if (typeof window === 'undefined') return '';
        return typeof window.location?.origin === 'string' ? window.location.origin : '';
    } catch {
        return '';
    }
}

export function buildPlaylistPathFromIdentifier(identifier) {
    const raw = identifier === undefined || identifier === null ? '' : String(identifier).trim();
    if (!raw) return null;
    return `/playlist/${encodeURIComponent(raw)}`;
}

export function buildPlaylistPathFromMixToken(token) {
    const raw = token === undefined || token === null ? '' : String(token).trim();
    if (!raw) return null;
    return `/mix/${encodeURIComponent(raw)}`;
}

export function buildPlaylistSharePathFromSlug(slug) {
    const raw = slug === undefined || slug === null ? '' : String(slug).trim();
    if (!raw) return null;
    return `/p/${encodeURIComponent(raw)}`;
}

export function buildAbsoluteUrlFromPath(path) {
    const p = typeof path === 'string' ? path : '';
    const origin = getAppOrigin();
    if (!origin || !p) return '';
    return `${origin}${p.startsWith('/') ? p : `/${p}`}`;
}

export function buildPlaylistShareUrlFromSlug(slug) {
    const path = buildPlaylistSharePathFromSlug(slug);
    return path ? buildAbsoluteUrlFromPath(path) : '';
}

export function extractPlaylistIdentifier(playlist) {
    const p = playlist && typeof playlist === 'object' ? playlist : null;
    if (!p) return null;

    const shareSlug = p.share_slug ?? p.shareSlug ?? null;
    if (shareSlug) return String(shareSlug);

    const token = p.shareToken ?? p.token ?? p.mixToken ?? null;
    if (token) return String(token);

    const id = p.id ?? p.playlist_id ?? p.playlistId ?? null;
    if (id === 0) return '0';
    if (id) return String(id);

    return null;
}

export function buildPlaylistPathFromPlaylist(playlist) {
    const identifier = extractPlaylistIdentifier(playlist);
    return identifier ? buildPlaylistPathFromIdentifier(identifier) : null;
}

export function buildPlaylistShareUrlFromPlaylist(playlist) {
    const p = playlist && typeof playlist === 'object' ? playlist : null;
    if (!p) return '';
    const slug = p.share_slug ?? p.shareSlug ?? null;
    return buildPlaylistShareUrlFromSlug(slug);
}
