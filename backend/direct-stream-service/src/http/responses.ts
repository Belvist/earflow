export function json(status: number, data: unknown, headers?: Record<string, string>): Response {
    const h = new Headers(headers);
    if (!h.has('content-type')) h.set('content-type', 'application/json; charset=utf-8');
    return new Response(JSON.stringify(data), { status, headers: h });
}

export function gzipJson(status: number, data: unknown, headers?: Record<string, string>): Response {
    const h = new Headers(headers);
    h.set('content-type', 'application/json; charset=utf-8');
    h.set('content-encoding', 'gzip');
    const raw = JSON.stringify(data);
    const compressed = Bun.gzipSync(raw);
    return new Response(compressed, { status, headers: h });
}

export function text(status: number, body: string, headers?: Record<string, string>): Response {
    const h = new Headers(headers);
    if (!h.has('content-type')) h.set('content-type', 'text/plain; charset=utf-8');
    return new Response(body, { status, headers: h });
}

export function empty(status: number, headers?: Record<string, string>): Response {
    return new Response(null, { status, headers });
}
