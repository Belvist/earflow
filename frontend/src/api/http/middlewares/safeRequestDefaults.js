const isSafeMethod = (method) => {
    const m = String(method || 'GET').toUpperCase();
    return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
};

export const safeRequestDefaultsMiddleware = async (ctx, next) => {
    if (!isSafeMethod(ctx?.method)) {
        return await next(ctx);
    }

    const headers = ctx?.headers && typeof ctx.headers === 'object' ? ctx.headers : {};

    const nextHeaders = { ...headers };
    if (!nextHeaders['Cache-Control'] && !nextHeaders['cache-control']) {
        nextHeaders['Cache-Control'] = 'no-store';
    }
    if (!nextHeaders.Pragma && !nextHeaders.pragma) {
        nextHeaders.Pragma = 'no-cache';
    }

    const cache = ctx?.cache === undefined ? 'no-store' : ctx.cache;

    return await next({
        ...ctx,
        cache,
        headers: nextHeaders,
    });
};
