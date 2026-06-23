import { mfaApi } from '../transport/mfaApi';
import { classifyApiError, toApiError } from './apiError';

export const mfaUsecase = {
    async setup() {
        try {
            const data = await mfaApi.setup();
            return { ok: true, data };
        } catch (e) {
            return { ok: false, error: classifyApiError(e) };
        }
    },

    async enable({ token }) {
        try {
            const data = await mfaApi.enable({ token });
            return { ok: true, data };
        } catch (e) {
            const err = toApiError(e);
            return { ok: false, error: { ...classifyApiError(e), raw: err } };
        }
    },

    async stepUp({ token, recoveryCode }) {
        try {
            const data = await mfaApi.stepUp({ token, recoveryCode });
            return { ok: true, data };
        } catch (e) {
            return { ok: false, error: classifyApiError(e) };
        }
    },
};
