import {
  isDeviceProofEnforced,
  persistAuthDeviceRecord,
  signDeviceProofRequest,
} from './authDeviceCrypto';
import { getArtistCsrfToken } from './cookieHelpers';

const apiBaseUrl = () => {
  const raw = String(process.env.REACT_APP_API_URL || '').trim();
  if (raw) return raw.replace(/\/+$/, '');
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, '');
  }
  return '';
};

export async function ensureAuthDeviceRegistered(options = {}) {
  if (!isDeviceProofEnforced()) {
    return { ok: true, skipped: true };
  }

  const material = await signDeviceProofRequest('POST', `${apiBaseUrl()}/api/auth/device/register`);
  const authDeviceId = material.authDeviceId;
  const publicKeySpki = material.publicKeySpki;
  if (!authDeviceId || !publicKeySpki) {
    return { ok: false, code: 'device_key_unavailable' };
  }
  if (!options.force && material.sidHash && !material.needsRegister) {
    return { ok: true, authDeviceId, alreadyBound: true };
  }

  const csrf = getArtistCsrfToken();
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (csrf) {
    headers['X-CSRF-Token'] = csrf;
  }

  const resp = await fetch(`${apiBaseUrl()}/api/auth/device/register`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({ authDeviceId, publicKeySpki }),
  });

  let body = null;
  try {
    body = await resp.json();
  } catch {
    body = null;
  }

  if (resp.ok && body?.sidHash) {
    await persistAuthDeviceRecord({
      authDeviceId,
      sidHash: body.sidHash,
      publicKeySpki,
      pkcs8: material.pkcs8,
    });
    return { ok: true, authDeviceId };
  }

  return { ok: false, code: 'device_register_failed', status: resp.status };
}
