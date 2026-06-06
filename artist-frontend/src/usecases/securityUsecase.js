import { mfaApi } from '../transport/mfaApi';
import { securityApi } from '../transport/securityApi';
import { classifyApiError, toApiError } from './apiError';

export const securityUsecase = {
    async loadOverview() {
        try {
            const data = await securityApi.loadOverview();
            return { ok: true, data };
        } catch (e) {
            return { ok: false, error: classifyApiError(e) };
        }
    },

    async checkPasswordStrength({ password }) {
        try {
            const data = await securityApi.checkPasswordStrength({ password });
            return { ok: true, data };
        } catch (e) {
            return { ok: false, error: classifyApiError(e) };
        }
    },

    async mfaSetup() {
        try {
            const data = await mfaApi.setup();
            return { ok: true, data };
        } catch (e) {
            return { ok: false, error: { ...classifyApiError(e), raw: toApiError(e) } };
        }
    },

    async mfaEnable({ token }) {
        try {
            const data = await mfaApi.enable({ token });
            return { ok: true, data };
        } catch (e) {
            return { ok: false, error: { ...classifyApiError(e), raw: toApiError(e) } };
        }
    },

    async mfaDisable({ token, recoveryCode }) {
        try {
            const data = await mfaApi.disable({ token, recoveryCode });
            return { ok: true, data };
        } catch (e) {
            return { ok: false, error: { ...classifyApiError(e), raw: toApiError(e) } };
        }
    },

    async mfaRegenerateRecoveryCodes() {
        try {
            const data = await mfaApi.regenerateRecoveryCodes();
            return { ok: true, data };
        } catch (e) {
            return { ok: false, error: { ...classifyApiError(e), raw: toApiError(e) } };
        }
    },

    async changePassword({ currentPassword, newPassword }) {
        try {
            const data = await securityApi.changePassword({ currentPassword, newPassword });
            return { ok: true, data };
        } catch (e) {
            return { ok: false, error: { ...classifyApiError(e), raw: toApiError(e) } };
        }
    },

    async unlinkTelegram() {
        try {
            const data = await securityApi.unlinkTelegram();
            return { ok: true, data };
        } catch (e) {
            return { ok: false, error: { ...classifyApiError(e), raw: toApiError(e) } };
        }
    },

    async revokeOtherSessions() {
        try {
            const data = await securityApi.revokeOtherSessions();
            return { ok: true, data };
        } catch (e) {
            return { ok: false, error: { ...classifyApiError(e), raw: toApiError(e) } };
        }
    },
};
