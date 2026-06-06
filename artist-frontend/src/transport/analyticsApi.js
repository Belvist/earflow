import { httpJson } from './http';

export const analyticsApi = {
    async getAnalytics({ days, topTracks } = {}) {
        const params = new URLSearchParams();
        if (days) params.set('days', String(days));
        if (topTracks) params.set('topTracks', String(topTracks));
        const qs = params.toString();
        const url = `/api/artist-portal/analytics${qs ? `?${qs}` : ''}`;
        return await httpJson(url, { method: 'GET' });
    },
};
