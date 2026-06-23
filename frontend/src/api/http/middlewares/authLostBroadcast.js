import { readJsonSafely } from '../readJsonSafely';

const isRecoverableAuthResponse = async (resp) => {
    const details = await readJsonSafely(resp?.clone?.());
    if (!details || typeof details !== 'object') return false;
    if (details.recoverable === true) return true;
    const code = typeof details.code === 'string' ? details.code.trim().toUpperCase() : '';
    return code === 'AUTH_UNAVAILABLE' || code === 'SESSION_UNVERIFIED';
};

export const createAuthLostBroadcastMiddleware = (deps = {}) => {
    const shouldBroadcastAuthLost = typeof deps.shouldBroadcastAuthLost === 'function' ? deps.shouldBroadcastAuthLost : null;
    const handleAuthLost = typeof deps.handleAuthLost === 'function' ? deps.handleAuthLost : null;

    return async (ctx, next) => {
        const resp = await next(ctx);

        if (resp?.status !== 401) {
            return resp;
        }

        if (!ctx?.meta?._retriedAfterRefresh) {
            return resp;
        }

        if (ctx?.meta?.skipAuth || ctx?.meta?.suppressAuthLost) {
            return resp;
        }

        const endpoint = typeof ctx?.meta?.endpoint === 'string' ? ctx.meta.endpoint : '';
        if (!shouldBroadcastAuthLost?.(endpoint)) {
            return resp;
        }

        if (await isRecoverableAuthResponse(resp)) {
            return resp;
        }

        try {
            handleAuthLost?.('request');
        } catch {
        }

        return resp;
    };
};
