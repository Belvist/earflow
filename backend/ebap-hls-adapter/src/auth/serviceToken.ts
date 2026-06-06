import { base64UrlToBytes } from '../lib/base64';

type ServiceTokenManagerConfig = {
    endpoint: string;
    serviceName: string;
    serviceKey: string;
};

type CachedToken = {
    token: string;
    expMs: number;
};

function decodeBase64UrlToString(b64u: string): string {
    const bytes = base64UrlToBytes(String(b64u || ''));
    if (!bytes || bytes.byteLength === 0) return '';
    try {
        return new TextDecoder().decode(bytes);
    } catch {
        return '';
    }
}

function parseJwtExpMs(token: string): number {
    const t = String(token || '').trim();
    const parts = t.split('.');
    if (parts.length < 2) return 0;
    const payloadText = decodeBase64UrlToString(parts[1] ?? '');
    if (!payloadText) return 0;
    try {
        const payload = JSON.parse(payloadText);
        const expSec = Number(payload?.exp);
        if (!Number.isFinite(expSec) || expSec <= 0) return 0;
        return expSec * 1000;
    } catch {
        return 0;
    }
}

async function fetchJsonWithTimeout(params: {
    url: string;
    timeoutMs: number;
    body: unknown;
}): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1, Math.trunc(params.timeoutMs)));

    try {
        const res = await fetch(params.url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(params.body ?? {}),
            signal: controller.signal,
        });
        if (!res.ok) {
            let snippet = '';
            try {
                snippet = String(await res.text()).slice(0, 512);
            } catch {
                snippet = '';
            }
            const err: any = new Error(`SERVICE_TOKEN_REQUEST_FAILED:${res.status}`);
            err.status = res.status;
            err.body = snippet;
            throw err;
        }
        return await res.json();
    } finally {
        clearTimeout(timeout);
    }
}

export function createServiceTokenManager(cfg: ServiceTokenManagerConfig) {
    let cached: CachedToken | null = null;
    let inFlight: Promise<string> | null = null;

    const getToken = async (): Promise<string> => {
        const now = Date.now();
        if (cached?.token && cached.expMs - now > 10_000) {
            return cached.token;
        }

        if (inFlight) return await inFlight;

        inFlight = (async () => {
            const endpoint = String(cfg.endpoint || '').trim();
            const serviceName = String(cfg.serviceName || '').trim();
            const serviceKey = String(cfg.serviceKey || '').trim();

            if (!endpoint || !serviceName || !serviceKey || serviceKey.length < 32) {
                throw new Error('SERVICE_TOKEN_MANAGER_MISCONFIGURED');
            }

            const data = await fetchJsonWithTimeout({
                url: endpoint,
                timeoutMs: 5000,
                body: { serviceName, serviceKey },
            });

            const token = data && typeof data.token === 'string' ? String(data.token).trim() : '';
            if (!token) {
                throw new Error('EMPTY_SERVICE_TOKEN');
            }

            const expMs = parseJwtExpMs(token) || (Date.now() + 5 * 60_000);
            cached = { token, expMs };
            return token;
        })();

        try {
            return await inFlight;
        } finally {
            inFlight = null;
        }
    };

    return { getToken };
}
