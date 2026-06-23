import { z } from 'zod';

const envSchema = z.object({
    NODE_ENV: z.string().optional().default('production'),

    HEALTH_PORT: z.coerce.number().int().positive().default(3092),

    DB_HOST: z.string().trim().min(1).default('postgres'),
    DB_PORT: z.coerce.number().int().positive().default(5432),
    DB_NAME: z.string().trim().min(1),
    DB_USER: z.string().trim().min(1),
    DB_PASSWORD: z.string().min(1),
    DB_MAX_CONNECTIONS: z.coerce.number().int().positive().default(10),
    DB_MIN_CONNECTIONS: z.coerce.number().int().nonnegative().default(0),

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

    EBAP_HLS_MINIO_BUCKET: z.string().trim().min(1).default('ebap-hls'),
    EBAP_HLS_PREFIX: z.string().trim().min(1).default('hls/v1/'),

    EBAP_S3_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
    EBAP_S3_DOWNLOAD_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
    EBAP_S3_UPLOAD_TIMEOUT_MS: z.coerce.number().int().positive().optional(),

    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(750),
    WORKER_IDLE_SLEEP_MS: z.coerce.number().int().positive().default(5000),
    WORKER_GRACEFUL_SHUTDOWN_MS: z.coerce.number().int().positive().default(30000),

    FFMPEG_BIN: z.string().trim().min(1).optional().default('ffmpeg'),
    FFMPEG_THREADS: z.coerce.number().int().positive().optional().default(2),

    HLS_SEGMENT_SECONDS: z.coerce.number().positive().default(2),
    HLS_AAC_BITRATE_1_K: z.coerce.number().int().positive().default(256),
    HLS_AAC_BITRATE_2_K: z.coerce.number().int().positive().default(128),
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
        bucketHls: string;
        hlsPrefix: string;
    };
    limits: {
        s3DownloadTimeoutMs: number;
        s3UploadTimeoutMs: number;
        s3HeadTimeoutMs: number;
        hlsSegmentSeconds: number;
    };
    worker: {
        pollIntervalMs: number;
        idleSleepMs: number;
        gracefulShutdownMs: number;
    };
    ffmpeg: {
        bin: string;
        threads: number;
        aacBitratesK: [number, number];
    };
};

export function loadConfig(): Config {
    const env = envSchema.parse(Bun.env);

    const baseS3TimeoutMs = env.EBAP_S3_TIMEOUT_MS;
    const s3DownloadTimeoutMs = env.EBAP_S3_DOWNLOAD_TIMEOUT_MS ?? Math.max(baseS3TimeoutMs, 60_000);
    const s3UploadTimeoutMs = env.EBAP_S3_UPLOAD_TIMEOUT_MS ?? baseS3TimeoutMs;

    const a1 = Math.max(32, Math.min(512, Math.trunc(env.HLS_AAC_BITRATE_1_K)));
    const a2 = Math.max(32, Math.min(512, Math.trunc(env.HLS_AAC_BITRATE_2_K)));

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
            bucketHls: env.EBAP_HLS_MINIO_BUCKET,
            hlsPrefix: env.EBAP_HLS_PREFIX,
        },
        limits: {
            s3DownloadTimeoutMs,
            s3UploadTimeoutMs,
            s3HeadTimeoutMs: baseS3TimeoutMs,
            hlsSegmentSeconds: Math.max(1, Math.min(10, Number(env.HLS_SEGMENT_SECONDS))),
        },
        worker: {
            pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
            idleSleepMs: env.WORKER_IDLE_SLEEP_MS,
            gracefulShutdownMs: env.WORKER_GRACEFUL_SHUTDOWN_MS,
        },
        ffmpeg: {
            bin: env.FFMPEG_BIN,
            threads: env.FFMPEG_THREADS,
            aacBitratesK: [a1, a2],
        },
    };
}
