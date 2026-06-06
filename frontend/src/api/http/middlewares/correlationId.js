const randomHex = (len) => {
    const alphabet = '0123456789abcdef';
    let out = '';
    for (let i = 0; i < len; i += 1) {
        out += alphabet[(Math.random() * 16) | 0];
    }
    return out;
};

const generateCorrelationId = () => {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
    } catch {
    }
    return `${randomHex(8)}-${randomHex(4)}-${randomHex(4)}-${randomHex(4)}-${randomHex(12)}`;
};

export const createCorrelationIdMiddleware = (deps = {}) => {
    const getCorrelationId = typeof deps.getCorrelationId === 'function' ? deps.getCorrelationId : null;
    const setCorrelationId = typeof deps.setCorrelationId === 'function' ? deps.setCorrelationId : null;

    return async (ctx, next) => {
        const existing = (() => {
            try {
                return String(getCorrelationId?.() || '');
            } catch {
                return '';
            }
        })();

        const cid = existing || generateCorrelationId();

        try {
            setCorrelationId?.(cid);
        } catch {
        }

        const nextCtx = {
            ...ctx,
            headers: {
                ...(ctx.headers || {}),
                'X-Correlation-ID': cid,
            },
            meta: {
                ...(ctx.meta || {}),
                correlationId: cid,
            },
        };

        try {
            return await next(nextCtx);
        } catch (e) {
            try {
                if (e && typeof e === 'object' && !e.correlationId) {
                    e.correlationId = cid;
                }
            } catch {
            }
            throw e;
        }
    };
};
