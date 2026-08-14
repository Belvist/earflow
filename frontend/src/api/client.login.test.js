import { ApiClient } from './client';
import { resetRefreshManagerForTests } from '../auth/refreshManager';

// Regression: a transient device-binding failure at login must NOT throw the
// completed login away (that produced the "login keeps bouncing me in a loop"
// symptom). Binding self-heals via bootstrap / deviceProofRecovery / refresh.
describe('ApiClient login device-binding resilience', () => {
    it('email login still resolves when device registration is delayed', async () => {
        const api = new ApiClient();
        api.ensureAuthDeviceRegistered = jest.fn().mockRejectedValue(new Error('device_register_failed'));
        api.request = jest.fn().mockResolvedValue({ user: { id: 'u1', username: 'tester' } });

        await expect(api.loginWithEmail('a@example.com', 'pw')).resolves.toEqual({ user: { id: 'u1', username: 'tester' } });
        expect(api.ensureAuthDeviceRegistered).toHaveBeenCalledWith({ required: false });
    });

    it('telegram login still resolves when device registration is delayed', async () => {
        const api = new ApiClient();
        api.ensureAuthDeviceRegistered = jest.fn().mockRejectedValue(new Error('device_register_failed'));
        api.request = jest.fn().mockResolvedValue({ user: { id: 'u2', username: 'tg' } });

        await expect(api.loginWithTelegram({ id: 't1', firstName: 'X' })).resolves.toEqual({ user: { id: 'u2', username: 'tg' } });
        expect(api.ensureAuthDeviceRegistered).toHaveBeenCalledWith({ required: false });
    });
});

describe('ApiClient refresh device-proof retry', () => {
    beforeEach(() => {
        resetRefreshManagerForTests();
    });

    // Regression: a fresh page load with a valid cookie session must not be
    // dropped to the login screen just because the device proof could not be
    // bound in time (transient register failure). The refresh endpoint requires
    // device proof, so a 401 DEVICE_PROOF_REQUIRED should force re-register and
    // retry once instead of classifying the session as dead.
    it('retries refresh once after force re-registering device on DEVICE_PROOF_REQUIRED', async () => {
        const api = new ApiClient();
        api._getCsrfTokenValue = jest.fn(() => 'test-csrf');
        api._ensureCsrfCookie = jest.fn(() => Promise.resolve('test-csrf'));
        api.ensureAuthDeviceRegistered = jest.fn().mockResolvedValue({ ok: true });
        api._resolveDeviceProofHeaders = jest.fn(() => Promise.resolve({}));

        let call = 0;
        const originalFetch = global.fetch;
        global.fetch = jest.fn(() => {
            call += 1;
            if (call === 1) {
                return Promise.resolve(new Response(JSON.stringify({ code: 'DEVICE_PROOF_REQUIRED' }), {
                    status: 401,
                    headers: { 'content-type': 'application/json' },
                }));
            }
            return Promise.resolve(new Response(null, { status: 204 }));
        });

        try {
            const result = await api._refreshSessionCore();
            expect(result.ok).toBe(true);
            expect(call).toBe(2);
            expect(api.ensureAuthDeviceRegistered).toHaveBeenCalledWith({ force: true });
        } finally {
            global.fetch = originalFetch;
        }
    });
});