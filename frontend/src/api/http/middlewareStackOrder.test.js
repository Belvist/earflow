import { composeMiddlewares } from './compose';
import { throwApiErrorsMiddleware } from './middlewares/throwApiErrors';
import { createDeviceProofRecoveryMiddleware } from './middlewares/deviceProofRecovery';

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

describe('HTTP middleware stack order', () => {
  test('deviceProofRecovery runs before throwApiErrors on 401 responses', async () => {
    let fetchCalls = 0;
    const terminal = async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        return jsonResponse(401, { code: 'DEVICE_PROOF_INVALID' });
      }
      return jsonResponse(200, { ok: true });
    };

    const ensureAuthDeviceRegistered = jest.fn().mockResolvedValue({ ok: true });
    const handler = composeMiddlewares([
      throwApiErrorsMiddleware,
      createDeviceProofRecoveryMiddleware({ ensureAuthDeviceRegistered }),
    ], terminal);

    const resp = await handler({ method: 'GET', meta: { endpoint: '/api/artists/LIL%20KRYSTALLL/meta' } });

    expect(resp.status).toBe(200);
    expect(fetchCalls).toBe(2);
    expect(ensureAuthDeviceRegistered).toHaveBeenCalledWith({ force: true, required: false });
  });
});
