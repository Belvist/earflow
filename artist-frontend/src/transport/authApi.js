import { httpJson, httpVoid } from './http';

export const authApi = {
    async login({ email, password }) {
        const payload = JSON.stringify({ email, password });
        return await httpJson('/api/auth/email/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
        });
    },

    async register({ email, password, firstName, lastName }) {
        const payload = JSON.stringify({ email, password, firstName, lastName });
        return await httpJson('/api/auth/email/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
        });
    },

    async telegramLogin(payload) {
        const body = JSON.stringify(payload && typeof payload === 'object' ? payload : {});
        return await httpJson('/api/auth/telegram/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
        });
    },

    async refresh() {
        await httpVoid('/api/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
    },

    async logout() {
        await httpVoid('/api/auth/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
    },

    async profile() {
        return await httpJson('/api/profile', {
            method: 'GET',
        });
    },
};
