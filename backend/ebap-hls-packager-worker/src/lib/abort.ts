export type LinkedAbort = {
    signal: AbortSignal;
    dispose: () => void;
};

export function createLinkedAbort(params: { parent?: AbortSignal; timeoutMs: number }): LinkedAbort {
    const ctrl = new AbortController();

    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeoutMs = Number.isFinite(params.timeoutMs) ? Math.floor(params.timeoutMs) : 0;
    if (timeoutMs > 0) {
        timer = setTimeout(() => {
            try {
                ctrl.abort();
            } catch {
            }
        }, timeoutMs);
    }

    let onAbort: (() => void) | null = null;
    if (params.parent) {
        onAbort = () => {
            try {
                ctrl.abort();
            } catch {
            }
        };
        try {
            params.parent.addEventListener('abort', onAbort, { once: true });
        } catch {
        }
    }

    return {
        signal: ctrl.signal,
        dispose: () => {
            if (timer) {
                try {
                    clearTimeout(timer);
                } catch {
                }
                timer = null;
            }
            if (params.parent && onAbort) {
                try {
                    params.parent.removeEventListener('abort', onAbort);
                } catch {
                }
            }
        },
    };
}
