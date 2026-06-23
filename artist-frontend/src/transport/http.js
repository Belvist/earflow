import { isDeviceProofEnforced } from '../auth/authDeviceCrypto';
import { ensureAuthDeviceRegistered } from '../auth/authDeviceRegister';
import { getArtistCsrfToken } from '../auth/cookieHelpers';
import { getHotPathProofHeaders } from '../auth/proofAccessToken';

const PROOF_SKIP_PATHS = new Set([
    '/api/auth/email/login',
    '/api/auth/email/register',
    '/api/auth/telegram/login',
    '/api/auth/csrf',
    '/api/auth/device/register',
    '/api/public-config',
]);

const endpointPath = (path) => {
    const raw = String(path || '').trim();
    if (!raw) return '';
    const q = raw.indexOf('?');
    return q >= 0 ? raw.slice(0, q) : raw;
};

const isSafeMethod = (method) => {
    const m = String(method || 'GET').toUpperCase();
    return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
};

const readJson = async (resp) => {
    const ct = String(resp.headers.get('content-type') || '');
    if (!ct.includes('application/json')) return null;
    try {
        return await resp.json();
    } catch {
        return null;
    }
};

async function attachAuthHeaders(method, path, headers, { skipDeviceProof = false } = {}) {
    if (skipDeviceProof || !isDeviceProofEnforced()) {
        return headers;
    }
    const normalized = endpointPath(path);
    if (PROOF_SKIP_PATHS.has(normalized)) {
        return headers;
    }

    const absolute = typeof window !== 'undefined' && window.location?.origin
        ? `${window.location.origin}${normalized}`
        : normalized;

    let proofHeaders = await getHotPathProofHeaders(method, absolute);
    if (!proofHeaders || Object.keys(proofHeaders).length === 0) {
        await ensureAuthDeviceRegistered().catch(() => undefined);
        proofHeaders = await getHotPathProofHeaders(method, absolute);
    }
    if (!proofHeaders || Object.keys(proofHeaders).length === 0) {
        return headers;
    }
    return {
        ...headers,
        ...proofHeaders,
    };
}

export async function httpJson(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const body = options.body !== undefined ? options.body : undefined;
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;

    let headers = {
        ...(isForm ? {} : { Accept: 'application/json' }),
        ...(options.headers || {}),
    };

    if (!isSafeMethod(method)) {
        const csrf = getArtistCsrfToken();
        if (csrf) {
            headers['X-CSRF-Token'] = csrf;
        }
    }

    headers = await attachAuthHeaders(method, path, headers, {
        skipDeviceProof: options.skipDeviceProof === true,
    });

    const resp = await fetch(path, {
        method,
        credentials: 'include',
        cache: 'no-store',
        headers,
        body,
    });

    const data = await readJson(resp);

    if (!resp.ok) {
        const err = new Error('HTTP_ERROR');
        err.status = resp.status;
        err.data = data;
        err.code = typeof data?.code === 'string' ? data.code : '';
        err.recoverable = data?.recoverable === true;
        err.reauthRequired = data?.reauthRequired === true;
        throw err;
    }

    return data;
}

export async function httpVoid(path, options = {}) {
    const method = String(options.method || 'POST').toUpperCase();
    let headers = {
        ...(options.headers || {}),
    };

    if (!isSafeMethod(method)) {
        const csrf = getArtistCsrfToken();
        if (csrf) {
            headers['X-CSRF-Token'] = csrf;
        }
    }

    headers = await attachAuthHeaders(method, path, headers, {
        skipDeviceProof: options.skipDeviceProof === true,
    });

    const resp = await fetch(path, {
        method,
        credentials: 'include',
        cache: 'no-store',
        headers,
        body: options.body !== undefined ? options.body : undefined,
    });

    if (!resp.ok) {
        const data = await readJson(resp);
        const err = new Error('HTTP_ERROR');
        err.status = resp.status;
        err.data = data;
        err.code = typeof data?.code === 'string' ? data.code : '';
        err.recoverable = data?.recoverable === true;
        err.reauthRequired = data?.reauthRequired === true;
        throw err;
    }
}
