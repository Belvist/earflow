export class ApiError extends Error {
    constructor(message, options = {}) {
        const details = options && typeof options.details === 'object' && options.details ? options.details : null;
        const detailMessage = details && typeof details.error === 'string' ? details.error : '';
        super(detailMessage || message);
        this.name = this.constructor.name;
        this.status = typeof options.status === 'number' ? options.status : undefined;
        this.code = typeof options.code === 'string' ? options.code : (details && typeof details.code === 'string' ? details.code : undefined);
        this.recoverable = options.recoverable === true || !!(details && details.recoverable === true);
        this.reauthRequired = options.reauthRequired === true || !!(details && details.reauthRequired === true);
        this.details = options.details;
    }
}

export class NetworkError extends ApiError {
    constructor(options = {}) {
        super('Network error', options);
    }
}

export class TimeoutError extends ApiError {
    constructor(options = {}) {
        super('Request timeout', options);
    }
}

export class ValidationError extends ApiError {
    constructor(options = {}) {
        super('Invalid response payload', options);
    }
}

export class HttpError extends ApiError {
    constructor(status, options = {}) {
        const safeStatus = Number.isFinite(status) ? status : 0;
        const message = safeStatus === 401 || safeStatus === 403 ? 'Unauthorized' : 'Request failed';
        super(message, { ...options, status: safeStatus });
    }
}

export class AuthExpiredError extends HttpError {
    constructor(status = 401, options = {}) {
        super(status, options);
        this.name = 'AuthExpiredError';
    }
}

export class CircuitBreakerOpenError extends ApiError {
    constructor(options = {}) {
        super('Service temporarily unavailable', { ...options, status: 503 });
    }
}

export function asHttpStatus(err) {
    if (!err || typeof err !== 'object') return null;
    const st = err.status;
    if (typeof st === 'number' && Number.isFinite(st)) return st;
    const rs = err.responseStatus;
    if (typeof rs === 'number' && Number.isFinite(rs)) return rs;
    return null;
}

export function isAbortError(err) {
    return !!(err && typeof err === 'object' && err.name === 'AbortError');
}
