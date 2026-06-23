import { slugifyForRoute } from './routeSlug';
import { normalizeArtistNameForRoute } from './artist';

export function extractArtistPublicIdFromRouteParam(value) {
    const raw = value === undefined || value === null ? '' : String(value);
    const normalized = raw.normalize('NFC').trim();
    const re = /^([a-f0-9]{32})(?:-(.*))?$/i;
    const m = re.exec(normalized);
    if (!m) return { publicId: '', slug: '' };
    const publicId = String(m[1] || '').toLowerCase();
    const slugRaw = typeof m[2] === 'string' ? m[2] : '';
    const slug = slugifyForRoute(slugRaw);
    return { publicId, slug };
}

export function normalizeArtistParamForApi(value) {
    const raw = value === undefined || value === null ? '' : String(value);
    const normalized = raw.normalize('NFC').trim();
    const { publicId } = extractArtistPublicIdFromRouteParam(normalized);
    if (publicId) return publicId;
    return normalizeArtistNameForRoute(normalized) || normalized;
}

export function buildArtistPath({ artistPublicId, artistName }) {
    const pid = (artistPublicId || '').toString().trim().toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(pid)) return '';
    const name = (artistName || '').toString().normalize('NFC').trim();
    const slug = slugifyForRoute(name);
    if (!slug) return `/artist/${encodeURIComponent(pid)}`;
    return `/artist/${encodeURIComponent(pid)}-${encodeURIComponent(slug)}`;
}

function buildArtistPathFromMeta(meta, fallbackName) {
    const pid = meta && typeof meta.artistPublicId === 'string' ? meta.artistPublicId : '';
    const name = meta && typeof meta.artist === 'string' ? meta.artist : fallbackName;
    return buildArtistPath({ artistPublicId: pid, artistName: name });
}

async function resolveFromPublicId(apiClient, publicId, slug, signal) {
    if (slug) {
        return `/artist/${encodeURIComponent(publicId)}-${encodeURIComponent(slug)}`;
    }

    try {
        const meta = await apiClient.getArtistMeta(publicId, { signal });
        const name = meta && typeof meta.artist === 'string' ? meta.artist : '';
        const path = buildArtistPath({ artistPublicId: publicId, artistName: name });
        return path || `/artist/${encodeURIComponent(publicId)}`;
    } catch {
        return `/artist/${encodeURIComponent(publicId)}`;
    }
}

export async function resolveArtistPath(apiClient, raw, params = {}) {
    const signal = params.signal;
    const input = raw === undefined || raw === null ? '' : String(raw);
    const normalized = input.normalize('NFC').trim();
    if (!normalized) return '';

    const extracted = extractArtistPublicIdFromRouteParam(normalized);
    if (extracted.publicId) {
        return await resolveFromPublicId(apiClient, extracted.publicId, extracted.slug, signal);
    }

    const fallbackName = normalizeArtistNameForRoute(normalized) || normalized;

    try {
        const meta = await apiClient.getArtistMeta(fallbackName, { signal });
        const path = buildArtistPathFromMeta(meta, fallbackName);
        if (path) return path;
    } catch {
    }

    return '';
}
