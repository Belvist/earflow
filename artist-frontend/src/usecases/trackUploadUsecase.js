import { artistPortalApi } from '../transport/artistPortalApi';
import { classifyApiError } from './apiError';

function safeText(v) {
    if (v === null || v === undefined) return '';
    return String(v);
}

function normalizeMeta(meta) {
    const m = meta && typeof meta === 'object' ? meta : {};
    const title = safeText(m.title).trim();
    const artist = safeText(m.artist).trim();
    const album = safeText(m.album).trim();
    const genre = safeText(m.genre).trim();
    const year = safeText(m.year).trim();

    const payload = {};
    if (artist) payload.artist = artist;
    if (title) payload.title = title;
    if (album) payload.album = album;
    if (genre) payload.genre = genre;
    if (year) payload.year = year;

    return payload;
}

export async function uploadTrackWithMeta({ file, meta }) {
    try {
        const up = await artistPortalApi.uploadTrack(file);
        const songId = safeText(up?.id).trim();
        if (!songId) return { ok: true, data: up, metaPatched: false };

        const payload = normalizeMeta(meta);
        if (!Object.keys(payload).length) return { ok: true, data: up, metaPatched: false };

        try {
            await artistPortalApi.updateTrack(songId, payload);
            return { ok: true, data: up, metaPatched: true };
        } catch {
            return { ok: true, data: up, metaPatched: false };
        }
    } catch (e) {
        return { ok: false, error: classifyApiError(e) };
    }
}
