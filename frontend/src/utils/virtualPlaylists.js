export function saveVirtualPlaylist(playlist) {
    const p = playlist && typeof playlist === 'object' ? playlist : null;
    if (!p) return false;

    const id = p.id === undefined || p.id === null ? '' : String(p.id).trim();
    if (!id) return false;

    if (typeof sessionStorage === 'undefined') return false;

    const title = p.title ?? p.name ?? '';
    const description = p.description ?? '';
    const tracks = Array.isArray(p.tracks) ? p.tracks : [];

    const payload = {
        id,
        title: typeof title === 'string' ? title : String(title || ''),
        description: typeof description === 'string' ? description : String(description || ''),
        tracks,
        coverUrl: typeof p.coverUrl === 'string' ? p.coverUrl : null,
        trackCount: typeof p.trackCount === 'number' ? p.trackCount : tracks.length,
        type: typeof p.type === 'string' ? p.type : null,
        isVirtual: true,
        savedAtMs: Date.now(),
    };

    try {
        sessionStorage.setItem(`virtualPlaylist:${id}`, JSON.stringify(payload));
        return true;
    } catch {
        return false;
    }
}

export function loadVirtualPlaylist(id) {
    const key = id === undefined || id === null ? '' : String(id).trim();
    if (!key) return null;
    if (typeof sessionStorage === 'undefined') return null;

    try {
        const raw = sessionStorage.getItem(`virtualPlaylist:${key}`);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        const pid = parsed.id === undefined || parsed.id === null ? '' : String(parsed.id).trim();
        if (!pid || pid !== key) return null;
        if (!Array.isArray(parsed.tracks)) return null;
        return parsed;
    } catch {
        return null;
    }
}

export function deleteVirtualPlaylist(id) {
    const key = id === undefined || id === null ? '' : String(id).trim();
    if (!key) return;
    if (typeof sessionStorage === 'undefined') return;
    try {
        sessionStorage.removeItem(`virtualPlaylist:${key}`);
    } catch {
    }
}
