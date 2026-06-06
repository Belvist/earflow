import { AuthExpiredError, HttpError } from '../../errors';
import { readJsonSafely } from '../readJsonSafely';
import { attachLegacyStatusFields, normalizeHttpStatus } from '../legacyStatus';

export const throwApiErrorsMiddleware = async (ctx, next) => {
    const resp = await next(ctx);

    if (!resp) {
        throw attachLegacyStatusFields(new HttpError(0), 0);
    }

    if (resp.ok) {
        return resp;
    }

    const st = normalizeHttpStatus(resp.status);
    const details = await readJsonSafely(resp.clone());

    if (st === 401) {
        throw attachLegacyStatusFields(new AuthExpiredError(st, { details }), st);
    }

    throw attachLegacyStatusFields(new HttpError(st, { details }), st);
};
