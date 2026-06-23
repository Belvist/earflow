export async function waitForHealthy(params: {
    url: string;
    timeoutMs: number;
    intervalMs: number;
    requestTimeoutMs?: number;
}): Promise<void> {
    const started = Date.now();
    let lastErr: unknown = null;

    const requestTimeoutMs = Math.max(250, Math.floor(params.requestTimeoutMs ?? 1500));

    while (Date.now() - started < params.timeoutMs) {
        try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), requestTimeoutMs);
            try {
                const res = await fetch(params.url, { method: 'GET', signal: ctrl.signal });
                if (res.ok) return;
            } finally {
                clearTimeout(timer);
            }
        } catch (e) {
            lastErr = e;
        }

        await new Promise((r) => setTimeout(r, params.intervalMs));
    }

    const hint = params.url.includes('://api-gateway:') || params.url.includes('://ebap-hls-adapter:')
        ? 'Run via docker network: docker compose --profile tools run --rm integration-tests'
        : '';

    const hintSuffix = hint ? ` (${hint})` : '';

    if (lastErr instanceof Error) {
        throw new Error(`Healthcheck timeout: ${params.url}: ${lastErr.message}${hintSuffix}`);
    }
    throw new Error(`Healthcheck timeout: ${params.url}${hintSuffix}`);
}

export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit | undefined, timeoutMs: number): Promise<Response> {
    const ms = Math.max(250, Math.floor(timeoutMs));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
        const nextInit: RequestInit = init && typeof init === 'object' ? { ...init } : {};
        nextInit.signal = ctrl.signal;
        return await fetch(input, nextInit);
    } finally {
        clearTimeout(timer);
    }
}

export function assertHeader(res: Response, name: string, expected: string): void {
    const v = res.headers.get(name);
    if (v !== expected) {
        throw new Error(`Expected header ${name}=${JSON.stringify(expected)}, got ${JSON.stringify(v)}`);
    }
}

function splitSetCookieCombinedHeader(value: string): string[] {
    const s = String(value || '').trim();
    if (!s) return [];

    const out: string[] = [];
    let start = 0;
    let inExpires = false;

    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === ';') {
            inExpires = false;
            continue;
        }

        if (ch === ',') {
            if (!inExpires) {
                const part = s.slice(start, i).trim();
                if (part) out.push(part);
                start = i + 1;
            }
            continue;
        }

        if (!inExpires && (ch === 'E' || ch === 'e')) {
            const tail = s.slice(i, i + 8).toLowerCase();
            if (tail === 'expires=') {
                inExpires = true;
            }
        }
    }

    const last = s.slice(start).trim();
    if (last) out.push(last);
    return out;
}

export function parseSetCookieHeader(setCookie: string | null): Record<string, string> {
    const out: Record<string, string> = {};
    const raw = String(setCookie || '').trim();
    if (!raw) return out;

    const cookies = splitSetCookieCombinedHeader(raw);
    for (const cookie of cookies) {
        const firstPart = cookie.split(';')[0] || '';
        const idx = firstPart.indexOf('=');
        if (idx <= 0) continue;
        const name = firstPart.slice(0, idx).trim();
        const value = firstPart.slice(idx + 1).trim();
        if (!name || !value) continue;
        out[name] = value;
    }
    return out;
}

export function parseSetCookiesFromHeaders(headers: Headers): Record<string, string> {
    const h: any = headers as any;
    const getSetCookie = typeof h?.getSetCookie === 'function' ? h.getSetCookie.bind(h) : null;
    if (getSetCookie) {
        const values = getSetCookie();
        const list = Array.isArray(values) ? values : [];
        const out: Record<string, string> = {};
        for (const v of list) {
            const parsed = parseSetCookieHeader(typeof v === 'string' ? v : null);
            for (const [k, val] of Object.entries(parsed)) out[k] = val;
        }
        return out;
    }
    return parseSetCookieHeader(headers.get('set-cookie'));
}

export function parseCacheControlDirectives(cacheControl: string | null): Set<string> {
    const raw = String(cacheControl || '').toLowerCase();
    const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
    const out = new Set<string>();
    for (const p of parts) {
        const d = p.split(';')[0]?.trim();
        if (d) out.add(d);
    }
    return out;
}

export function assertCacheControlHas(res: Response, requiredDirectives: string[]): void {
    const v = res.headers.get('cache-control');
    const directives = parseCacheControlDirectives(v);
    for (const req of requiredDirectives) {
        const k = String(req).toLowerCase();
        if (!directives.has(k)) {
            throw new Error(`Expected cache-control to include ${JSON.stringify(k)}, got ${JSON.stringify(v)}`);
        }
    }
}

export function resolvePath(baseUrl: string, pathOrUrl: string): string {
    const s = String(pathOrUrl || '').trim();
    if (!s) throw new Error('Empty url');
    if (s.startsWith('http://') || s.startsWith('https://')) return s;
    const u = new URL(baseUrl);
    return new URL(s.startsWith('/') ? s : '/' + s, u.origin).toString();
}

export function parseM3u8FirstUri(body: string): string {
    const lines = String(body || '').split(/\r?\n/);
    for (const l of lines) {
        const s = l.trim();
        if (!s) continue;
        if (s.startsWith('#')) continue;
        return s;
    }
    throw new Error('No URI found in m3u8');
}

export function parseM3u8InitUri(body: string): string {
    const lines = String(body || '').split(/\r?\n/);
    for (const l of lines) {
        const s = l.trim();
        if (!s.startsWith('#EXT-X-MAP:')) continue;
        const m = s.match(/URI="([^"]+)"/);
        if (m && m[1]) return m[1];
    }
    throw new Error('No EXT-X-MAP URI found');
}

export function parseM3u8FirstSegmentUri(body: string): string {
    const lines = String(body || '').split(/\r?\n/);
    for (const l of lines) {
        const s = l.trim();
        if (!s) continue;
        if (s.startsWith('#')) continue;
        return s;
    }
    throw new Error('No segment URI found');
}
