type LogLevel = 'error' | 'info' | 'warn';

type LogPayload = {
    ts: string;
    level: LogLevel;
    service: string;
    event: string;
    [k: string]: unknown;
};

export function logError(event: string, fields: Record<string, unknown>, err?: unknown): void {
    const e = err instanceof Error ? err : null;
    const payload: LogPayload = {
        ts: new Date().toISOString(),
        level: 'error',
        service: 'ebap-hls-adapter',
        event,
        ...fields,
        errorName: e?.name,
        errorMessage: e?.message,
    };
    try {
        console.error(JSON.stringify(payload));
    } catch {
    }
}
