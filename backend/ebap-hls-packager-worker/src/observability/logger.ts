export type LogLevel = 'info' | 'warn' | 'error';

function safeStringify(obj: unknown): string {
    try {
        return JSON.stringify(obj);
    } catch {
        return JSON.stringify({ msg: 'unserializable_log_payload' });
    }
}

function toErrorShape(err: unknown): { name: string; message: string; stack?: string } {
    if (err instanceof Error) {
        return { name: err.name, message: err.message, stack: err.stack };
    }
    return { name: 'Error', message: typeof err === 'string' ? err : 'unknown_error' };
}

export function log(level: LogLevel, event: string, fields?: Record<string, unknown>): void {
    const entry: Record<string, unknown> = {
        ts: new Date().toISOString(),
        level,
        event,
        ...fields,
    };

    const line = safeStringify(entry);
    if (level === 'error') {
        console.error(line);
        return;
    }
    console.log(line);
}

export function logError(event: string, err: unknown, fields?: Record<string, unknown>): void {
    log('error', event, { ...fields, err: toErrorShape(err) });
}
