'use strict';

function escapeXmlText(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function normalizeIsoDateOrNull(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function buildSitemapXml(urls) {
    const entries = (Array.isArray(urls) ? urls : [])
        .filter((u) => u && typeof u === 'object' && typeof u.loc === 'string' && u.loc)
        .map((u) => {
            const loc = escapeXmlText(u.loc);
            const lastmod = u.lastmod ? escapeXmlText(u.lastmod) : null;

            const parts = [];
            parts.push('  <url>');
            parts.push(`    <loc>${loc}</loc>`);
            if (lastmod) parts.push(`    <lastmod>${lastmod}</lastmod>`);
            parts.push('  </url>');
            return parts.join('\n');
        });

    const header = '<?xml version="1.0" encoding="UTF-8"?>';
    const open = '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
    const close = '</urlset>';
    return [header, open, ...entries, close].join('\n') + '\n';
}

module.exports = {
    buildSitemapXml,
    normalizeIsoDateOrNull,
};
