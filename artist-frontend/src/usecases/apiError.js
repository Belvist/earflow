export function toApiError(e) {
    const status = Number(e?.status) || 0;

    const code = (() => {
        const c = e?.data?.code;
        if (typeof c === 'string' && c.trim()) return c.trim();
        const legacy = e?.data?.error;
        if (typeof legacy === 'string' && legacy.trim()) return legacy.trim();
        return '';
    })();

    return {
        status,
        code,
    };
}

export function classifyApiError(e) {
    const { status, code } = toApiError(e);

    if (status === 401) return { type: 'unauthorized', status, code };
    if (status === 403 && code === 'MFA_REQUIRED') return { type: 'mfa_required', status, code };
    if (status === 403 && code === 'MFA_STEP_UP_REQUIRED') return { type: 'stepup_required', status, code };
    if (status === 403 && code === 'FRESH_LOGIN_REQUIRED') return { type: 'stepup_required', status, code };
    if (status === 403 && code === 'ARTIST_ACCESS_REQUIRED') return { type: 'forbidden', status, code };

    if (status === 403 && typeof code === 'string' && code.startsWith('CSRF_')) return { type: 'csrf', status, code };
    if (status === 403) return { type: 'forbidden_generic', status, code };

    if (status >= 400 && status < 600) return { type: 'http_error', status, code };

    return { type: 'unknown', status, code };
}
