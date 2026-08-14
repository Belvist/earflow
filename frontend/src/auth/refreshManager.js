let refreshPromise = null;

// NOTE: SESSION_UNVERIFIED is intentionally NOT recoverable here. This set only
// classifies the /api/auth/refresh endpoint result, and the gateway emits
// SESSION_UNVERIFIED from refresh only when rotation definitively failed or the
// session was revoked (never for a live session). Treating it as recoverable
// caused an endless silent 401 loop (user "logged in" but every API call failed
// for ~12 min). Regular API 401s with SESSION_UNVERIFIED are still handled as
// recoverable/retryable in authRefresh.js and AuthContext.
const RECOVERABLE_AUTH_CODES = new Set([
    'AUTH_UNAVAILABLE',
    'CSRF_BAD_ORIGIN',
    'CSRF_INVALID',
    'CSRF_MISSING',
    'CSRF_MISSING_ORIGIN',
]);

const REAUTH_REQUIRED_AUTH_CODES = new Set([
    'NO_SESSION',
    'SESSION_REVOKED',
    'REFRESH_REVOKED',
]);

const normalizeAuthCode = (code) => (typeof code === 'string' ? code.trim().toUpperCase() : '');

export function classifyRefreshResult(result) {
    const status = Number(result?.status || 0);
    const ok = !!result?.ok;
    const code = normalizeAuthCode(result?.code);

    if (ok) {
        return { ok: true, status: status || 204, state: 'ok', fatal: false, transient: false };
    }

    if (result?.reauthRequired === true || REAUTH_REQUIRED_AUTH_CODES.has(code)) {
        return { ok: false, status: status || 401, state: code || 'reauth_required', code, fatal: true, transient: false };
    }

    // Any 401 from the refresh endpoint means the session cannot be rotated
    // (revoked, reused/consumed, or grace exhausted) — never a transient blip.
    // The gateway's `recoverable: true` flag must not downgrade this to a
    // recoverable/transient error, else the client retries forever in a silent
    // 401 loop.
    if (status === 401) {
        return { ok: false, status, state: code || 'expired', code, fatal: true, transient: false };
    }

    if (result?.recoverable === true || RECOVERABLE_AUTH_CODES.has(code)) {
        return { ok: false, status, state: code || 'recoverable_auth_error', code, fatal: false, transient: true };
    }

    if (status === 403) {
        return { ok: false, status, state: code || 'csrf_or_origin', code, fatal: false, transient: true };
    }

    if (status === 429) {
        return { ok: false, status, state: code || 'rate_limited', code, fatal: false, transient: true };
    }

    if (status === 0 || status === 408 || status === 502 || status === 503 || status === 504 || status >= 500) {
        return { ok: false, status, state: code || 'degraded', code, fatal: false, transient: true };
    }

    return { ok: false, status, state: code || 'failed', code, fatal: false, transient: false };
}

export async function runRefresh(doRefreshRequest) {
    if (refreshPromise) {
        return await refreshPromise;
    }

    refreshPromise = (async () => {
        try {
            const result = await doRefreshRequest();
            return {
                ...(result && typeof result === 'object' ? result : { ok: !!result }),
                shared: false,
            };
        } finally {
            refreshPromise = null;
        }
    })();

    return await refreshPromise;
}

export function hasRefreshInFlight() {
    return !!refreshPromise;
}

export function resetRefreshManagerForTests() {
    refreshPromise = null;
}
