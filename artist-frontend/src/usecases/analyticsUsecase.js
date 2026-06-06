import { analyticsApi } from '../transport/analyticsApi';
import { classifyApiError } from './apiError';

export const analyticsUsecase = {
    async loadAnalytics(options = {}) {
        try {
            const data = await analyticsApi.getAnalytics(options);
            return { ok: true, data };
        } catch (e) {
            return { ok: false, error: classifyApiError(e) };
        }
    },
};
