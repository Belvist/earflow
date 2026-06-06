import { readJsonSafely } from '../readJsonSafely';

const isSafeMethod = (method) => {
    const m = String(method || 'GET').toUpperCase();
    return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
};

export const createCsrfRetryOn403Middleware = (deps = {}) => {
    const ensureCsrfCookie = typeof deps.ensureCsrfCookie === 'function' ? deps.ensureCsrfCookie : null;

    return async (ctx, next) => {
        const resp = await next(ctx);

        if (resp?.status !== 403) {
            return resp;
        }

        if (ctx?.meta?.skipCsrf) {
            return resp;
        }

        if (isSafeMethod(ctx?.method)) {
            return resp;
        }

        if (ctx?.meta?._retriedAfterCsrf) {
            return resp;
        }

        let shouldRetry = false;
        try {
            const details = await readJsonSafely(resp.clone());
            const code = details && typeof details === 'object' && typeof details.code === 'string' ? details.code : '';
            shouldRetry = code === 'CSRF_MISSING' || code === 'CSRF_INVALID';
        } catch {
            shouldRetry = false;
        }

        if (!shouldRetry) {
            return resp;
        }

        let csrf = null;
        try {
            csrf = (await ensureCsrfCookie?.({ force: true })) || null;
        } catch {
            csrf = null;
        }

        if (!csrf) {
            return resp;
        }

        const meta = ctx?.meta && typeof ctx.meta === 'object'
            ? { ...ctx.meta, _retriedAfterCsrf: true }
            : { _retriedAfterCsrf: true };
        const headers = ctx?.headers && typeof ctx.headers === 'object'
            ? { ...ctx.headers, 'X-CSRF-Token': csrf }
            : { 'X-CSRF-Token': csrf };

        return await next({ ...ctx, meta, headers });
    };
};
