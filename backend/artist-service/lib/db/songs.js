'use strict';

const { query } = require('./pool');

const { slugifyForRoute } = require('../sitemap/slugify');

/**
 * Треки для sitemap: id + title + artist + updated_at.
 * Только доступные (is_available), чтобы sitemap не вёл на 404.
 */
async function listSongsForSitemap({ limit, offset } = {}) {
    const lim = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.min(Number(limit), 50000) : 5000;
    const off = Number.isFinite(Number(offset)) && Number(offset) > 0 ? Number(offset) : 0;

    const result = await query(
        `SELECT id, title, artist, updated_at
           FROM songs
          WHERE is_available = true
            AND title IS NOT NULL AND btrim(title) <> ''
          ORDER BY updated_at DESC NULLS LAST, id DESC
          LIMIT $1 OFFSET $2`,
        [lim, off]
    );

    return (result.rows || []).map((r) => {
        const id = Number(r.id);
        if (!Number.isFinite(id) || id <= 0) return null;
        const title = r.title ? String(r.title) : '';
        const artist = r.artist ? String(r.artist) : '';
        const slug = slugifyForRoute(artist ? `${title}-${artist}` : title);
        return {
            id,
            title,
            artist,
            slug,
            updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
        };
    }).filter(Boolean);
}

module.exports = {
    listSongsForSitemap,
};
