export function parseCookies(cookieHeader: string | null): Record<string, string> {
    if (!cookieHeader) return {};
    const out: Record<string, string> = {};

    const parts = cookieHeader.split(';');
    for (const part of parts) {
        const idx = part.indexOf('=');
        if (idx <= 0) continue;
        const name = part.slice(0, idx).trim();
        if (!name) continue;
        const value = part.slice(idx + 1).trim();
        if (value.length === 0) continue;
        if (out[name] !== undefined) continue;
        out[name] = value;
    }

    return out;
}

export function serializeCookie(params: {
    name: string;
    value: string;
    maxAgeSeconds?: number;
    domain?: string | null;
    path?: string;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'lax' | 'strict' | 'none';
}): string {
    const parts: string[] = [];
    parts.push(`${params.name}=${params.value}`);

    if (Number.isFinite(params.maxAgeSeconds) && typeof params.maxAgeSeconds === 'number' && params.maxAgeSeconds >= 0) {
        parts.push(`Max-Age=${Math.trunc(params.maxAgeSeconds)}`);
    }

    if (params.domain) {
        parts.push(`Domain=${params.domain}`);
    }

    parts.push(`Path=${params.path ?? '/'}`);

    if (params.httpOnly) parts.push('HttpOnly');
    if (params.secure) parts.push('Secure');
    if (params.sameSite) {
        const v = params.sameSite;
        let s = 'Lax';
        if (v === 'none') s = 'None';
        else if (v === 'strict') s = 'Strict';
        parts.push(`SameSite=${s}`);
    }

    return parts.join('; ');
}
