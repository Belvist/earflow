import { httpJson } from './http';

export const mfaApi = {
    async status() {
        return await httpJson('/api/auth/2fa/status', { method: 'GET' });
    },

    async setup() {
        return await httpJson('/api/auth/2fa/setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
    },

    async enable({ token }) {
        return await httpJson('/api/auth/2fa/enable', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
        });
    },

    async disable({ token, recoveryCode }) {
        const payload = token ? { token } : { recoveryCode };
        return await httpJson('/api/auth/2fa/disable', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    },

    async regenerateRecoveryCodes() {
        return await httpJson('/api/auth/2fa/recovery/regenerate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
    },

    async stepUp({ token, recoveryCode }) {
        const payload = token ? { token } : { recoveryCode };
        return await httpJson('/api/auth/2fa/step-up', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    },

    async stepUpStatus() {
        return await httpJson('/api/auth/2fa/step-up/status', { method: 'GET' });
    },
};
