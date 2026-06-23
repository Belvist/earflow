import { loadConfig } from './config';
import { createDb } from './db/pool';
import { createJobNotifier } from './db/notify';
import { leaseOneSongForHls, markSongError, releaseStuckProcessingJobs, touchProcessingSong } from './db/jobs';
import { createS3Client } from './storage/s3';
import { processOne } from './worker/processOne';
import { createWorkerMetrics } from './observability/metrics';
import { startHealthServer } from './observability/server';
import { log } from './observability/logger';

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeStringifyUnknown(value: unknown): string {
    if (value instanceof Error) return value.message;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
    if (value === null || value === undefined) return 'unknown_error';
    try {
        const json = JSON.stringify(value);
        return typeof json === 'string' && json.length > 0 ? json : 'unknown_error';
    } catch {
        return 'unknown_error';
    }
}

function sanitizeErrorMessage(e: unknown): string {
    const msg = safeStringifyUnknown(e).replaceAll(/[\r\n\t]+/g, ' ');
    return msg.slice(0, 2000);
}

function isAbortError(e: unknown): boolean {
    if (!e || typeof e !== 'object') return false;
    const name = (e as any).name;
    return name === 'AbortError';
}

function clampBackoffMs(ms: number): number {
    const v = Number(ms);
    if (!Number.isFinite(v) || v <= 0) return 1000;
    return Math.max(250, Math.min(60000, Math.floor(v)));
}

const STUCK_PROCESSING_AFTER_MS = 30 * 60_000;
const STUCK_CLEANUP_EVERY_MS = 5 * 60_000;
const PROCESSING_HEARTBEAT_MS = 30_000;

async function run(): Promise<void> {
    const cfg = loadConfig();
    const db = createDb(cfg);
    const s3 = createS3Client(cfg);
    const notifier = createJobNotifier(db.pool, 'ebap_jobs');

    log('info', 'hls_packager_started', {
        service: 'ebap-hls-packager-worker',
        healthPort: cfg.healthPort,
        bucketHls: cfg.minio.bucketHls,
    });

    const metrics = createWorkerMetrics();
    const health = startHealthServer({ port: cfg.healthPort, metrics });

    const stopController = new AbortController();
    let stopping = false;
    let currentJobAbort: AbortController | null = null;
    let currentJob: Promise<void> | null = null;
    let gracefulAbortTimer: ReturnType<typeof setTimeout> | null = null;

    const requestStop = (signal: string) => {
        if (stopping) return;
        stopping = true;
        log('info', 'hls_packager_stop_requested', { service: 'ebap-hls-packager-worker', signal });

        const graceMs = Math.max(0, Math.floor(cfg.worker.gracefulShutdownMs));
        if (graceMs > 0) {
            gracefulAbortTimer = setTimeout(() => {
                try {
                    currentJobAbort?.abort();
                } catch {
                }
            }, graceMs);
        }

        try {
            stopController.abort();
        } catch {
        }
    };

    try {
        if (typeof process !== 'undefined' && typeof process.on === 'function') {
            process.on('SIGINT', () => requestStop('SIGINT'));
            process.on('SIGTERM', () => requestStop('SIGTERM'));
        }
    } catch {
    }

    try {
        let cleanupStartupDone = false;
        let nextCleanupAtMs = 0;

        let backoffMs = cfg.worker.pollIntervalMs;

        const tryCleanup = async (phase: 'startup' | 'loop'): Promise<void> => {
            try {
                const released = await releaseStuckProcessingJobs(db.pool, { olderThanMs: STUCK_PROCESSING_AFTER_MS });
                if (released.length > 0) {
                    metrics.stuckReleasedTotal += released.length;
                    log('warn', 'hls_packager_stuck_jobs_released', { service: 'ebap-hls-packager-worker', phase, count: released.length });
                }
            } catch (e) {
                log('error', 'hls_packager_cleanup_failed', { service: 'ebap-hls-packager-worker', phase, error: sanitizeErrorMessage(e) });
            }
        };

        const startHeartbeat = (songId: number, stopSignal: { aborted: boolean }): Promise<void> =>
            (async () => {
                while (!stopSignal.aborted && !stopController.signal.aborted) {
                    await sleep(PROCESSING_HEARTBEAT_MS);
                    if (stopSignal.aborted || stopController.signal.aborted) return;
                    await touchProcessingSong(db.pool, { songId }).catch(() => { });
                }
            })();

        while (!stopController.signal.aborted) {
            if (!cleanupStartupDone) {
                cleanupStartupDone = true;
                await tryCleanup('startup');
                nextCleanupAtMs = Date.now() + STUCK_CLEANUP_EVERY_MS;
            }

            const now = Date.now();
            if (now >= nextCleanupAtMs) {
                nextCleanupAtMs = now + STUCK_CLEANUP_EVERY_MS;
                await tryCleanup('loop');
            }

            try {
                const lease = await leaseOneSongForHls(db.pool);
                if (!lease) {
                    backoffMs = cfg.worker.pollIntervalMs;
                    await notifier.waitForSignal({ timeoutMs: cfg.worker.idleSleepMs, abortSignal: stopController.signal });
                    continue;
                }

                metrics.activeSongId = lease.songId;

                currentJobAbort = new AbortController();
                const jobSignal = currentJobAbort.signal;

                const heartbeatAbort = new AbortController();
                const heartbeat = startHeartbeat(lease.songId, heartbeatAbort.signal);

                currentJob = processOne({
                    cfg,
                    db: db.pool,
                    s3,
                    abortSignal: jobSignal,
                    songId: lease.songId,
                    filePath: lease.filePath,
                    forceReencode: lease.hlsStatus === 'reencode',
                }).then(() => { });

                try {
                    await currentJob;
                } finally {
                    try {
                        heartbeatAbort.abort();
                    } catch {
                    }
                    await heartbeat.catch(() => { });
                }

                metrics.processedOk += 1;
                metrics.lastOkAtMs = Date.now();
                backoffMs = cfg.worker.pollIntervalMs;
            } catch (e) {
                if (stopController.signal.aborted && isAbortError(e)) {
                    break;
                }

                const message = sanitizeErrorMessage(e);
                const songId = metrics.activeSongId;
                log('error', 'hls_packaging_failed', { service: 'ebap-hls-packager-worker', songId, error: message });

                if (songId && Number.isInteger(songId) && songId > 0) {
                    await markSongError(db.pool, { songId, error: message });
                    metrics.processedError += 1;
                    metrics.lastErrorAtMs = Date.now();
                    metrics.lastErrorSongId = songId;
                }

                backoffMs = clampBackoffMs(backoffMs * 2);
                await sleep(backoffMs);
            } finally {
                metrics.activeSongId = null;
                currentJobAbort = null;
                currentJob = null;
            }
        }
    } finally {
        const graceMs = Math.max(0, Math.floor(cfg.worker.gracefulShutdownMs));
        const job = currentJob;
        const jobAbort = currentJobAbort;

        if (gracefulAbortTimer) {
            try {
                clearTimeout(gracefulAbortTimer);
            } catch {
            }
            gracefulAbortTimer = null;
        }

        if (job) {
            const finished = await Promise.race([job.then(() => true).catch(() => true), sleep(graceMs).then(() => false)]);
            if (!finished) {
                try {
                    jobAbort?.abort();
                } catch {
                }
                await job.catch(() => { });
            }
        }

        health.close();
        await notifier.close().catch(() => { });
        await db.close().catch(() => { });
    }
}

run().catch((e) => {
    const msg = e instanceof Error ? e.message : String(e || 'fatal');
    log('error', 'worker_fatal', { service: 'ebap-hls-packager-worker', error: msg });
    try {
        (globalThis as any).process?.exit?.(1);
        throw e;
    } catch {
        throw e;
    }
});
