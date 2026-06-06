import { AuthExpiredError } from '../../errors';
import { attachLegacyStatusFields } from '../legacyStatus';

export const createAuthLostGuardMiddleware = (deps = {}) => {
    const isAuthLostActive = typeof deps.isAuthLostActive === 'function' ? deps.isAuthLostActive : null;

    return async (ctx, next) => {
        if (!ctx?.meta?.skipAuth && !ctx?.meta?.suppressAuthLost && isAuthLostActive?.()) {
            throw attachLegacyStatusFields(new AuthExpiredError(401), 401);
        }
        return await next(ctx);
    };
};
