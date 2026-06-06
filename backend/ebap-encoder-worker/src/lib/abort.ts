export type LinkedAbort = {
    controller: AbortController;
    signal: AbortSignal;
    dispose: () => void;
};

function createTimeoutSignal(timeoutMs: number): { signal: AbortSignal; dispose: () => void } | null {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return null;

    const maybeTimeout = (AbortSignal as any)?.timeout;
    if (typeof maybeTimeout === 'function') {
        const signal = maybeTimeout.call(AbortSignal, timeoutMs) as AbortSignal;
        return { signal, dispose: () => { } };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
        try {
            controller.abort();
        } catch {
        }
    }, timeoutMs);

    return {
        signal: controller.signal,
        dispose: () => {
            clearTimeout(timer);
        },
    };
}

function createAnySignal(signals: AbortSignal[]): { signal: AbortSignal; dispose: () => void } {
    const valid = signals.filter(Boolean);
    const maybeAny = (AbortSignal as any)?.any;
    if (typeof maybeAny === 'function') {
        const signal = maybeAny.call(AbortSignal, valid) as AbortSignal;
        return { signal, dispose: () => { } };
    }

    const controller = new AbortController();
    const listeners: Array<{ s: AbortSignal; fn: () => void }> = [];

    const abort = () => {
        try {
            controller.abort();
        } catch {
        }
    };

    for (const s of valid) {
        if (s.aborted) {
            abort();
            break;
        }
    }

    if (!controller.signal.aborted) {
        for (const s of valid) {
            const fn = () => abort();
            listeners.push({ s, fn });
            try {
                s.addEventListener('abort', fn, { once: true });
            } catch {
            }
        }
    }

    return {
        signal: controller.signal,
        dispose: () => {
            for (const { s, fn } of listeners) {
                try {
                    s.removeEventListener('abort', fn);
                } catch {
                }
            }
        },
    };
}

export function createLinkedAbort(params: {
    parent?: AbortSignal;
    timeoutMs?: number;
}): LinkedAbort {
    const controller = new AbortController();

    const timeout = params.timeoutMs !== undefined ? createTimeoutSignal(params.timeoutMs) : null;
    const any = createAnySignal([controller.signal, ...(params.parent ? [params.parent] : []), ...(timeout ? [timeout.signal] : [])]);

    return {
        controller,
        signal: any.signal,
        dispose: () => {
            timeout?.dispose();
            any.dispose();
        },
    };
}
