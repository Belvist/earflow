'use strict';

/**
 * SEO Prerender — headless Chromium для поисковых ботов.
 *
 * Жёсткие правила (INV-SEO-001):
 * - Read-only:   разрешены только GET/HEAD, всё остальное — 405.
 * - Без auth:    Cookie, Authorization, X-CSRF-Token и любые другие
 *                креденшел-хедеры клиента НЕ пробрасываются в Chromium.
 * - Whitelist:   hostname только из PRERENDER_ALLOWED_HOSTS (default frontend:3004).
 * - Таймауты:    навигация 10s, стабилизация DOM 2s max.
 */

const http = require('node:http');
const puppeteer = require('puppeteer');

const PORT = Number(process.env.PORT || 3100);
const ALLOWED_HOSTS = new Set(
    String(process.env.PRERENDER_ALLOWED_HOSTS || 'frontend:3004,localhost:3004')
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean)
);
const NAV_TIMEOUT_MS = Number(process.env.PRERENDER_NAV_TIMEOUT_MS || 5000);
const SETTLE_MS = Number(process.env.PRERENDER_SETTLE_MS || 2500);
const PAGE_CACHE_TTL_MS = Number(process.env.PRERENDER_PAGE_CACHE_TTL_MS || 60 * 1000);
const MAX_CONCURRENT = Number(process.env.PRERENDER_MAX_CONCURRENT || 4);

let browserPromise = null;
let inFlight = 0;

async function getBrowser() {
    if (browserPromise) {
        try {
            const b = await browserPromise;
            if (b.connected !== false) return b;
        } catch {
            /* fall-through: relaunch */
        }
        browserPromise = null;
    }
    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || '';
    const env = { ...process.env };
    // Crashpad workaround: XDG dirs must exist for Chrome's crash_handler.
    // Override to writable /tmp so crashpad can create its database.
    env.XDG_CONFIG_HOME = '/tmp';
    env.XDG_CACHE_HOME = '/tmp';
    browserPromise = puppeteer.launch({
        headless: true,
        ...(executablePath ? { executablePath } : {}),
        env,
        protocolTimeout: 30000,
        timeout: 15000,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--disable-background-networking',
            '--disable-default-apps',
            '--disable-sync',
            '--metrics-recording-only',
            '--mute-audio',
            '--no-first-run',
            '--disable-extensions',
            '--disable-crash-reporter',
            '--disable-crashpad',
            '--disable-breakpad',
            '--no-zygote',
        ],
    }).catch((err) => {
        browserPromise = null;
        throw err;
    });
    return browserPromise;
}

const pageCache = new Map(); // url -> { html, status, expiresAt }

function getCached(url) {
    const hit = pageCache.get(url);
    if (!hit) return null;
    if (Date.now() > hit.expiresAt) {
        pageCache.delete(url);
        return null;
    }
    return hit;
}

function setCached(url, html, status) {
    if (pageCache.size > 100) {
        // простая очистка самого старого
        const first = pageCache.keys().next();
        if (!first.done) pageCache.delete(first.value);
    }
    pageCache.set(url, { html, status, expiresAt: Date.now() + PAGE_CACHE_TTL_MS });
}

async function render(url) {
    const browser = await getBrowser();
    const context = await browser.createBrowserContext();
    let page;
    try {
        page = await context.newPage();
        // domcontentloaded достаточно для SPA с быстрым рендером; networkidle слишком медленный
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
        // Дать React смонтировать SEO-мету (title, meta, JSON-LD)
        await page.evaluate((ms) => new Promise((r) => setTimeout(r, ms)), SETTLE_MS);
        const html = await page.content();
        const status = 200;
        setCached(url, html, status);
        return { html, status };
    } finally {
        try { if (page) await page.close({ runBeforeUnload: false }); } catch { /* */
        }
        try { await context.close(); } catch { /* */
        }
    }
}

function sanitizeHtml(html) {
    let out = html;
    // URL-обфускация API чувствительных эндпоинтов, чтобы боты не индексировали/не ддосили
    out = out.replace(/https?:\/\/[^"'\s]+(auth|graphql|admin|metrics)[^"'\s]*/gi, '/removed');
    // Удаляем inline <script> с данными пользователя/токенами, если попали
    out = out.replace(/<script[^>]*>[\s\S]*?(?:localStorage|sessionStorage|token|authData)[\s\S]*?<\/script>/gi, '<script>/* redacted */</script>');
    return out;
}

async function handleRequest(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', 'Allow': 'GET, HEAD' });
        return res.end('Method Not Allowed');
    }

    const urlParam = req.url.startsWith('/render?url=')
        ? decodeURIComponent(req.url.slice('/render?url='.length))
        : null;

    if (!urlParam) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: 'missing url' }));
    }

    let target;
    try {
        target = new URL(urlParam);
    } catch {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: 'invalid url' }));
    }

    const host = target.host.toLowerCase();
    if (!ALLOWED_HOSTS.has(host)) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: 'forbidden host' }));
    }

    const cacheKey = target.toString();
    const cached = getCached(cacheKey);
    if (cached) {
        res.writeHead(cached.status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' });
        return req.method === 'HEAD' ? res.end() : res.end(cached.html);
    }

    if (inFlight >= MAX_CONCURRENT) {
        // Защита от конкурентного OOM на VPS с малым RAM
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '2' });
        return res.end('Prerender busy — retry');
    }

    inFlight++;
    try {
        const { html, status } = await render(target.toString());
        const safe = sanitizeHtml(html);
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' });
        return req.method === 'HEAD' ? res.end() : res.end(safe);
    } catch (err) {
        const msg = err && err.message ? err.message : 'Prerender failed';
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(`Prerender error: ${msg}`);
    } finally {
        inFlight--;
    }
}

const server = http.createServer((req, res) => {
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('ok');
    }
    if (!req.url.startsWith('/render')) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('not found');
    }
    void handleRequest(req, res);
});

process.on('SIGTERM', async () => {
    server.close(() => process.exit(0));
    try { const b = await browserPromise; if (b) await b.close(); } catch { /* */ }
});

server.listen(PORT, () => {
    console.log(`Prerender server listening on ${PORT}, allowed hosts: ${[...ALLOWED_HOSTS].join(', ')}`);
});
