'use strict';

function getPublicOrigin(req) {
    const envOriginRaw = process.env.PUBLIC_ORIGIN ? String(process.env.PUBLIC_ORIGIN).trim() : '';
    if (envOriginRaw) {
        try {
            const u = new URL(envOriginRaw);
            if (u.protocol === 'http:' || u.protocol === 'https:') {
                return u.origin;
            }
        } catch {
        }
    }

    const xfProto = req.headers['x-forwarded-proto'];
    const proto = xfProto ? String(xfProto).split(',')[0].trim() : null;
    const xfHost = req.headers['x-forwarded-host'];
    const forwardedHost = xfHost ? String(xfHost).split(',')[0].trim() : null;
    const host = forwardedHost || (req.headers.host ? String(req.headers.host).trim() : null);

    const envNode = String(process.env.NODE_ENV || '').toLowerCase();
    const isProduction = envNode === 'production' || envNode === 'prod';

    const isSafePublicHost = (value) => {
        if (!value) return false;
        const h = String(value).toLowerCase();
        if (!h) return false;
        if (h.includes('upload-service') || h.includes('api-gateway') || h.includes('database-service')) return false;
        if (isProduction && h.includes('localhost')) return false;
        if (h.includes('minio') || h.includes(':3002') || h.includes(':3000') || h.includes(':3001') || h.includes(':3003')) return false;
        return true;
    };

    const isLocalHost = (value) => {
        if (!value) return false;
        const v = String(value).toLowerCase();
        return v.includes('localhost') || v.startsWith('127.0.0.1') || v.startsWith('0.0.0.0');
    };

    if (proto && host && isSafePublicHost(host)) {
        return `${proto}://${host}`;
    }
    if (!proto && host && !isProduction && isLocalHost(host)) {
        return `http://${host}`;
    }
    if (host && isSafePublicHost(host)) {
        return `https://${host}`;
    }
    return 'https://earflow.ru';
}

module.exports = {
    getPublicOrigin,
};
