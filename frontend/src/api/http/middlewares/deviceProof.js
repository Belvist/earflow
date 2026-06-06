import { getAuthDeviceHeaders, isDeviceProofEnforced } from '../../../auth/authDeviceCrypto';

const PROOF_SKIP_PATHS = new Set([
  '/api/auth/email/login',
  '/api/auth/email/register',
  '/api/auth/telegram/login',
  '/api/auth/csrf',
  '/api/auth/device/register',
  '/api/public-config',
]);

const endpointPath = (endpoint) => {
  const raw = String(endpoint || '').trim();
  if (!raw) return '';
  try {
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      return new URL(raw).pathname;
    }
  } catch {
    // ignore
  }
  const q = raw.indexOf('?');
  return q >= 0 ? raw.slice(0, q) : raw;
};

export const createDeviceProofMiddleware = (deps = {}) => {
  const ensureRegistered = typeof deps.ensureAuthDeviceRegistered === 'function'
    ? deps.ensureAuthDeviceRegistered
    : null;

  return async (ctx, next) => {
  if (!isDeviceProofEnforced() || ctx?.meta?.skipDeviceProof) {
    return next(ctx);
  }

  const path = endpointPath(ctx?.meta?.endpoint);
  if (PROOF_SKIP_PATHS.has(path)) {
    return next(ctx);
  }

  let proofHeaders = await getAuthDeviceHeaders(ctx?.method, ctx?.url || path);
  if ((!proofHeaders || Object.keys(proofHeaders).length === 0) && ensureRegistered) {
    await ensureRegistered().catch(() => undefined);
    proofHeaders = await getAuthDeviceHeaders(ctx?.method, ctx?.url || path);
  }
  if (!proofHeaders || Object.keys(proofHeaders).length === 0) {
    return next(ctx);
  }

  return next({
    ...ctx,
    headers: {
      ...(ctx.headers || {}),
      ...proofHeaders,
    },
  });
  };
};
