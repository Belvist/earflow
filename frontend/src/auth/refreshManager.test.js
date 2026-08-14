import { classifyRefreshResult } from './refreshManager';

describe('classifyRefreshResult (refresh endpoint contract)', () => {
    it('SESSION_UNVERIFIED from refresh is fatal (dead session), not recoverable', () => {
        const result = classifyRefreshResult({
            ok: false,
            status: 401,
            code: 'SESSION_UNVERIFIED',
            recoverable: true,
        });
        expect(result.fatal).toBe(true);
        expect(result.transient).toBe(false);
        expect(result.state).toBe('SESSION_UNVERIFIED');
    });

    it('NO_SESSION from refresh is fatal', () => {
        const result = classifyRefreshResult({ ok: false, status: 401, code: 'NO_SESSION' });
        expect(result.fatal).toBe(true);
    });

    it('CSRF errors from refresh stay transient', () => {
        const result = classifyRefreshResult({ ok: false, status: 403, code: 'CSRF_INVALID' });
        expect(result.fatal).toBe(false);
        expect(result.transient).toBe(true);
    });

    it('network failure (status 0) stays transient/degraded', () => {
        const result = classifyRefreshResult({ ok: false, status: 0 });
        expect(result.fatal).toBe(false);
        expect(result.transient).toBe(true);
        expect(result.state).toBe('degraded');
    });

    it('successful refresh is ok', () => {
        const result = classifyRefreshResult({ ok: true, status: 204 });
        expect(result.ok).toBe(true);
        expect(result.fatal).toBe(false);
    });
});
