import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, '..');
const catalogPath = path.join(frontendRoot, 'src', 'seo', 'musicSeoCatalog.json');
const sitemapPath = path.join(frontendRoot, 'public', 'sitemap.xml');
const baseUrl = normalizeBaseUrl(process.env.REACT_APP_PUBLIC_ORIGIN || process.env.PUBLIC_ORIGIN || 'https://earflow.ru');

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

const staticEntries = [
  { path: '/', priority: '1.00', changefreq: 'daily' },
  { path: '/music', priority: '0.90', changefreq: 'weekly' },
  { path: '/artists/popular', priority: '0.78', changefreq: 'daily' },
  { path: '/about', priority: '0.45', changefreq: 'monthly' },
  { path: '/privacy', priority: '0.25', changefreq: 'yearly' },
  { path: '/cookies', priority: '0.25', changefreq: 'yearly' },
  { path: '/security', priority: '0.25', changefreq: 'yearly' },
];

const musicEntries = flattenTopics(catalog)
  .flatMap((topic) => [
    { path: `/music/${topic.slug}`, priority: '0.82', changefreq: 'weekly' },
    ...flattenIntents(catalog).map((intent) => ({
      path: `/music/${topic.slug}/${intent.slug}`,
      priority: '0.74',
      changefreq: 'weekly',
    })),
  ]);

const entries = dedupeEntries([...staticEntries, ...musicEntries]);

const xml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...entries.flatMap((entry) => [
    '  <url>',
    `    <loc>${escapeXml(`${baseUrl}${entry.path}`)}</loc>`,
    `    <changefreq>${entry.changefreq}</changefreq>`,
    `    <priority>${entry.priority}</priority>`,
    '  </url>',
  ]),
  '</urlset>',
  '',
].join('\n');

fs.writeFileSync(sitemapPath, xml, 'utf8');
process.stdout.write(`Generated ${entries.length} sitemap URLs at ${sitemapPath}\n`);

function flattenTopics(value) {
  return (value.groups || [])
    .flatMap((group) => group.topics || [])
    .filter((topic) => topic && typeof topic.slug === 'string' && topic.slug.trim())
    .map((topic) => ({ ...topic, slug: topic.slug.trim().toLowerCase() }));
}

function flattenIntents(value) {
  return (value.intents || [])
    .filter((intent) => intent && typeof intent.slug === 'string' && intent.slug.trim())
    .map((intent) => ({ ...intent, slug: intent.slug.trim().toLowerCase() }));
}

function dedupeEntries(list) {
  const seen = new Set();
  const out = [];
  for (const entry of list) {
    const normalizedPath = normalizePath(entry.path);
    if (!normalizedPath || seen.has(normalizedPath)) continue;
    seen.add(normalizedPath);
    out.push({ ...entry, path: normalizedPath });
  }
  return out;
}

function normalizePath(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.startsWith('/') ? text : `/${text}`;
}

function normalizeBaseUrl(value) {
  const text = String(value || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(text)) return 'https://earflow.ru';
  return text;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
