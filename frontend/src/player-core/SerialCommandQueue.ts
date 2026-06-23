export class AbortError extends Error {
    readonly name = 'AbortError';

    constructor() {
        super('ABORTED');
    }
}

export function isAbortError(e: unknown): boolean {
    if (!e) return false;
    if (e instanceof AbortError) return true;
    if (typeof e === 'object' && (e as any).name === 'AbortError') return true;
    if (typeof e === 'object' && (e as any).code === 'ABORT_ERR') return true;
    return false;
}

export type CommandContext = { signal: AbortSignal };

export class SerialCommandQueue {
    private tail: Promise<void> = Promise.resolve();
    private controller: AbortController | null = null;
    private nonce = 0;

    run<T>(fn: (_ctx: CommandContext) => Promise<T> | T): Promise<T> {
        const prev = this.controller;
        const controller = new AbortController();
        this.controller = controller;
        const nonce = ++this.nonce;

        if (prev) {
            try {
                prev.abort();
            } catch {
            }
        }

        const signal = controller.signal;

        const work = this.tail.then(async () => {
            if (nonce !== this.nonce || signal.aborted) {
                throw new AbortError();
            }
            const value = await fn({ signal });
            if (nonce !== this.nonce || signal.aborted) {
                throw new AbortError();
            }
            return value;
        });

        this.tail = work.then(
            () => undefined,
            () => undefined,
        );

        return work;
    }

    abort(): void {
        const c = this.controller;
        this.controller = null;
        this.nonce++;
        if (!c) return;
        try {
            c.abort();
        } catch {
        }
    }
}
