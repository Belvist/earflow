import { HttpClient } from '../httpClient';
import { throwApiErrorsMiddleware } from './middlewares/throwApiErrors';
import { createAuthLostGuardMiddleware } from './middlewares/authLostGuard';
import { createAuthRefreshMiddleware } from './middlewares/authRefresh';
import { createCsrfMiddleware } from './middlewares/csrf';
import { notModifiedReloadMiddleware } from './middlewares/notModifiedReload';
import { createAuthLostBroadcastMiddleware } from './middlewares/authLostBroadcast';
import { safeRequestDefaultsMiddleware } from './middlewares/safeRequestDefaults';
import { createCorrelationIdMiddleware } from './middlewares/correlationId';
import { createCircuitBreakerMiddleware } from './middlewares/circuitBreaker';
import { createCsrfRetryOn403Middleware } from './middlewares/csrfRetryOn403';
import { createDeviceProofMiddleware } from './middlewares/deviceProof';
import { createDeviceProofRecoveryMiddleware } from './middlewares/deviceProofRecovery';

export const createApiHttpClient = (deps = {}) => {
    const timeoutMs = Number(deps.defaultTimeoutMs);

    const reportClientError = typeof deps.reportClientError === 'function' ? deps.reportClientError : null;

    const authRefreshFlag = String(process.env.REACT_APP_CLIENT_AUTH_REFRESH || '').toLowerCase();
    const enableClientAuthRefresh = authRefreshFlag !== 'false';

    const circuitBreaker = createCircuitBreakerMiddleware({
        failureThreshold: 5,
        openDurationMs: 45_000,
        onOpen: reportClientError
            ? (event) => {
                const ck = String(event?.circuitKey || '').slice(0, 60);
                const code = ck ? `CIRCUIT_BREAKER_OPEN:${ck}` : 'CIRCUIT_BREAKER_OPEN';
                Promise.resolve(reportClientError({ code: code.slice(0, 80) })).catch(() => undefined);
            }
            : null,
    });

    return new HttpClient({
        defaultTimeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15_000,
        middlewares: [
            createCorrelationIdMiddleware(deps),
            circuitBreaker,
            createAuthLostGuardMiddleware(deps),
            enableClientAuthRefresh ? createAuthRefreshMiddleware(deps) : null,
            createDeviceProofMiddleware(deps),
            createCsrfMiddleware(deps),
            createCsrfRetryOn403Middleware(deps),
            notModifiedReloadMiddleware,
            safeRequestDefaultsMiddleware,
            createAuthLostBroadcastMiddleware(deps),
            throwApiErrorsMiddleware,
            // Must sit inside throwApiErrors (closer to fetch) so 401 bodies are handled before throw.
            createDeviceProofRecoveryMiddleware(deps),
        ].filter(Boolean),
    });
};

export const createApiHttpClientRaw = (deps = {}) => {
    const timeoutMs = Number(deps.defaultTimeoutMs);

    const reportClientError = typeof deps.reportClientError === 'function' ? deps.reportClientError : null;

    const authRefreshFlag = String(process.env.REACT_APP_CLIENT_AUTH_REFRESH || '').toLowerCase();
    const enableClientAuthRefresh = authRefreshFlag !== 'false';

    const circuitBreaker = createCircuitBreakerMiddleware({
        failureThreshold: 5,
        openDurationMs: 45_000,
        onOpen: reportClientError
            ? (event) => {
                const ck = String(event?.circuitKey || '').slice(0, 60);
                const code = ck ? `CIRCUIT_BREAKER_OPEN:${ck}` : 'CIRCUIT_BREAKER_OPEN';
                Promise.resolve(reportClientError({ code: code.slice(0, 80) })).catch(() => undefined);
            }
            : null,
    });

    return new HttpClient({
        defaultTimeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15_000,
        middlewares: [
            createCorrelationIdMiddleware(deps),
            circuitBreaker,
            createAuthLostGuardMiddleware(deps),
            enableClientAuthRefresh ? createAuthRefreshMiddleware(deps) : null,
            createDeviceProofMiddleware(deps),
            createCsrfMiddleware(deps),
            createCsrfRetryOn403Middleware(deps),
            notModifiedReloadMiddleware,
            safeRequestDefaultsMiddleware,
            createAuthLostBroadcastMiddleware(deps),
            createDeviceProofRecoveryMiddleware(deps),
        ].filter(Boolean),
    });
};
