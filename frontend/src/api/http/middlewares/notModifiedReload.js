const isSafeMethod = (method) => {
    const m = String(method || 'GET').toUpperCase();
    return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
};

export const notModifiedReloadMiddleware = async (ctx, next) => {
    const resp = await next(ctx);

    if (!resp || resp.status !== 304) {
        return resp;
    }

    if (!isSafeMethod(ctx?.method)) {
        return resp;
    }

    if (ctx?.meta?._retriedAfterNotModified) {
        return resp;
    }

    return await next({
        ...ctx,
        cache: 'reload',
        headers: {
            ...(ctx.headers || {}),
            'Cache-Control': 'no-cache',
            Pragma: 'no-cache',
        },
        meta: {
            ...(ctx.meta || {}),
            _retriedAfterNotModified: true,
        },
    });
};
