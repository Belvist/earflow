import { httpJson } from './http';

export const artistClaimsApi = {
    async searchArtists({ q, limit = 25, offset = 0 } = {}) {
        const qq = typeof q === 'string' ? q.trim() : '';
        const params = new URLSearchParams();
        if (qq) params.set('q', qq);
        if (Number.isFinite(Number(limit))) params.set('limit', String(Number(limit)));
        if (Number.isFinite(Number(offset))) params.set('offset', String(Number(offset)));
        const suffix = params.toString();
        const path = suffix ? '/api/artists?' + suffix : '/api/artists';
        return await httpJson(path, { method: 'GET' });
    },

    async listMyClaims({ status = '', limit = 20, offset = 0 } = {}) {
        const params = new URLSearchParams();
        const st = typeof status === 'string' ? status.trim() : '';
        if (st) params.set('status', st);
        if (Number.isFinite(Number(limit))) params.set('limit', String(Number(limit)));
        if (Number.isFinite(Number(offset))) params.set('offset', String(Number(offset)));
        const suffix = params.toString();
        const path = suffix ? '/api/artists/claims/my?' + suffix : '/api/artists/claims/my';
        return await httpJson(path, { method: 'GET' });
    },

    async createClaim({ artist, note } = {}) {
        const payload = {
            artist: typeof artist === 'string' ? artist : '',
            note: note === null || note === undefined ? null : String(note),
        };
        return await httpJson('/api/artists/claims', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    },
};
