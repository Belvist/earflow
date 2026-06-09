import { signDeviceProofRequest } from './authDeviceCrypto';
import { getCsrfToken } from './cookieHelpers';

const apiBaseUrl = () => {
  const raw = String(process.env.REACT_APP_API_URL || '').trim();
  if (raw) return raw.replace(/\/+$/, '');
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, '');
  }
  return '';
};

async function sensitiveProofHeaders(method, path) {
  const signed = await signDeviceProofRequest(method, `${apiBaseUrl()}${path}`);
  if (!signed?.headers) {
    throw new Error('device_proof_unavailable');
  }
  const headers = { ...signed.headers };
  const csrf = getCsrfToken();
  if (csrf) {
    headers['X-CSRF-Token'] = csrf;
  }
  return headers;
}

export async function postMfaStepUp({ token, recoveryCode } = {}) {
  const payload = token ? { token } : { recoveryCode };
  const headers = await sensitiveProofHeaders('POST', '/api/auth/2fa/step-up');
  headers['Content-Type'] = 'application/json';
  headers.Accept = 'application/json';

  const resp = await fetch(`${apiBaseUrl()}/api/auth/2fa/step-up`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(payload),
  });

  let body = {};
  try {
    body = await resp.json();
  } catch {
    body = {};
  }

  return {
    ok: resp.ok,
    status: resp.status,
    body,
  };
}

export async function getMfaStepUpStatus() {
  const headers = await sensitiveProofHeaders('GET', '/api/auth/2fa/step-up/status');
  headers.Accept = 'application/json';

  const resp = await fetch(`${apiBaseUrl()}/api/auth/2fa/step-up/status`, {
    method: 'GET',
    credentials: 'include',
    headers,
  });

  let body = {};
  try {
    body = await resp.json();
  } catch {
    body = {};
  }

  return {
    ok: resp.ok,
    status: resp.status,
    body,
  };
}

export function isStepUpRequiredError(err) {
  const code = String(err?.code || '').trim().toUpperCase();
  return code === 'MFA_STEP_UP_REQUIRED' || code === 'FRESH_LOGIN_REQUIRED';
}
