'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const rateLimit = require('express-rate-limit');

const { slugifyForRoute } = require('./slugify');
const { buildSitemapXml, normalizeIsoDateOrNull } = require('./xml');

function createSitemapLimiter({ isProduction }) {
    return rateLimit({
        windowMs: 60 * 1000,
        max: isProduction ? 60 : 500,
        standardHeaders: true,
        legacyHeaders: false,
    });
}

function createEtag(xml) {
    const hash = crypto.createHash('sha256').update(xml).digest('hex');
    return `W/"${hash}"`;
}

function loadMusicSeoUrls(baseUrl) {
    try {
        const catalogPath = process.env.MUSIC_SEO_CATALOG_PATH
            || path.join(__dirname, 'musicSeoCatalog.json');
        const raw = fs.readFileSync(catalogPath, 'utf8');
        const catalog = JSON.parse(raw);

        const topics = [];
        for (const group of Array.isArray(catalog.groups) ? catalog.groups : []) {
            for (const topic of Array.isArray(group.topics) ? group.topics : []) {
                if (topic && typeof topic.slug === 'string' && topic.slug) topics.push(topic.slug);
            }
        }
        const intents = (Array.isArray(catalog.intents) ? catalog.intents : [])
            .map((i) => (i && typeof i.slug === 'string' ? i.slug : ''))
            .filter(Boolean);

        const urls = [`${baseUrl}/music`];
        for (const t of topics) {
            urls.push(`${baseUrl}/music/${t}`);
            for (const i of intents) urls.push(`${baseUrl}/music/${t}/${i}`);
        }
        return urls;
    } catch {
        return [];
    }
}

function createSitemapService({ artistRegistryDb, albumsDb, songsDb, publicBaseUrl, cacheTtlMs }) {
    const baseUrl = String(publicBaseUrl || 'https://earflow.ru').trim().replace(/\/$/, '');
    const ttlMs = Number.isFinite(Number(cacheTtlMs)) ? Number(cacheTtlMs) : 15 * 60 * 1000;
    const musicSeoUrls = loadMusicSeoUrls(baseUrl);

    const cache = {
        xml: null,
        etag: null,
        expiresAt: 0,
    };

    async function buildUrls() {
        const [artists, albums, songs] = await Promise.all([
            artistRegistryDb.listArtistsForSitemap({ limit: 50000, offset: 0 }),
            albumsDb.listAlbumsForSitemap({ limit: 50000, offset: 0 }),
            songsDb && typeof songsDb.listSongsForSitemap === 'function'
                ? songsDb.listSongsForSitemap({ limit: 50000, offset: 0 }).catch(() => [])
                : Promise.resolve([]),
        ]);

        const urls = [];
        urls.push({ loc: `${baseUrl}/`, lastmod: null });
        urls.push({ loc: `${baseUrl}/about`, lastmod: null });

        for (const loc of musicSeoUrls) {
            urls.push({ loc, lastmod: null });
        }

        for (const a of Array.isArray(artists) ? artists : []) {
            const pid = a && a.publicId ? String(a.publicId).trim().toLowerCase() : '';
            if (!pid) continue;
            const name = a && a.name ? String(a.name) : '';
            const slug = slugifyForRoute(name);
            const lastmod = normalizeIsoDateOrNull(a.updatedAt);
            const path = slug ? `/artist/${encodeURIComponent(pid)}-${encodeURIComponent(slug)}` : `/artist/${encodeURIComponent(pid)}`;
            urls.push({ loc: `${baseUrl}${path}`, lastmod });
        }

        for (const alb of Array.isArray(albums) ? albums : []) {
            const pid = alb && alb.albumPublicId ? String(alb.albumPublicId).trim().toLowerCase() : '';
            if (!pid) continue;
            const name = alb && alb.albumName ? String(alb.albumName) : '';
            const slug = slugifyForRoute(name);
            const lastmod = normalizeIsoDateOrNull(alb.updatedAt);
            const path = slug ? `/album/${encodeURIComponent(pid)}-${encodeURIComponent(slug)}` : `/album/${encodeURIComponent(pid)}`;
            urls.push({ loc: `${baseUrl}${path}`, lastmod });
        }

        for (const s of Array.isArray(songs) ? songs : []) {
            const id = s && s.id ? Number(s.id) : 0;
            if (!id) continue;
            const slug = s && s.slug ? String(s.slug) : '';
            const lastmod = normalizeIsoDateOrNull(s.updatedAt);
            const path = slug ? `/track/${id}-${encodeURIComponent(slug)}` : `/track/${id}`;
            urls.push({ loc: `${baseUrl}${path}`, lastmod });
        }

        return urls;
    }

    async function getCached() {
        const now = Date.now();
        if (cache.xml && now < cache.expiresAt) return cache;

        const urls = await buildUrls();
        const xml = buildSitemapXml(urls);
        const etag = createEtag(xml);

        cache.xml = xml;
        cache.etag = etag;
        cache.expiresAt = now + ttlMs;
        return cache;
    }

    return {
        getCached,
    };
}

function registerSitemap(app, { artistRegistryDb, albumsDb, songsDb, isProduction, publicBaseUrl }) {
    const limiter = createSitemapLimiter({ isProduction: !!isProduction });
    const service = createSitemapService({
        artistRegistryDb,
        albumsDb,
        songsDb,
        publicBaseUrl,
        cacheTtlMs: 15 * 60 * 1000,
    });

    app.get('/sitemap.xml', limiter, async (req, res) => {
        try {
            const cache = await service.getCached();
            const inm = typeof req.headers['if-none-match'] === 'string' ? req.headers['if-none-match'] : '';

            res.setHeader('Content-Type', 'application/xml; charset=utf-8');
            res.setHeader('Cache-Control', 'public, max-age=900');
            res.setHeader('ETag', cache.etag);

            if (inm && cache.etag && inm === cache.etag) {
                return res.status(304).end();
            }

            return res.status(200).send(cache.xml);
        } catch {
            return res.status(500).type('text/plain').send('sitemap unavailable');
        }
    });
}

module.exports = {
    registerSitemap,
};
