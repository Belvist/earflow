import { HttpError, NetworkError, TimeoutError, ValidationError, isAbortError } from './errors';
import { composeMiddlewares } from './http/compose';

const isSafeMethod = (method) => {
    const m = String(method || 'GET').toUpperCase();
    return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
};

const normalizeDedupeHeaders = (headers, opts = {}) => {
    const src = headers && typeof headers === 'object' ? headers : {};
    const ignore = new Set([
        'x-correlation-id',
        'x-request-id',
        'x-amzn-trace-id',
        'traceparent',
        'tracestate',
        'date',
    ]);

    const allow = Array.isArray(opts.allowlist) ? opts.allowlist : null;
    const extraIgnore = Array.isArray(opts.ignorelist) ? opts.ignorelist : null;

    if (extraIgnore) {
        for (const k of extraIgnore) {
            ignore.add(String(k).toLowerCase());
        }
    }

    const allowSet = allow ? new Set(allow.map((k) => String(k).toLowerCase())) : null;

    const out = [];
    for (const rawKey of Object.keys(src)) {
        const k = String(rawKey).toLowerCase();
        if (ignore.has(k)) continue;
        if (allowSet && !allowSet.has(k)) continue;
        const v = src[rawKey];
        if (v === undefined || v === null) continue;
        out.push([k, String(v)]);
    }

    out.sort((a, b) => (a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : (a[1] < b[1] ? -1 : (a[1] > b[1] ? 1 : 0)))));
    return out;
};

const decodeText = (buf, contentType) => {
    try {
        const ct = String(contentType || '').toLowerCase();
        const m = ct.match(/charset\s*=\s*([^;]+)/);
        const charset = m ? String(m[1]).trim() : 'utf-8';
        const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder(charset) : null;
        if (!decoder) {
            return '';
        }
        return decoder.decode(buf);
    } catch {
        try {
            const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;
            return decoder ? decoder.decode(buf) : '';
        } catch {
            return '';
        }
    }
};

const parseJsonFromBufferSafely = (buf, contentType) => {
    try {
        if (!buf) return null;
        const text = decodeText(buf, contentType);
        if (!text) return null;
        return JSON.parse(text);
    } catch {
        return null;
    }
};

const isRetriableStatus = (status) => {
    const st = Number(status);
    if (!Number.isFinite(st)) return false;
    if (st === 408) return true;
    if (st === 429) return true;
    return st >= 500 && st <= 599;
};

const computeBackoffDelayMs = (attempt, baseDelayMs, maxDelayMs) => {
    const a = Number(attempt);
    const exp = Math.pow(2, Math.max(0, (Number.isFinite(a) ? a : 1) - 1));
    const jitter = Math.floor(Math.random() * 100);
    return Math.min(maxDelayMs, baseDelayMs * exp + jitter);
};

const normalizeRetryOptions = (retry) => {
    const r = retry && typeof retry === 'object' ? retry : {};
    const maxAttemptsRaw = Number(r.maxAttempts);
    const maxAttempts = Number.isFinite(maxAttemptsRaw) && maxAttemptsRaw > 0 ? (maxAttemptsRaw | 0) : 1;
    const baseDelayMsRaw = Number(r.baseDelayMs);
    const baseDelayMs = Number.isFinite(baseDelayMsRaw) && baseDelayMsRaw > 0 ? baseDelayMsRaw : 250;
    const maxDelayMsRaw = Number(r.maxDelayMs);
    const maxDelayMs = Number.isFinite(maxDelayMsRaw) && maxDelayMsRaw > 0 ? maxDelayMsRaw : 2500;
    return {
        enabled: r.enabled === true,
        maxAttempts,
        baseDelayMs,
        maxDelayMs,
    };
};

const shouldRetryAttempt = (params) => {
    const allow = !!params.allowRetry;
    if (!allow) return false;
    if (!params.safe) return false;
    return params.attempt < params.maxAttempts;
};

const sleepMs = (ms, signal) => new Promise((resolve, reject) => {
    const delay = Number(ms);
    const t = Number.isFinite(delay) && delay > 0 ? delay : 0;
    if (!t) {
        resolve();
        return;
    }

    const createAbortError = () => {
        if (typeof DOMException !== 'undefined') {
            return new DOMException('Aborted', 'AbortError');
        }
        const e = new Error('Aborted');
        e.name = 'AbortError';
        return e;
    };

    if (signal?.aborted) {
        reject(createAbortError());
        return;
    }
    const id = setTimeout(() => {
        cleanup();
        resolve();
    }, t);
    const onAbort = () => {
        clearTimeout(id);
        cleanup();
        reject(createAbortError());
    };
    const cleanup = () => {
        if (signal) {
            try {
                signal.removeEventListener('abort', onAbort);
            } catch {
            }
        }
    };
    if (signal) {
        try {
            signal.addEventListener('abort', onAbort, { once: true });
        } catch {
        }
    }
});

const combineAbortSignals = (parent, timeoutMs) => {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (!controller) {
        return { signal: parent, cancel: () => undefined, didTimeout: () => false };
    }

    let timeoutId = 0;
    let timedOut = false;

    const abort = () => {
        try {
            controller.abort();
        } catch {
        }
    };

    const t = Number(timeoutMs);
    if (Number.isFinite(t) && t > 0) {
        timeoutId = setTimeout(() => {
            timedOut = true;
            abort();
        }, t);
    }

    const cancel = () => {
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = 0;
        }
        if (parent) {
            try {
                parent.removeEventListener('abort', onParentAbort);
            } catch {
            }
        }
    };

    const onParentAbort = () => {
        timedOut = false;
        abort();
    };

    if (parent) {
        if (parent.aborted) {
            abort();
        } else {
            try {
                parent.addEventListener('abort', onParentAbort, { once: true });
            } catch {
            }
        }
    }

    return { signal: controller.signal, cancel, didTimeout: () => timedOut };
};

export class HttpClient {
    constructor(options = {}) {
        const timeoutMs = Number(options.defaultTimeoutMs);
        this._defaultTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15_000;

        const middlewares = Array.isArray(options.middlewares) ? options.middlewares : [];
        this._handler = composeMiddlewares(middlewares, async (ctx) => {
            return await this._requestRawTerminal(ctx);
        });

        this._inFlightJson = new Map();
    }

    async requestRaw(params) {
        const url = String(params?.url || '');
        if (!url) {
            throw new Error('HTTP_CLIENT_MISSING_URL');
        }

        const method = String(params?.method || 'GET').toUpperCase();
        const headers = params?.headers && typeof params.headers === 'object' ? params.headers : {};
        const body = params?.body;
        const credentials = params?.credentials || 'include';
        const cache = params?.cache;
        const signal = params?.signal;
        const meta = params?.meta && typeof params.meta === 'object' ? params.meta : {};

        const retry = normalizeRetryOptions(params?.retry);
        const timeoutMs = params?.timeoutMs === undefined ? this._defaultTimeoutMs : Number(params.timeoutMs);

        return await this._handler({
            url,
            method,
            headers,
            body,
            credentials,
            cache,
            signal,
            timeoutMs,
            retry,
            meta,
        });
    }

    async _requestRawTerminal(ctx) {
        const url = String(ctx?.url || '');
        if (!url) {
            throw new Error('HTTP_CLIENT_MISSING_URL');
        }

        const method = String(ctx?.method || 'GET').toUpperCase();
        const headers = ctx?.headers && typeof ctx.headers === 'object' ? ctx.headers : {};
        const body = ctx?.body;
        const credentials = ctx?.credentials || 'include';
        const cache = ctx?.cache;
        const signal = ctx?.signal;

        const retry = normalizeRetryOptions(ctx?.retry);
        const safe = isSafeMethod(method);
        const timeoutMs = ctx?.timeoutMs === undefined ? this._defaultTimeoutMs : Number(ctx.timeoutMs);

        const offline = (() => {
            try {
                return typeof navigator !== 'undefined' && navigator && navigator.onLine === false;
            } catch {
                return false;
            }
        })();

        if (offline) {
            throw new NetworkError({ details: { url, method, offline: true } });
        }

        let lastErr = null;

        for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
            const { signal: effectiveSignal, cancel, didTimeout } = combineAbortSignals(signal, timeoutMs);

            try {
                const resp = await fetch(url, {
                    method,
                    headers,
                    body,
                    credentials,
                    cache,
                    signal: effectiveSignal,
                });

                cancel();

                if (isRetriableStatus(resp.status) && shouldRetryAttempt({
                    allowRetry: retry.enabled,
                    safe,
                    attempt,
                    maxAttempts: retry.maxAttempts,
                })) {
                    const delay = computeBackoffDelayMs(attempt, retry.baseDelayMs, retry.maxDelayMs);
                    await sleepMs(delay, signal);
                    continue;
                }

                return resp;
            } catch (e) {
                cancel();
                if (isAbortError(e)) {
                    if (signal?.aborted) {
                        throw e;
                    }
                    if (didTimeout()) {
                        throw new TimeoutError({ details: { url, method } });
                    }
                    lastErr = e;
                    if (shouldRetryAttempt({
                        allowRetry: retry.enabled,
                        safe,
                        attempt,
                        maxAttempts: retry.maxAttempts,
                    })) {
                        const delay = computeBackoffDelayMs(attempt, retry.baseDelayMs, retry.maxDelayMs);
                        await sleepMs(delay, signal);
                        continue;
                    }
                    throw new NetworkError({ details: { url, method } });
                }

                lastErr = e;

                if (shouldRetryAttempt({
                    allowRetry: retry.enabled,
                    safe,
                    attempt,
                    maxAttempts: retry.maxAttempts,
                })) {
                    const delay = computeBackoffDelayMs(attempt, retry.baseDelayMs, retry.maxDelayMs);
                    await sleepMs(delay, signal);
                    continue;
                }

                throw new NetworkError({ details: { url, method } });
            }
        }

        if (lastErr) {
            throw new NetworkError({ details: { url, method } });
        }

        throw new NetworkError({ details: { url, method } });
    }

    async requestJson(params) {
        const url = String(params?.url || '');
        const method = String(params?.method || 'GET').toUpperCase();
        const safe = isSafeMethod(method);
        const dedupe = params?.dedupe === undefined ? (safe && params?.body === undefined) : !!params.dedupe;

        const timeoutMs = params?.timeoutMs === undefined ? this._defaultTimeoutMs : Number(params.timeoutMs);
        const retry = normalizeRetryOptions(params?.retry);
        const cache = params?.cache;
        const credentials = params?.credentials || 'include';
        const headers = params?.headers && typeof params.headers === 'object' ? params.headers : {};
        const schema = params?.schema;
        const fallback = params?.fallback;
        const onValidationError = typeof params?.onValidationError === 'function' ? params.onValidationError : null;

        const key = dedupe ? (() => {
            const normHeaders = normalizeDedupeHeaders(headers, {
                allowlist: params?.dedupeHeaderAllowlist,
                ignorelist: params?.dedupeHeaderIgnorelist,
            });
            return JSON.stringify({
                url,
                method,
                cache: cache || null,
                credentials,
                timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : null,
                retry,
                headers: normHeaders,
            });
        })() : '';

        const load = async () => {
            const resp = await this.requestRaw({
                ...params,
                url,
                method,
                headers,
                cache,
                credentials,
                timeoutMs,
                retry,
            });

            const buf = await resp.arrayBuffer();
            const contentType = resp.headers?.get?.('content-type') || '';
            const data = String(contentType).includes('application/json')
                ? parseJsonFromBufferSafely(buf, contentType)
                : null;

            if (!resp.ok) {
                throw new HttpError(resp.status, { details: data });
            }

            const headerEntries = (() => {
                try {
                    return Array.from(resp.headers.entries());
                } catch {
                    return [];
                }
            })();

            return {
                status: resp.status,
                headers: headerEntries,
                buffer: buf,
                data,
            };
        };

        const shared = (() => {
            if (!key) {
                return load();
            }
            const existing = this._inFlightJson.get(key);
            if (existing) {
                return existing;
            }
            const p = load().finally(() => {
                this._inFlightJson.delete(key);
            });
            this._inFlightJson.set(key, p);
            return p;
        })();

        const result = await shared;
        const cloneData = (() => {
            try {
                if (typeof structuredClone === 'function') {
                    return structuredClone(result.data);
                }
            } catch {
            }
            return result.data;
        })();

        const validated = (() => {
            if (!schema) return { ok: true, value: cloneData };
            try {
                if (typeof schema === 'function') {
                    return { ok: true, value: schema(cloneData) };
                }
                if (schema && typeof schema.parse === 'function') {
                    return { ok: true, value: schema.parse(cloneData) };
                }
                if (schema && typeof schema.validate === 'function') {
                    return { ok: true, value: schema.validate(cloneData) };
                }
            } catch (e) {
                return { ok: false, err: e };
            }
            return { ok: false, err: new Error('HTTP_CLIENT_INVALID_SCHEMA') };
        })();

        if (!validated.ok) {
            try {
                onValidationError?.({
                    url,
                    method,
                    error: validated.err,
                    correlationId: params?.meta?.correlationId,
                });
            } catch {
            }

            if (fallback !== undefined) {
                const resp = new Response(result.buffer.slice(0), {
                    status: result.status,
                    headers: result.headers,
                });
                return { response: resp, data: fallback };
            }

            throw new ValidationError({ details: { url, method } });
        }

        const response = new Response(result.buffer.slice(0), {
            status: result.status,
            headers: result.headers,
        });

        return { response, data: validated.value };
    }
}
