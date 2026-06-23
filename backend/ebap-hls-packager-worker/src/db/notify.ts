import type { Pool, PoolClient, Notification } from 'pg';

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (v: T) => void;
};

function createDeferred<T>(): Deferred<T> {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

export type JobNotifier = {
    waitForSignal: (params: { timeoutMs: number; abortSignal?: AbortSignal }) => Promise<boolean>;
    close: () => Promise<void>;
};

export function createJobNotifier(pool: Pool, channel = 'ebap_jobs'): JobNotifier {
    let client: PoolClient | null = null;
    let connecting: Promise<void> | null = null;
    let closed = false;

    let waiter: Deferred<void> | null = null;

    const wake = () => {
        const w = waiter;
        waiter = null;
        if (w) w.resolve();
    };

    const ensureConnected = async () => {
        if (closed) return;
        if (client) return;
        if (connecting) return await connecting;

        connecting = (async () => {
            let backoffMs = 250;
            while (!closed && !client) {
                try {
                    const c = await pool.connect();
                    await c.query(`LISTEN ${channel}`);

                    c.on('notification', (_msg: Notification) => {
                        wake();
                    });

                    c.on('error', () => {
                        try {
                            c.release(true);
                        } catch {
                        }
                        if (client === c) client = null;
                        wake();
                    });

                    client = c;
                    wake();
                    return;
                } catch {
                    await new Promise((r) => setTimeout(r, backoffMs));
                    backoffMs = Math.min(5000, Math.round(backoffMs * 1.7));
                }
            }
        })().finally(() => {
            connecting = null;
        });

        await connecting;
    };

    const close = async () => {
        closed = true;
        wake();
        const c = client;
        client = null;
        if (c) {
            try {
                await c.query('UNLISTEN *');
            } catch {
            }
            try {
                c.release(true);
            } catch {
            }
        }
    };

    const waitForSignal = async (params: { timeoutMs: number; abortSignal?: AbortSignal }): Promise<boolean> => {
        if (closed) return false;
        await ensureConnected();
        if (closed) return false;
        if (params.abortSignal?.aborted) return false;

        const timeoutMs = Math.max(0, Math.floor(params.timeoutMs));
        if (timeoutMs === 0) return false;

        waiter = waiter ?? createDeferred<void>();

        let timer: ReturnType<typeof setTimeout> | null = null;
        const timeout = new Promise<'timeout'>((resolve) => {
            timer = setTimeout(() => resolve('timeout'), timeoutMs);
        });

        const abortPromise = new Promise<'aborted'>((resolve) => {
            if (!params.abortSignal) return;
            const onAbort = () => {
                try {
                    params.abortSignal?.removeEventListener('abort', onAbort);
                } catch {
                }
                resolve('aborted');
            };
            try {
                params.abortSignal.addEventListener('abort', onAbort, { once: true });
            } catch {
            }
        });

        try {
            const winner = await Promise.race([waiter.promise.then(() => 'signal' as const), timeout, abortPromise]);
            return winner === 'signal';
        } finally {
            if (timer) clearTimeout(timer);
        }
    };

    return { waitForSignal, close };
}
