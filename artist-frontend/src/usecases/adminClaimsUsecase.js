import { adminClaimsApi } from '../transport/adminClaimsApi';
import { classifyApiError } from './apiError';

export const adminClaimsUsecase = {
    async listClaims({ status, limit, offset } = {}) {
        try {
            const data = await adminClaimsApi.listClaims({ status, limit, offset });
            const items = Array.isArray(data) ? data : [];
            return { ok: true, data: items };
        } catch (e) {
            return { ok: false, error: classifyApiError(e) };
        }
    },

    async reviewClaim({ id, action, reason } = {}) {
        try {
            const data = await adminClaimsApi.reviewClaim({ id, action, reason });
            return { ok: true, data };
        } catch (e) {
            return { ok: false, error: classifyApiError(e) };
        }
    },
};
