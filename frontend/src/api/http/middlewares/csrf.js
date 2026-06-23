const isSafeMethod = (method) => {
    const m = String(method || 'GET').toUpperCase();
    return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
};

export const createCsrfMiddleware = (deps = {}) => {
    const getCsrfToken = typeof deps.getCsrfToken === 'function' ? deps.getCsrfToken : null;
    const ensureCsrfCookie = typeof deps.ensureCsrfCookie === 'function' ? deps.ensureCsrfCookie : null;

    return async (ctx, next) => {
        if (ctx?.meta?.skipCsrf) {
            return await next(ctx);
        }

        if (isSafeMethod(ctx?.method)) {
            return await next(ctx);
        }

        let csrf = null;
        try {
            csrf = getCsrfToken?.() || null;
        } catch {
            csrf = null;
        }

        if (!csrf) {
            try {
                csrf = (await ensureCsrfCookie?.()) || null;
            } catch {
                csrf = null;
            }
        }

        if (!csrf) {
            return await next(ctx);
        }

        return await next({
            ...ctx,
            headers: {
                ...(ctx.headers || {}),
                'X-CSRF-Token': csrf,
            },
        });
    };
};
