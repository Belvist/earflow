/**
 * @jest-environment jsdom
 */

jest.mock('../../../auth/authDeviceCrypto', () => ({
  invalidateAuthDeviceBinding: jest.fn().mockResolvedValue(undefined),
}));

import { invalidateAuthDeviceBinding } from '../../../auth/authDeviceCrypto';
import { createDeviceProofRecoveryMiddleware } from './deviceProofRecovery';

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: {
    get: (name) => (String(name).toLowerCase() === 'content-type' ? 'application/json' : null),
  },
  clone() {
    return jsonResponse(status, body);
  },
  json: async () => body,
});

describe('deviceProofRecovery middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('retries once on DEVICE_PROOF_INVALID then returns success', async () => {
    let calls = 0;
    const ensureAuthDeviceRegistered = jest.fn().mockResolvedValue({ ok: true });
    const middleware = createDeviceProofRecoveryMiddleware({ ensureAuthDeviceRegistered });
    const next = jest.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse(401, { code: 'DEVICE_PROOF_INVALID' });
      }
      return jsonResponse(200, { ok: true });
    });

    const ctx = { method: 'GET', meta: { endpoint: '/api/artists/Charli%20XCX/meta' } };
    const resp = await middleware(ctx, next);

    expect(resp.status).toBe(200);
    expect(next).toHaveBeenCalledTimes(2);
    expect(invalidateAuthDeviceBinding).toHaveBeenCalledTimes(1);
    expect(ensureAuthDeviceRegistered).toHaveBeenCalledWith({ force: true, required: false });
  });

  test('does not retry more than once when proof stays invalid', async () => {
    const ensureAuthDeviceRegistered = jest.fn().mockResolvedValue({ ok: true });
    const middleware = createDeviceProofRecoveryMiddleware({ ensureAuthDeviceRegistered });
    const next = jest.fn(async () => jsonResponse(401, { code: 'DEVICE_PROOF_INVALID' }));

    const ctx = { method: 'GET', meta: { endpoint: '/api/profile' } };
    const resp = await middleware(ctx, next);

    expect(resp.status).toBe(401);
    expect(next).toHaveBeenCalledTimes(2);
    expect(ensureAuthDeviceRegistered).toHaveBeenCalledTimes(1);
  });

  test('does not retry on MFA or CSRF errors', async () => {
    const ensureAuthDeviceRegistered = jest.fn();
    const middleware = createDeviceProofRecoveryMiddleware({ ensureAuthDeviceRegistered });
    const next = jest.fn(async () => jsonResponse(403, { code: 'MFA_STEP_UP_REQUIRED' }));

    const ctx = { method: 'POST', meta: { endpoint: '/api/auth/sessions/revoke-others' } };
    const resp = await middleware(ctx, next);

    expect(resp.status).toBe(403);
    expect(next).toHaveBeenCalledTimes(1);
    expect(ensureAuthDeviceRegistered).not.toHaveBeenCalled();
  });

  test('does not retry when skipDeviceProof is set', async () => {
    const ensureAuthDeviceRegistered = jest.fn();
    const middleware = createDeviceProofRecoveryMiddleware({ ensureAuthDeviceRegistered });
    const next = jest.fn(async () => jsonResponse(401, { code: 'DEVICE_PROOF_INVALID' }));

    const ctx = { method: 'POST', meta: { skipDeviceProof: true, endpoint: '/api/auth/device/register' } };
    const resp = await middleware(ctx, next);

    expect(resp.status).toBe(401);
    expect(next).toHaveBeenCalledTimes(1);
    expect(ensureAuthDeviceRegistered).not.toHaveBeenCalled();
  });
});
