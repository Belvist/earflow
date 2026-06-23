export const readJsonSafely = async (resp) => {
    try {
        if (!resp) return null;
        if (resp.status === 204) return null;
        const contentLength = resp.headers?.get?.('content-length');
        if (contentLength === '0') return null;
        const contentType = resp.headers?.get?.('content-type') || '';
        if (!String(contentType).includes('application/json')) return null;
        return await resp.json();
    } catch {
        return null;
    }
};
