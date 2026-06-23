export function textResponse(status: number, body: string, headers?: HeadersInit): Response {
    const h = headers instanceof Headers ? headers : new Headers(headers);
    if (!h.has('content-type')) h.set('content-type', 'text/plain; charset=utf-8');
    return new Response(body, { status, headers: h });
}

export function jsonResponse(status: number, body: unknown, headers?: HeadersInit): Response {
    const h = headers instanceof Headers ? headers : new Headers(headers);
    if (!h.has('content-type')) h.set('content-type', 'application/json; charset=utf-8');
    return new Response(JSON.stringify(body), { status, headers: h });
}

export function notFound(): Response {
    return textResponse(404, 'Not found');
}

export function unauthorized(): Response {
    return textResponse(401, 'Unauthorized');
}

export function forbidden(): Response {
    return textResponse(403, 'Forbidden');
}

export function badRequest(msg: string): Response {
    return textResponse(400, msg || 'Bad request');
}

export function serverError(): Response {
    return textResponse(500, 'Internal error');
}
