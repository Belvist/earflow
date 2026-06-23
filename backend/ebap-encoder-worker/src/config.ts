import { z } from 'zod';
import { createHmac } from 'node:crypto';

const envSchema = z.object({
    NODE_ENV: z.string().optional().default('production'),

    SYSTEM_ROOT_SECRET: z.preprocess(
        (v: unknown) => {
            if (typeof v !== 'string') return undefined;
            const s = v.trim();
            return s.length > 0 ? s : undefined;
        },
        z.string().min(32).optional()
    ),

    HEALTH_PORT: z.coerce.number().int().positive().default(3091),

    DB_HOST: z.string().trim().min(1).default('postgres'),
    DB_PORT: z.coerce.number().int().positive().default(5432),
    DB_NAME: z.string().trim().min(1),
    DB_USER: z.string().trim().min(1),
    DB_PASSWORD: z.string().min(1),
    DB_MAX_CONNECTIONS: z.coerce.number().int().positive().default(6),
    DB_MIN_CONNECTIONS: z.coerce.number().int().nonnegative().default(1),

    MINIO_ENDPOINT: z.string().trim().min(1).default('minio'),
    MINIO_PORT: z.coerce.number().int().positive().default(9000),
    MINIO_USE_SSL: z
        .string()
        .optional()
        .default('false')
        .transform((v: string) => ['1', 'true', 'yes'].includes(String(v).toLowerCase())),
    MINIO_ACCESS_KEY: z.string().trim().min(1),
    MINIO_SECRET_KEY: z.string().trim().min(1),

    MINIO_BUCKET_AUDIO: z.string().trim().min(1).default('music-audio'),

    EBAP_MINIO_BUCKET: z.string().trim().min(1).default('ebap-cache'),
    EBAP_MANIFEST_PREFIX: z.string().trim().min(1).default('manifests/'),

    EBAP_TRACK_KEY_MASTER_SECRET: z.preprocess(
        (v: unknown) => {
            if (typeof v !== 'string') return undefined;
            const s = v.trim();
            return s.length > 0 ? s : undefined;
        },
        z.string().min(32).optional()
    ),

    EBAP_TRACK_KEY_MASTER_SECRETS: z.preprocess(
        (v: unknown) => {
            if (typeof v !== 'string') return undefined;
            const raw = v.trim();
            if (!raw) return undefined;
            const parts = raw
                .split(',')
                .map((p) => p.trim())
                .filter(Boolean);
            return parts.length > 0 ? parts : undefined;
        },
        z.array(z.string().min(32)).optional()
    ),

    EBAP_MAX_CHUNK_BYTES: z.coerce.number().int().positive().default(512 * 1024),
    EBAP_TARGET_CHUNK_SECONDS: z.coerce.number().positive().default(8),
    EBAP_S3_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
    EBAP_S3_DOWNLOAD_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
    EBAP_S3_UPLOAD_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
    EBAP_MAX_INFLIGHT_UPLOADS: z.coerce.number().int().positive().default(8),

    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(750),
    WORKER_IDLE_SLEEP_MS: z.coerce.number().int().positive().default(5000),
    WORKER_GRACEFUL_SHUTDOWN_MS: z.coerce.number().int().positive().default(30000),

    FFMPEG_BIN: z.string().trim().min(1).optional().default('ffmpeg'),
    FFMPEG_THREADS: z.coerce.number().int().positive().optional().default(2),
});

export type Config = {
    nodeEnv: string;
    healthPort: number;
    db: {
        host: string;
        port: number;
        name: string;
        user: string;
        password: string;
        maxConnections: number;
        minConnections: number;
    };
    minio: {
        endpoint: string;
        port: number;
        useSsl: boolean;
        accessKeyId: string;
        secretAccessKey: string;
        bucketAudio: string;
        bucketEbap: string;
        manifestPrefix: string;
    };
    limits: {
        maxChunkBytes: number;
        targetChunkSeconds: number;
        s3DownloadTimeoutMs: number;
        s3UploadTimeoutMs: number;
        maxInflightUploads: number;
    };
    worker: {
        pollIntervalMs: number;
        idleSleepMs: number;
        gracefulShutdownMs: number;
    };
    ffmpeg: {
        bin: string;
        threads: number;
    };
    trackKeyMasterSecret: Uint8Array;
    trackKeyMasterSecrets: Uint8Array[];
};

function deriveTrackKeyMasterSecret(systemRootSecret: string): Uint8Array {
    const digest = createHmac('sha256', systemRootSecret).update('ebap-track-key-master:v1').digest();
    return new Uint8Array(digest);
}

export function loadConfig(): Config {
    const env = envSchema.parse(Bun.env);

    const baseS3TimeoutMs = env.EBAP_S3_TIMEOUT_MS;
    const s3DownloadTimeoutMs = env.EBAP_S3_DOWNLOAD_TIMEOUT_MS ?? Math.max(baseS3TimeoutMs, 60000);
    const s3UploadTimeoutMs = env.EBAP_S3_UPLOAD_TIMEOUT_MS ?? baseS3TimeoutMs;

    const explicitTrackKeyMasterSecret = env.EBAP_TRACK_KEY_MASTER_SECRET ? new TextEncoder().encode(env.EBAP_TRACK_KEY_MASTER_SECRET) : null;
    const explicitTrackKeyMasterSecrets = env.EBAP_TRACK_KEY_MASTER_SECRETS
        ? (env.EBAP_TRACK_KEY_MASTER_SECRETS as string[]).map((s: string) => new TextEncoder().encode(s))
        : [];

    const derivedTrackKeyMasterSecret = env.SYSTEM_ROOT_SECRET ? deriveTrackKeyMasterSecret(env.SYSTEM_ROOT_SECRET) : null;

    const candidates = [explicitTrackKeyMasterSecret, ...explicitTrackKeyMasterSecrets, derivedTrackKeyMasterSecret]
        .filter((v): v is Uint8Array => Boolean(v && v.byteLength > 0));

    const trackKeyMasterSecrets = candidates;
    const trackKeyMasterSecret = trackKeyMasterSecrets[0] ?? null;
    if (!trackKeyMasterSecret) {
        throw new Error('EBAP_TRACK_KEY_MASTER_SECRET is required (or SYSTEM_ROOT_SECRET for derivation)');
    }

    return {
        nodeEnv: env.NODE_ENV,
        healthPort: env.HEALTH_PORT,
        db: {
            host: env.DB_HOST,
            port: env.DB_PORT,
            name: env.DB_NAME,
            user: env.DB_USER,
            password: env.DB_PASSWORD,
            maxConnections: Math.max(1, Math.min(50, env.DB_MAX_CONNECTIONS)),
            minConnections: Math.max(0, Math.min(env.DB_MIN_CONNECTIONS, env.DB_MAX_CONNECTIONS)),
        },
        minio: {
            endpoint: env.MINIO_ENDPOINT,
            port: env.MINIO_PORT,
            useSsl: env.MINIO_USE_SSL,
            accessKeyId: env.MINIO_ACCESS_KEY,
            secretAccessKey: env.MINIO_SECRET_KEY,
            bucketAudio: env.MINIO_BUCKET_AUDIO,
            bucketEbap: env.EBAP_MINIO_BUCKET,
            manifestPrefix: env.EBAP_MANIFEST_PREFIX,
        },
        limits: {
            maxChunkBytes: env.EBAP_MAX_CHUNK_BYTES,
            targetChunkSeconds: env.EBAP_TARGET_CHUNK_SECONDS,
            s3DownloadTimeoutMs,
            s3UploadTimeoutMs,
            maxInflightUploads: env.EBAP_MAX_INFLIGHT_UPLOADS,
        },
        worker: {
            pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
            idleSleepMs: env.WORKER_IDLE_SLEEP_MS,
            gracefulShutdownMs: env.WORKER_GRACEFUL_SHUTDOWN_MS,
        },
        ffmpeg: {
            bin: env.FFMPEG_BIN,
            threads: env.FFMPEG_THREADS,
        },
        trackKeyMasterSecret,
        trackKeyMasterSecrets,
    };
}
