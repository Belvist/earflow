import { asHttpStatus } from '../../errors';

const isRecoverableAuthError = (err) => {
    if (!err || typeof err !== 'object') return false;
    if (err.recoverable === true) return true;
    const code = typeof err.code === 'string' ? err.code.trim().toUpperCase() : '';
    return code === 'AUTH_UNAVAILABLE' || code === 'SESSION_UNVERIFIED';
};

export const createAuthRefreshMiddleware = (deps = {}) => {
    const refreshSession = typeof deps.refreshSession === 'function' ? deps.refreshSession : null;
    const shouldBroadcastAuthLost = typeof deps.shouldBroadcastAuthLost === 'function' ? deps.shouldBroadcastAuthLost : null;
    const handleAuthLost = typeof deps.handleAuthLost === 'function' ? deps.handleAuthLost : null;

    const shouldHandle401 = (ctx) => {
        if (ctx?.meta?.skipAuth) return false;
        if (ctx?.meta?.skipAuthRefresh) return false;
        if (ctx?.meta?._retriedAfterRefresh) return false;
        return true;
    };

    const retryAfterRefresh = async (ctx, next) => {
        const refreshed = await refreshSession?.({ signal: ctx?.signal });
        if (!refreshed) {
            return null;
        }

        return await next({
            ...ctx,
            meta: {
                ...(ctx.meta || {}),
                _retriedAfterRefresh: true,
            },
        });
    };

    const maybeBroadcastAuthLost = (ctx) => {
        if (ctx?.meta?.skipAuth || ctx?.meta?.suppressAuthLost) return;
        const endpoint = typeof ctx?.meta?.endpoint === 'string' ? ctx.meta.endpoint : '';
        if (!shouldBroadcastAuthLost?.(endpoint)) return;
        try {
            handleAuthLost?.('request');
        } catch {
        }
    };

    return async (ctx, next) => {
        let resp = null;
        try {
            resp = await next(ctx);
        } catch (err) {
            if (asHttpStatus(err) !== 401 || !shouldHandle401(ctx)) {
                throw err;
            }

            let retried = null;
            try {
                retried = await retryAfterRefresh(ctx, next);
            } catch (retryErr) {
                if (asHttpStatus(retryErr) === 401 && !isRecoverableAuthError(retryErr)) {
                    maybeBroadcastAuthLost({
                        ...ctx,
                        meta: {
                            ...(ctx.meta || {}),
                            _retriedAfterRefresh: true,
                        },
                    });
                }
                throw retryErr;
            }
            if (!retried) {
                throw err;
            }
            return retried;
        }

        if (!resp || resp.status !== 401) {
            return resp;
        }

        if (!shouldHandle401(ctx)) {
            if (ctx?.meta?._retriedAfterRefresh) {
                maybeBroadcastAuthLost(ctx);
            }
            return resp;
        }

        const retried = await retryAfterRefresh(ctx, next);
        if (!retried) {
            return resp;
        }
        return retried;
    };
};
