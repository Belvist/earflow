import { artistClaimsApi } from '../transport/artistClaimsApi';
import { classifyApiError } from './apiError';

export const artistClaimsUsecase = {
    async searchArtists({ q }) {
        try {
            const data = await artistClaimsApi.searchArtists({ q });
            const items = Array.isArray(data) ? data : [];
            return { ok: true, data: items };
        } catch (e) {
            return { ok: false, error: classifyApiError(e) };
        }
    },

    async listMyClaims({ status } = {}) {
        try {
            const data = await artistClaimsApi.listMyClaims({ status });
            const items = Array.isArray(data) ? data : [];
            return { ok: true, data: items };
        } catch (e) {
            return { ok: false, error: classifyApiError(e) };
        }
    },

    async createClaim({ artist, note }) {
        try {
            const data = await artistClaimsApi.createClaim({ artist, note });
            return { ok: true, data };
        } catch (e) {
            return { ok: false, error: classifyApiError(e) };
        }
    },
};
