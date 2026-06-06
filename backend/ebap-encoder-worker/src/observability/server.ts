import type { WorkerMetrics } from './metrics';
import { renderPrometheus } from './metrics';

export type HealthServer = {
    port: number;
    close: () => void;
};

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
        },
    });
}

export function startHealthServer(params: {
    port: number;
    metrics: WorkerMetrics;
}): HealthServer {
    const server: ReturnType<typeof Bun.serve> = Bun.serve({
        hostname: '0.0.0.0',
        port: params.port,
        fetch: (req: Request) => {
            const url = new URL(req.url);
            if (url.pathname === '/health') {
                return json({
                    status: 'ok',
                    service: 'ebap-encoder-worker',
                    activeSongId: params.metrics.activeSongId,
                    processedOk: params.metrics.processedOk,
                    processedError: params.metrics.processedError,
                    lastOkAtMs: params.metrics.lastOkAtMs,
                    lastErrorAtMs: params.metrics.lastErrorAtMs,
                });
            }

            if (url.pathname === '/metrics') {
                return new Response(renderPrometheus(params.metrics), {
                    status: 200,
                    headers: {
                        'content-type': 'text/plain; version=0.0.4; charset=utf-8',
                        'cache-control': 'no-store',
                    },
                });
            }

            return json({ error: 'not_found' }, 404);
        },
    });

    return {
        port: server.port ?? params.port,
        close: () => {
            try {
                server.stop(true);
            } catch {
            }
        },
    };
}
