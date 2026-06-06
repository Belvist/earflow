import { httpJson } from './http';

export const securityApi = {
    async loadOverview() {
        return await httpJson('/api/auth/security/overview', { method: 'GET' });
    },

    async checkPasswordStrength({ password }) {
        return await httpJson('/api/auth/password/strength', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: typeof password === 'string' ? password : '' }),
        });
    },

    async changePassword({ currentPassword, newPassword }) {
        const payload = {};
        if (typeof currentPassword === 'string' && currentPassword.length > 0) {
            payload.currentPassword = currentPassword;
        }
        payload.newPassword = typeof newPassword === 'string' ? newPassword : '';
        return await httpJson('/api/auth/password/change', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    },

    async unlinkTelegram() {
        return await httpJson('/api/auth/telegram/unlink', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
    },

    async revokeOtherSessions() {
        return await httpJson('/api/auth/sessions/revoke-others', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
    },

    async revokeSession(sid) {
        return await httpJson('/api/auth/sessions/revoke', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sid: typeof sid === 'string' ? sid : '' }),
        });
    },
};
