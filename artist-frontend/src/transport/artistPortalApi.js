import { httpJson } from './http';

export const artistPortalApi = {
    async me() {
        return await httpJson('/api/artist-portal/me', { method: 'GET' });
    },

    async artistCard() {
        return await httpJson('/api/artist-portal/artist-card', { method: 'GET' });
    },

    async dashboard() {
        return await httpJson('/api/artist-portal/dashboard', { method: 'GET' });
    },

    async patchArtistCard(payload) {
        return await httpJson('/api/artist-portal/artist-card', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {}),
        });
    },

    async uploadAvatar(file) {
        const form = new FormData();
        form.append('file', file);
        return await httpJson('/api/artist-portal/artist-assets/avatar', {
            method: 'POST',
            body: form,
        });
    },

    async uploadBanner(file) {
        const form = new FormData();
        form.append('file', file);
        return await httpJson('/api/artist-portal/artist-assets/banner', {
            method: 'POST',
            body: form,
        });
    },

    async listTracks() {
        return await httpJson('/api/artist-portal/tracks', { method: 'GET' });
    },

    async uploadTrack(file) {
        const form = new FormData();
        form.append('file', file);
        return await httpJson('/api/artist-portal/tracks', {
            method: 'POST',
            body: form,
        });
    },

    async updateTrack(id, payload) {
        return await httpJson(`/api/artist-portal/tracks/${encodeURIComponent(String(id))}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {}),
        });
    },

    async deleteTrack(id) {
        return await httpJson(`/api/artist-portal/tracks/${encodeURIComponent(String(id))}`, {
            method: 'DELETE',
        });
    },

    async publishTrack(id) {
        return await httpJson(`/api/artist-portal/tracks/${encodeURIComponent(String(id))}/publish`, {
            method: 'POST',
            body: JSON.stringify({}),
            headers: { 'Content-Type': 'application/json' },
        });
    },

    async unpublishTrack(id) {
        return await httpJson(`/api/artist-portal/tracks/${encodeURIComponent(String(id))}/unpublish`, {
            method: 'POST',
            body: JSON.stringify({}),
            headers: { 'Content-Type': 'application/json' },
        });
    },

    async uploadTrackCover(id, file) {
        const form = new FormData();
        form.append('file', file);
        return await httpJson(`/api/artist-portal/tracks/${encodeURIComponent(String(id))}/cover`, {
            method: 'POST',
            body: form,
        });
    },
};
