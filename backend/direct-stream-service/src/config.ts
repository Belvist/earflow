import { createHmac } from 'node:crypto';
import { z } from 'zod';

export type Config = {
    port: number;
    nodeEnv: string;
    systemRootSecret: Uint8Array;
    urlTokenSecrets: Uint8Array[];
    urlTokenTtlSeconds: number;
    publicStreamingOrigin: string;
    streamCookie: {
        name: string;
        ttlSeconds: number;
        domain: string;
    };
    libraryUserId: number;
    database: {
        host: string;
        port: number;
        name: string;
        user: string;
        password: string;
        sslMode: 'disable' | 'require';
        maxConnections: number;
        idleTimeoutSeconds: number;
        connectionTimeoutSeconds: number;
        prepare: boolean;
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
        s3TimeoutMs: number;
        maxManifestBytes: number;
    };
    redis: {
        host: string;
        port: number;
        password: string | null;
        sessionTtlSeconds: number;
    };
    playback: {
        tokenTtlSeconds: number;
        sessionTtlSeconds: number;
        maxActiveSessionsPerUser: number;
        mediaRateLimitWindowSeconds: number;
        mediaRateLimitMaxRequests: number;
    };
    hlsSegmentCache: {
        enabled: boolean;
        ttlSeconds: number;
    };
    streamTicket: {
        accept: boolean;
        enforce: boolean;
        jwtSecret: Uint8Array;
        authRedis: {
            host: string;
            port: number;
            password: string | null;
        };
        revokeChannel: string;
    };
};

const envSchema = z.object({
    PORT: z.coerce.number().int().positive().default(3096),
    NODE_ENV: z.string().trim().min(1).default('production'),

    SYSTEM_ROOT_SECRET: z.string().trim().min(32),

    DIRECT_STREAM_URLTOKEN_SECRET: z.preprocess(
        (v: unknown) => {
            if (v === undefined || v === null) return undefined;
            const raw = String(v).trim();
            return raw ? raw : undefined;
        },
        z.string().trim().min(32).optional()
    ),
    DIRECT_STREAM_URLTOKEN_SECRETS: z
        .preprocess(
            (v: unknown) => {
                if (v === undefined || v === null) return undefined;
                const raw = String(v).trim();
                if (!raw) return undefined;
                const parts = raw
                    .split(',')
                    .map((p) => p.trim())
                    .filter(Boolean);
                return parts.length > 0 ? parts : undefined;
            },
            z.array(z.string().trim().min(32)).optional()
        ),

    DIRECT_STREAM_URLTOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),

    DIRECT_STREAM_PUBLIC_ORIGIN: z.string().trim().min(1).default('https://strmhaha.earflow.ru'),

    DIRECT_STREAM_COOKIE_NAME: z.string().trim().min(1).default('mp_stream'),
    DIRECT_STREAM_COOKIE_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
    DIRECT_STREAM_COOKIE_DOMAIN: z.string().trim().min(1).default('.earflow.ru'),

    LIBRARY_USER_ID: z.coerce.number().int().positive().default(1),

    DB_HOST: z.string().trim().min(1),
    DB_PORT: z.coerce.number().int().positive().default(5432),
    DB_NAME: z.string().trim().min(1),
    DB_USER: z.string().trim().min(1),
    DB_PASSWORD: z.string().default(''),
    DB_MAX_CONNECTIONS: z.coerce.number().int().positive().default(10),
    DB_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(30),
    DB_CONNECTION_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(5),
    DB_PREPARE: z
        .string()
        .optional()
        .default('true')
        .transform((v: string) => ['1', 'true', 'yes', 'on'].includes(String(v).trim().toLowerCase())),
    DB_SSL: z
        .string()
        .optional()
        .transform((v: string | undefined) => {
            const raw = String(v ?? '').trim().toLowerCase();
            if (raw === 'require' || raw === 'true' || raw === '1' || raw === 'yes') return 'require' as const;
            return 'disable' as const;
        }),

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
    EBAP_MAX_MANIFEST_BYTES: z.coerce.number().int().positive().default(256 * 1024),

    REDIS_HOST: z.string().trim().min(1).default('redis'),
    REDIS_PORT: z.coerce.number().int().positive().default(6379),
    REDIS_PASSWORD: z.string().optional().default(''),
    DIRECT_STREAM_SESSION_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
    DIRECT_STREAM_PLAYBACK_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(90),
    DIRECT_STREAM_PLAYBACK_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(15 * 60),
    DIRECT_STREAM_PLAYBACK_MAX_ACTIVE_SESSIONS_PER_USER: z.coerce.number().int().positive().default(4),
    DIRECT_STREAM_PLAYBACK_MEDIA_RL_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
    DIRECT_STREAM_PLAYBACK_MEDIA_RL_MAX_REQUESTS: z.coerce.number().int().positive().default(900),
    DIRECT_STREAM_MAX_CHUNK_BYTES: z.coerce.number().int().nonnegative().default(256 * 1024),

    DIRECT_STREAM_HLS_SEGMENT_CACHE_ENABLED: z
        .string()
        .optional()
        .default('true')
        .transform((v: string) => ['1', 'true', 'yes', 'on'].includes(String(v).trim().toLowerCase())),
    DIRECT_STREAM_HLS_SEGMENT_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(604800),

    STREAM_TICKET_ACCEPT: z
        .string()
        .optional()
        .default('false')
        .transform((v: string) => ['1', 'true', 'yes', 'on'].includes(String(v).trim().toLowerCase())),
    STREAM_TICKET_ENFORCE: z
        .string()
        .optional()
        .default('false')
        .transform((v: string) => ['1', 'true', 'yes', 'on'].includes(String(v).trim().toLowerCase())),
    STREAM_TICKET_JWT_SECRET: z.preprocess(
        (v: unknown) => {
            if (v === undefined || v === null) return undefined;
            const raw = String(v).trim();
            return raw ? raw : undefined;
        },
        z.string().trim().min(32).optional()
    ),
    STREAM_TICKET_AUTH_REDIS_HOST: z.string().trim().min(1).default('redis-auth'),
    STREAM_TICKET_AUTH_REDIS_PORT: z.coerce.number().int().positive().default(6379),
    STREAM_TICKET_AUTH_REDIS_PASSWORD: z.string().optional().default(''),
    STREAM_TICKET_REVOKE_CHANNEL: z.string().trim().optional().default(''),
});

function deriveUrlTokenSecret(systemRootSecret: string): Uint8Array {
    const digest = createHmac('sha256', systemRootSecret).update('direct-stream:urltoken:v1').digest();
    return new Uint8Array(digest);
}

export function loadConfig(): Config {
    const env = envSchema.parse(Bun.env);

    const systemRootSecretBytes = new TextEncoder().encode(env.SYSTEM_ROOT_SECRET);

    const explicitPrimary = env.DIRECT_STREAM_URLTOKEN_SECRET
        ? new TextEncoder().encode(env.DIRECT_STREAM_URLTOKEN_SECRET)
        : null;
    const explicitRotated = env.DIRECT_STREAM_URLTOKEN_SECRETS
        ? env.DIRECT_STREAM_URLTOKEN_SECRETS.map((s: string) => new TextEncoder().encode(s))
        : [];

    const derived = deriveUrlTokenSecret(env.SYSTEM_ROOT_SECRET);

    const urlTokenSecrets = [explicitPrimary, ...explicitRotated, derived].filter(
        (v): v is Uint8Array => Boolean(v && v.byteLength > 0)
    );

    const ttlSeconds = Math.max(60, Math.min(7200, Math.trunc(env.DIRECT_STREAM_URLTOKEN_TTL_SECONDS)));

    const cookieTtlSeconds = Math.max(60, Math.min(24 * 3600, Math.trunc(env.DIRECT_STREAM_COOKIE_TTL_SECONDS)));
    const cookieName = String(env.DIRECT_STREAM_COOKIE_NAME || '').trim() || 'mp_stream';
    const cookieDomain = String(env.DIRECT_STREAM_COOKIE_DOMAIN || '').trim() || '.earflow.ru';

    const publicStreamingOrigin = (() => {
        const raw = String(env.DIRECT_STREAM_PUBLIC_ORIGIN || '').trim();
        try {
            const u = new URL(raw);
            if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'https://strmhaha.earflow.ru';
            return u.origin;
        } catch {
            return 'https://strmhaha.earflow.ru';
        }
    })();

    return {
        port: env.PORT,
        nodeEnv: env.NODE_ENV,
        systemRootSecret: systemRootSecretBytes,
        urlTokenSecrets,
        urlTokenTtlSeconds: ttlSeconds,
        publicStreamingOrigin,
        streamCookie: {
            name: cookieName,
            ttlSeconds: cookieTtlSeconds,
            domain: cookieDomain,
        },
        libraryUserId: env.LIBRARY_USER_ID,
        database: {
            host: env.DB_HOST,
            port: env.DB_PORT,
            name: env.DB_NAME,
            user: env.DB_USER,
            password: env.DB_PASSWORD,
            sslMode: env.DB_SSL,
            maxConnections: Math.max(1, Math.min(100, Math.trunc(env.DB_MAX_CONNECTIONS))),
            idleTimeoutSeconds: Math.max(1, Math.min(300, Math.trunc(env.DB_IDLE_TIMEOUT_SECONDS))),
            connectionTimeoutSeconds: Math.max(1, Math.min(60, Math.trunc(env.DB_CONNECTION_TIMEOUT_SECONDS))),
            prepare: env.DB_PREPARE,
        },
        redis: {
            host: String(env.REDIS_HOST || 'redis').trim(),
            port: Number(env.REDIS_PORT) || 6379,
            password: env.REDIS_PASSWORD ? String(env.REDIS_PASSWORD).trim() : null,
            sessionTtlSeconds: Math.max(60, Math.min(3600, Math.trunc(env.DIRECT_STREAM_SESSION_CACHE_TTL_SECONDS))),
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
            s3TimeoutMs: Math.max(1000, Math.min(60_000, Math.trunc(env.EBAP_S3_TIMEOUT_MS))),
            maxManifestBytes: Math.max(1024, Math.min(2 * 1024 * 1024, Math.trunc(env.EBAP_MAX_MANIFEST_BYTES))),
        },
        playback: {
            tokenTtlSeconds: Math.max(60, Math.min(120, Math.trunc(env.DIRECT_STREAM_PLAYBACK_TOKEN_TTL_SECONDS))),
            sessionTtlSeconds: Math.max(10 * 60, Math.min(20 * 60, Math.trunc(env.DIRECT_STREAM_PLAYBACK_SESSION_TTL_SECONDS))),
            maxActiveSessionsPerUser: Math.max(1, Math.min(16, Math.trunc(env.DIRECT_STREAM_PLAYBACK_MAX_ACTIVE_SESSIONS_PER_USER))),
            mediaRateLimitWindowSeconds: Math.max(1, Math.min(300, Math.trunc(env.DIRECT_STREAM_PLAYBACK_MEDIA_RL_WINDOW_SECONDS))),
            mediaRateLimitMaxRequests: Math.max(60, Math.min(5000, Math.trunc(env.DIRECT_STREAM_PLAYBACK_MEDIA_RL_MAX_REQUESTS))),
            maxChunkBytes: Math.max(0, Math.min(4 * 1024 * 1024, Math.trunc(env.DIRECT_STREAM_MAX_CHUNK_BYTES))),
        },
        hlsSegmentCache: {
            enabled: env.DIRECT_STREAM_HLS_SEGMENT_CACHE_ENABLED,
            ttlSeconds: Math.max(3600, Math.min(30 * 24 * 3600, Math.trunc(env.DIRECT_STREAM_HLS_SEGMENT_CACHE_TTL_SECONDS))),
        },
        streamTicket: {
            accept: env.STREAM_TICKET_ACCEPT,
            enforce: env.STREAM_TICKET_ENFORCE,
            jwtSecret: new TextEncoder().encode(
                env.STREAM_TICKET_JWT_SECRET || String(Bun.env.JWT_SECRET || '').trim() || env.SYSTEM_ROOT_SECRET
            ),
            authRedis: {
                host: String(env.STREAM_TICKET_AUTH_REDIS_HOST || 'redis-auth').trim(),
                port: Number(env.STREAM_TICKET_AUTH_REDIS_PORT) || 6379,
                password: env.STREAM_TICKET_AUTH_REDIS_PASSWORD
                    ? String(env.STREAM_TICKET_AUTH_REDIS_PASSWORD).trim()
                    : (env.REDIS_PASSWORD ? String(env.REDIS_PASSWORD).trim() : null),
            },
            revokeChannel: String(env.STREAM_TICKET_REVOKE_CHANNEL || Bun.env.AUTH_REVOKE_PUBSUB_CHANNEL || '').trim()
                || 'earflow:auth:session:revoke:v1',
        },
    };
}
