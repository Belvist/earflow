import { readJsonSafely } from '../readJsonSafely';
import { invalidateAuthDeviceBinding } from '../../../auth/authDeviceCrypto';
import { clearProofAccessToken } from '../../../auth/proofAccessToken';

const RECOVERABLE_PROOF_CODES = new Set([
  'DEVICE_PROOF_INVALID',
  'DEVICE_PROOF_REQUIRED',
]);

export const createDeviceProofRecoveryMiddleware = (deps = {}) => {
  const ensureAuthDeviceRegistered = typeof deps.ensureAuthDeviceRegistered === 'function'
    ? deps.ensureAuthDeviceRegistered
    : null;

  return async (ctx, next) => {
    const resp = await next(ctx);

    if (resp?.status !== 401) {
      return resp;
    }

    if (ctx?.meta?.skipAuth || ctx?.meta?.skipDeviceProof) {
      return resp;
    }

    if (ctx?.meta?._retriedAfterDeviceProofRecovery) {
      return resp;
    }

    let code = '';
    try {
      const details = await readJsonSafely(resp.clone());
      code = details && typeof details.code === 'string' ? details.code.trim().toUpperCase() : '';
    } catch {
      code = '';
    }

    if (!RECOVERABLE_PROOF_CODES.has(code)) {
      return resp;
    }

    if (!ensureAuthDeviceRegistered) {
      return resp;
    }

    try {
      await invalidateAuthDeviceBinding();
      clearProofAccessToken();
      const reg = await ensureAuthDeviceRegistered({ force: true, required: false });
      if (reg?.ok === false) {
        return resp;
      }
    } catch {
      return resp;
    }

    return await next({
      ...ctx,
      meta: {
        ...(ctx.meta || {}),
        _retriedAfterDeviceProofRecovery: true,
      },
    });
  };
};
