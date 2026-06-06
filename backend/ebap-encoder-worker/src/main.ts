import { loadConfig } from './config';
import { createDb } from './db/pool';
import { leaseOneSongForEbap, markSongError, releaseStuckProcessingJobs, touchProcessingSong } from './db/jobs';
import { hasEbapColumns } from './db/schema';
import { createEbapJobNotifier } from './db/notify';
import { createS3Client } from './storage/s3';
import { processOne } from './worker/processOne';
import { createWorkerMetrics } from './observability/metrics';
import { startHealthServer } from './observability/server';
import { log } from './observability/logger';
import { keyFingerprint8Hex } from './observability/fingerprint';

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

const STUCK_PROCESSING_AFTER_MS = 10 * 60_000;
const STUCK_CLEANUP_EVERY_MS = 5 * 60_000;
const PROCESSING_HEARTBEAT_MS = 30_000;

async function run(): Promise<void> {
    const cfg = loadConfig();
    const db = createDb(cfg);
    const s3 = createS3Client(cfg);
    const notifier = createEbapJobNotifier(db.pool);

    const masterKeyFps = await Promise.all(cfg.trackKeyMasterSecrets.map((s) => keyFingerprint8Hex(s).catch(() => null)))
        .then((fps) => fps.filter((v): v is string => Boolean(v)))
        .catch(() => [] as string[]);

    const masterKeyFp = masterKeyFps[0] ?? (await keyFingerprint8Hex(cfg.trackKeyMasterSecret).catch(() => null));

    log('info', 'ebap_worker_started', {
        service: 'ebap-encoder-worker',
        healthPort: cfg.healthPort,
        masterKeyFp,
        masterKeyFps,
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
        log('info', 'ebap_worker_stop_requested', { service: 'ebap-encoder-worker', signal });

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
        let ebapSchemaOk = false;
        let nextSchemaCheckAtMs = 0;
        let lastSchemaLogAtMs = 0;

        let cleanupStartupDone = false;
        let nextCleanupAtMs = 0;

        let backoffMs = cfg.worker.pollIntervalMs;

        const tryCleanup = async (phase: 'startup' | 'loop'): Promise<void> => {
            try {
                const released = await releaseStuckProcessingJobs(db.pool, { olderThanMs: STUCK_PROCESSING_AFTER_MS });
                if (released.length > 0) {
                    metrics.stuckReleasedTotal += released.length;
                    log('warn', 'ebap_worker_stuck_jobs_released', {
                        service: 'ebap-encoder-worker',
                        phase,
                        count: released.length,
                    });
                }
            } catch (e) {
                log('error', 'ebap_worker_cleanup_failed', { service: 'ebap-encoder-worker', phase, error: sanitizeErrorMessage(e) });
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
            if (!ebapSchemaOk) {
                const now = Date.now();
                if (now >= nextSchemaCheckAtMs) {
                    try {
                        ebapSchemaOk = await hasEbapColumns(db.pool);
                    } catch (e) {
                        ebapSchemaOk = false;
                    }
                    nextSchemaCheckAtMs = now + 15_000;

                    if (!ebapSchemaOk && now - lastSchemaLogAtMs >= 60_000) {
                        lastSchemaLogAtMs = now;
                        log('error', 'ebap_worker_schema_missing', {
                            service: 'ebap-encoder-worker',
                            requiredColumns: ['has_ebap', 'ebap_status', 'ebap_error'],
                            table: 'songs',
                            masterKeyFp,
                            masterKeyFps,
                        });
                    }
                }

                await notifier.waitForSignal({ timeoutMs: cfg.worker.idleSleepMs, abortSignal: stopController.signal });
                continue;
            }

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
                const lease = await leaseOneSongForEbap(db.pool);
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
                    forceReencode: lease.ebapStatus === 'reencode',
                    migrateExisting: lease.ebapStatus === 'migrate',
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
                log('error', 'ebap_encode_failed', { service: 'ebap-encoder-worker', songId, error: message, masterKeyFp, masterKeyFps });

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
            const finished = await Promise.race([
                job.then(() => true).catch(() => true),
                sleep(graceMs).then(() => false),
            ]);
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
    log('error', 'worker_fatal', { service: 'ebap-encoder-worker', error: msg });
    try {
        (globalThis as any).process?.exit?.(1);
        throw e;
    } catch {
        throw e;
    }
});
