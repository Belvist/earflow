const getCookie = (name) => {
    try {
        const v = typeof document !== 'undefined' ? String(document.cookie || '') : '';
        if (!v) return '';

        const parts = v.split(';');
        let last = '';
        for (const p of parts) {
            const s = p.trim();
            if (!s) continue;
            const idx = s.indexOf('=');
            if (idx <= 0) continue;
            const k = s.slice(0, idx).trim();
            if (k !== name) continue;
            last = s.slice(idx + 1);
        }
        if (!last) return '';
        try {
            return decodeURIComponent(last);
        } catch {
            return last;
        }
    } catch {
        return '';
    }
};

const getArtistCsrfCookieName = () => {
    try {
        if (typeof window === 'undefined') return 'mp_csrf_artists';
        const cfg = window.__EARFLOW_ARTIST_RUNTIME_CONFIG__;
        const n = cfg && typeof cfg === 'object' ? cfg.csrfCookieName : '';
        return typeof n === 'string' && n.trim() ? n.trim() : 'mp_csrf_artists';
    } catch {
        return 'mp_csrf_artists';
    }
};

const getArtistCsrfToken = () => {
    const primary = getArtistCsrfCookieName();
    const v = getCookie(primary);
    if (v) return v;
    if (primary !== 'mp_csrf') {
        return getCookie('mp_csrf');
    }
    return '';
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

export async function httpJson(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const body = options.body !== undefined ? options.body : undefined;
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;

    const headers = {
        ...(isForm ? {} : { Accept: 'application/json' }),
        ...(options.headers || {}),
    };

    if (!isSafeMethod(method)) {
        const csrf = getArtistCsrfToken();
        if (csrf) {
            headers['X-CSRF-Token'] = csrf;
        }
    }

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
    const headers = {
        ...(options.headers || {}),
    };

    if (!isSafeMethod(method)) {
        const csrf = getArtistCsrfToken();
        if (csrf) {
            headers['X-CSRF-Token'] = csrf;
        }
    }

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
