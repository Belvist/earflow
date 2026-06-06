import { artistPortalApi } from '../transport/artistPortalApi';
import { classifyApiError } from './apiError';

export const artistPortalUsecase = {
    async loadArtistCard() {
        try {
            const data = await artistPortalApi.artistCard();
            return { ok: true, data };
        } catch (e) {
            return { ok: false, error: classifyApiError(e) };
        }
    },

    async loadDashboard() {
        try {
            const data = await artistPortalApi.dashboard();
            return { ok: true, data };
        } catch (e) {
            return { ok: false, error: classifyApiError(e) };
        }
    },

    async saveArtistCard({ bio, heroCoverPath, avatarCoverPath, bannerCoverPath }) {
        try {
            const payload = {};
            if (bio !== undefined) payload.bio = bio;
            if (heroCoverPath !== undefined) payload.heroCoverPath = heroCoverPath;
            if (avatarCoverPath !== undefined) payload.avatarCoverPath = avatarCoverPath;
            if (bannerCoverPath !== undefined) payload.bannerCoverPath = bannerCoverPath;
            const data = await artistPortalApi.patchArtistCard(payload);
            return { ok: true, data };
        } catch (e) {
            return { ok: false, error: classifyApiError(e) };
        }
    },

    async uploadAvatar(file) {
        try {
            const data = await artistPortalApi.uploadAvatar(file);
            return { ok: true, data };
        } catch (e) {
            return { ok: false, error: classifyApiError(e) };
        }
    },

    async uploadBanner(file) {
        try {
            const data = await artistPortalApi.uploadBanner(file);
            return { ok: true, data };
        } catch (e) {
            return { ok: false, error: classifyApiError(e) };
        }
    },

    async listTracks() {
        try {
            const data = await artistPortalApi.listTracks();
            return { ok: true, data };
        } catch (e) {
            return { ok: false, error: classifyApiError(e) };
        }
    },

    async uploadTrack(file) {
        try {
            const data = await artistPortalApi.uploadTrack(file);
            return { ok: true, data };
        } catch (e) {
            return { ok: false, error: classifyApiError(e) };
        }
    },

    async updateTrack(id, payload) {
        try {
            const data = await artistPortalApi.updateTrack(id, payload);
            return { ok: true, data };
        } catch (e) {
            return { ok: false, error: classifyApiError(e) };
        }
    },

    async deleteTrack(id) {
        try {
            const data = await artistPortalApi.deleteTrack(id);
            return { ok: true, data };
        } catch (e) {
            return { ok: false, error: classifyApiError(e) };
        }
    },

    async publishTrack(id) {
        try {
            const data = await artistPortalApi.publishTrack(id);
            return { ok: true, data };
        } catch (e) {
            return { ok: false, error: classifyApiError(e) };
        }
    },

    async unpublishTrack(id) {
        try {
            const data = await artistPortalApi.unpublishTrack(id);
            return { ok: true, data };
        } catch (e) {
            return { ok: false, error: classifyApiError(e) };
        }
    },

    async uploadTrackCover(id, file) {
        try {
            const data = await artistPortalApi.uploadTrackCover(id, file);
            return { ok: true, data };
        } catch (e) {
            return { ok: false, error: classifyApiError(e) };
        }
    },
};
