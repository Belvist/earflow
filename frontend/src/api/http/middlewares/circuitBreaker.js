import { CircuitBreakerOpenError, NetworkError, TimeoutError, HttpError } from '../../errors';
import { attachLegacyStatusFields } from '../legacyStatus';

const getBaseOrigin = () => {
    try {
        return typeof window !== 'undefined' && window.location && window.location.origin
            ? window.location.origin
            : 'http://localhost';
    } catch {
        return 'http://localhost';
    }
};

const bucketPath = (pathname) => {
    const raw = String(pathname || '');
    if (!raw) return '/';
    const parts = raw.split('/').filter(Boolean);
    if (parts.length === 0) return '/';
    if (parts[0] !== 'api') {
        return `/${parts[0]}`;
    }
    if (!parts[1]) return '/api';
    return `/api/${parts[1]}`;
};

const deriveCircuitKey = (ctx) => {
    const explicit = typeof ctx?.meta?.circuitKey === 'string' ? ctx.meta.circuitKey : '';
    if (explicit) return explicit;
    const baseOrigin = getBaseOrigin();
    try {
        const u = new URL(String(ctx?.url || ''), baseOrigin);
        return `${u.origin}${bucketPath(u.pathname)}`;
    } catch {
        const ep = typeof ctx?.meta?.endpoint === 'string' ? ctx.meta.endpoint : '';
        return ep ? `${baseOrigin}${bucketPath(ep)}` : String(ctx?.url || '');
    }
};

const asFailure = (err) => {
    if (!err || typeof err !== 'object') return true;
    if (err instanceof NetworkError) return true;
    if (err instanceof TimeoutError) return true;
    if (err instanceof CircuitBreakerOpenError) return false;
    if (err instanceof HttpError) {
        const st = Number(err.status);
        if (!Number.isFinite(st)) return true;
        if (st >= 500 && st <= 599) return true;
        if (st === 408 || st === 429) return true;
        return false;
    }
    const st = Number(err.status);
    if (Number.isFinite(st)) {
        if (st >= 500 && st <= 599) return true;
        if (st === 408 || st === 429) return true;
        return false;
    }
    return true;
};

export const createCircuitBreakerMiddleware = (options = {}) => {
    const failureThreshold = Number.isFinite(Number(options.failureThreshold)) ? Number(options.failureThreshold) : 5;
    const openDurationMs = Number.isFinite(Number(options.openDurationMs)) ? Number(options.openDurationMs) : 45_000;
    const onOpen = typeof options.onOpen === 'function' ? options.onOpen : null;

    const states = new Map();

    return async (ctx, next) => {
        const now = Date.now();

        const key = deriveCircuitKey(ctx);

        const s = states.get(key) || { failures: 0, openUntilAt: 0 };
        if (s.openUntilAt && now < s.openUntilAt) {
            const err = new CircuitBreakerOpenError({ details: { circuitKey: key, retryAtMs: s.openUntilAt } });
            throw attachLegacyStatusFields(err, 503);
        }

        try {
            const resp = await next(ctx);
            const st = Number(resp?.status);
            if (Number.isFinite(st) && st >= 500 && st <= 599) {
                const nextFailures = s.failures + 1;
                if (nextFailures >= failureThreshold) {
                    const openUntilAt = now + openDurationMs;
                    states.set(key, { failures: nextFailures, openUntilAt });
                    if (!s.openUntilAt || s.openUntilAt <= now) {
                        try {
                            onOpen?.({
                                circuitKey: key,
                                failures: nextFailures,
                                openUntilAt,
                                url: String(ctx?.url || ''),
                                method: String(ctx?.method || ''),
                                correlationId: ctx?.meta?.correlationId,
                            });
                        } catch {
                        }
                    }
                } else {
                    states.set(key, { failures: nextFailures, openUntilAt: 0 });
                }
            } else {
                states.set(key, { failures: 0, openUntilAt: 0 });
            }
            return resp;
        } catch (e) {
            if (asFailure(e)) {
                const nextFailures = s.failures + 1;
                if (nextFailures >= failureThreshold) {
                    const openUntilAt = now + openDurationMs;
                    states.set(key, { failures: nextFailures, openUntilAt });
                    if (!s.openUntilAt || s.openUntilAt <= now) {
                        try {
                            onOpen?.({
                                circuitKey: key,
                                failures: nextFailures,
                                openUntilAt,
                                url: String(ctx?.url || ''),
                                method: String(ctx?.method || ''),
                                correlationId: ctx?.meta?.correlationId,
                            });
                        } catch {
                        }
                    }
                } else {
                    states.set(key, { failures: nextFailures, openUntilAt: 0 });
                }
            }
            throw e;
        }
    };
};
