import { z } from 'zod';
import { createHmac } from 'node:crypto';

export type Config = {
    port: number;
    nodeEnv: string;
    systemRootSecret: Uint8Array;
    trackKeyMasterSecrets: Uint8Array[];
    lyricsServiceUrl: string;
    serviceToken: {
        endpoint: string;
        serviceName: string;
        serviceKey: string;
    };
    signedUrls: {
        enabled: boolean;
        ttlSeconds: number;
        playlistTtlSeconds: number;
        assetTtlSeconds: number;
        secrets: Uint8Array[];
        assetTokenOnly: boolean;
        playlistTokenOnly: boolean;
        playlistRequireCookie: boolean;
    };
    cookie: {
        secure: boolean;
        sameSite: 'lax' | 'strict' | 'none';
        domain: string | null;
        ttlSeconds: number;
        secrets: Uint8Array[];
    };
    redis: {
        host: string;
        port: number;
        password: string;
    };
    minio: {
        endpoint: string;
        port: number;
        useSsl: boolean;
        accessKeyId: string;
        secretAccessKey: string;
        bucketEbap: string;
        bucketHls: string;
        manifestPrefix: string;
        hlsPrefix: string;
        s3TimeoutMs: number;
    };
    limits: {
        maxManifestBytes: number;
        maxChunkBytes: number;
        maxInflightBytes: number;
        maxTranscodeJobs: number;
        lockTtlMs: number;
        waitReadyMs: number;
        hlsSegmentSeconds: number;
        sessionRateLimitPerWindow: number;
        sessionRateLimitWindowSeconds: number;
        maxActiveTracks: number;
        activeTracksWindowSeconds: number;
        assetRateLimitPerWindow: number;
        assetRateLimitWindowSeconds: number;
    };
    ffmpeg: {
        bin: string;
        threads: number;
        aacBitrateK: number;
    };
    streamTicket: {
        accept: boolean;
        enforce: boolean;
        jwtSecret: Uint8Array;
        authRedis: {
            host: string;
            port: number;
            password: string;
        };
        revokeChannel: string;
    };
};

const envSchema = z.object({
    PORT: z.coerce.number().int().positive().default(3095),
    NODE_ENV: z.string().optional().default('production'),

    LYRICS_SERVICE_URL: z.string().trim().min(1).default('http://lyrics-service:3010'),

    SERVICE_TOKEN_ENDPOINT: z.string().trim().min(1).default('http://database-service:3003/auth/service-token'),
    SERVICE_TOKEN_SERVICE_NAME: z.string().trim().min(1).default('ebap-hls-adapter'),
    SERVICE_TOKEN_SERVICE_KEY: z.string().trim().optional().default(''),

    SYSTEM_ROOT_SECRET: z.string().min(32),
    EBAP_TRACK_KEY_MASTER_SECRET: z.preprocess(
        (v: unknown) => {
            if (v === undefined || v === null) return undefined;
            if (typeof v !== 'string') return undefined;
            const s = v.trim();
            return s.length > 0 ? s : undefined;
        },
        z.string().min(32).optional()
    ),

    EBAP_TRACK_KEY_MASTER_SECRETS: z.preprocess(
        (v: unknown) => {
            if (v === undefined || v === null) return undefined;
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

    COOKIE_SECURE: z
        .string()
        .optional()
        .transform((v: string | undefined) => {
            if (v === undefined) return undefined;
            return ['1', 'true', 'yes'].includes(String(v).toLowerCase());
        }),
    COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).optional(),
    COOKIE_DOMAIN: z.preprocess(
        (v: unknown) => {
            if (v === undefined || v === null) return undefined;
            if (typeof v !== 'string') return undefined;
            const s = v.trim();
            return s.length > 0 ? s : undefined;
        },
        z.string().optional()
    ),

    EBAP_HLS_COOKIE_SECRET: z.string().min(32),
    EBAP_HLS_COOKIE_SECRETS: z.preprocess(
        (v: unknown) => {
            if (v === undefined || v === null) return undefined;
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
    EBAP_HLS_COOKIE_TTL_SECONDS: z.coerce.number().int().positive().default(15 * 60),

    EBAP_HLS_SIGNED_URLS: z
        .string()
        .optional()
        .transform((v: string | undefined) => {
            if (v === undefined) return false;
            return ['1', 'true', 'yes'].includes(String(v).toLowerCase());
        }),
    EBAP_HLS_URLTOKEN_SECRET: z.preprocess(
        (v: unknown) => {
            if (v === undefined || v === null) return undefined;
            if (typeof v !== 'string') return undefined;
            const s = v.trim();
            return s.length > 0 ? s : undefined;
        },
        z.string().min(32).optional()
    ),
    EBAP_HLS_URLTOKEN_SECRETS: z.preprocess(
        (v: unknown) => {
            if (v === undefined || v === null) return undefined;
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
    EBAP_HLS_URLTOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(120),
    EBAP_HLS_URLTOKEN_TTL_PLAYLIST_SECONDS: z.coerce.number().int().positive().optional(),
    EBAP_HLS_URLTOKEN_TTL_ASSET_SECONDS: z.coerce.number().int().positive().optional(),
    EBAP_HLS_SIGNED_URLS_ASSET_TOKEN_ONLY: z
        .string()
        .optional()
        .transform((v: string | undefined) => {
            if (v === undefined) return false;
            return ['1', 'true', 'yes'].includes(String(v).toLowerCase());
        }),
    EBAP_HLS_SIGNED_URLS_PLAYLIST_TOKEN_ONLY: z
        .string()
        .optional()
        .transform((v: string | undefined) => {
            if (v === undefined) return false;
            return ['1', 'true', 'yes'].includes(String(v).toLowerCase());
        }),
    EBAP_HLS_SIGNED_URLS_PLAYLIST_REQUIRE_COOKIE: z
        .string()
        .optional()
        .transform((v: string | undefined) => {
            if (v === undefined) return false;
            return ['1', 'true', 'yes'].includes(String(v).toLowerCase());
        }),

    EBAP_HLS_SESSION_RL_PER_WINDOW: z.coerce.number().int().positive().default(30),
    EBAP_HLS_SESSION_RL_WINDOW_SECONDS: z.coerce.number().int().positive().default(10),

    EBAP_HLS_MAX_ACTIVE_TRACKS: z.coerce.number().int().positive().default(2),
    EBAP_HLS_ACTIVE_TRACKS_WINDOW_SECONDS: z.coerce.number().int().positive().default(12),
    EBAP_HLS_ASSET_RL_PER_WINDOW: z.coerce.number().int().positive().default(120),
    EBAP_HLS_ASSET_RL_WINDOW_SECONDS: z.coerce.number().int().positive().default(10),

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
    STREAM_TICKET_AUTH_REDIS_PASSWORD: z.preprocess(
        (v: unknown) => {
            if (v === undefined || v === null) return undefined;
            if (typeof v !== 'string') return undefined;
            const s = v.trim();
            return s.length > 0 ? s : undefined;
        },
        z.string().optional()
    ),
    STREAM_TICKET_REVOKE_CHANNEL: z.string().trim().optional().default(''),

    REDIS_HOST: z.string().trim().min(1).default('redis'),
    REDIS_PORT: z.coerce.number().int().positive().default(6379),
    REDIS_PASSWORD: z.preprocess(
        (v: unknown) => {
            if (v === undefined || v === null) return undefined;
            if (typeof v !== 'string') return undefined;
            const s = v.trim();
            return s.length > 0 ? s : undefined;
        },
        z.string().optional()
    ),

    MINIO_ENDPOINT: z.string().trim().min(1).default('minio'),
    MINIO_PORT: z.coerce.number().int().positive().default(9000),
    MINIO_USE_SSL: z
        .string()
        .optional()
        .default('false')
        .transform((v: string) => ['1', 'true', 'yes'].includes(String(v).toLowerCase())),
    MINIO_ACCESS_KEY: z.string().trim().min(1),
    MINIO_SECRET_KEY: z.string().trim().min(1),

    EBAP_MINIO_BUCKET: z.string().trim().min(1).default('ebap-cache'),
    EBAP_MANIFEST_PREFIX: z.string().trim().min(1).default('manifests/'),

    EBAP_HLS_MINIO_BUCKET: z.string().trim().min(1).default('ebap-hls'),
    EBAP_HLS_PREFIX: z.string().trim().min(1).default('hls/v1/'),

    EBAP_S3_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),

    EBAP_MAX_MANIFEST_BYTES: z.coerce.number().int().positive().default(256 * 1024),
    EBAP_MAX_CHUNK_BYTES: z.coerce.number().int().positive().default(1024 * 1024),
    EBAP_MAX_INFLIGHT_BYTES: z.coerce.number().int().positive().default(8 * 1024 * 1024),

    EBAP_HLS_MAX_TRANSCODE_JOBS: z.coerce.number().int().positive().default(1),
    EBAP_HLS_LOCK_TTL_MS: z.coerce.number().int().positive().default(10 * 60_000),
    EBAP_HLS_WAIT_READY_MS: z.coerce.number().int().positive().default(30_000),
    EBAP_HLS_SEGMENT_SECONDS: z.coerce.number().positive().default(2),

    FFMPEG_BIN: z.string().trim().min(1).default('ffmpeg'),
    FFMPEG_THREADS: z.coerce.number().int().positive().default(2),
    EBAP_HLS_AAC_BITRATE_K: z.coerce.number().int().positive().default(128),
});

function deriveTrackKeyMasterSecret(systemRootSecret: string): Uint8Array {
    const digest = createHmac('sha256', systemRootSecret).update('ebap-track-key-master:v1').digest();
    return new Uint8Array(digest);
}

export function loadConfig(): Config {
    const env = envSchema.parse(Bun.env);
    const isProduction = String(env.NODE_ENV).toLowerCase() === 'production';

    const systemRootSecretBytes = new TextEncoder().encode(env.SYSTEM_ROOT_SECRET);
    const explicitTrackKeyMasterSecret = env.EBAP_TRACK_KEY_MASTER_SECRET ? new TextEncoder().encode(env.EBAP_TRACK_KEY_MASTER_SECRET) : null;
    const explicitTrackKeyMasterSecrets = env.EBAP_TRACK_KEY_MASTER_SECRETS
        ? (env.EBAP_TRACK_KEY_MASTER_SECRETS as string[]).map((s: string) => new TextEncoder().encode(s))
        : [];

    const derivedTrackKeyMasterSecret = deriveTrackKeyMasterSecret(env.SYSTEM_ROOT_SECRET);

    const trackKeyMasterSecrets = [explicitTrackKeyMasterSecret, ...explicitTrackKeyMasterSecrets, derivedTrackKeyMasterSecret].filter(
        (v): v is Uint8Array => Boolean(v && v.byteLength > 0)
    );

    if (trackKeyMasterSecrets.length === 0) {
        throw new Error('Failed to derive EBAP track key master secret');
    }

    const cookieSecure = env.COOKIE_SECURE ?? isProduction;
    const cookieSameSite = (env.COOKIE_SAMESITE ?? (isProduction ? 'none' : 'lax')) as 'lax' | 'strict' | 'none';

    if (cookieSameSite === 'none' && cookieSecure !== true) {
        throw new Error('COOKIE_SECURE must be true when COOKIE_SAMESITE is none');
    }

    const redisHost = env.REDIS_HOST;
    const redisPort = env.REDIS_PORT;
    const redisPassword = env.REDIS_PASSWORD || '';

    const primaryCookieSecret = new TextEncoder().encode(env.EBAP_HLS_COOKIE_SECRET);
    const rotatedCookieSecrets = env.EBAP_HLS_COOKIE_SECRETS
        ? (env.EBAP_HLS_COOKIE_SECRETS as string[]).map((s: string) => new TextEncoder().encode(s))
        : [];
    const cookieSecrets = [primaryCookieSecret, ...rotatedCookieSecrets].filter((s) => s.byteLength > 0);
    if (cookieSecrets.length === 0) throw new Error('Missing EBAP_HLS_COOKIE_SECRET');

    const signedUrlsEnabled = Boolean(env.EBAP_HLS_SIGNED_URLS);
    const signedUrlsAssetTokenOnly = Boolean(env.EBAP_HLS_SIGNED_URLS_ASSET_TOKEN_ONLY);
    const signedUrlsPlaylistTokenOnly = Boolean(env.EBAP_HLS_SIGNED_URLS_PLAYLIST_TOKEN_ONLY);
    const signedUrlsPlaylistRequireCookie = Boolean(env.EBAP_HLS_SIGNED_URLS_PLAYLIST_REQUIRE_COOKIE);
    const primaryUrlTokenSecret: Uint8Array | undefined = env.EBAP_HLS_URLTOKEN_SECRET ? new TextEncoder().encode(env.EBAP_HLS_URLTOKEN_SECRET) : undefined;
    const rotatedUrlTokenSecrets: Uint8Array[] = env.EBAP_HLS_URLTOKEN_SECRETS
        ? (env.EBAP_HLS_URLTOKEN_SECRETS as string[]).map((s: string) => new TextEncoder().encode(s))
        : [];
    const urlTokenSecretsCandidate: Uint8Array[] = [primaryUrlTokenSecret, ...rotatedUrlTokenSecrets].filter(
        (s): s is Uint8Array => s instanceof Uint8Array && s.byteLength > 0
    );
    const urlTokenSecrets = urlTokenSecretsCandidate.length > 0 ? urlTokenSecretsCandidate : cookieSecrets;
    if (signedUrlsEnabled && urlTokenSecrets.length === 0) {
        throw new Error('Missing EBAP_HLS_URLTOKEN_SECRET');
    }

    const urlTokenTtlSeconds = Math.max(30, Math.min(600, Math.trunc(env.EBAP_HLS_URLTOKEN_TTL_SECONDS)));

    const clampUrlTokenTtlSeconds = (raw: number, min: number, max: number): number => {
        if (!Number.isFinite(raw)) return min;
        return Math.max(min, Math.min(max, Math.trunc(raw)));
    };

    const urlTokenPlaylistTtlSeconds = clampUrlTokenTtlSeconds(
        env.EBAP_HLS_URLTOKEN_TTL_PLAYLIST_SECONDS ?? urlTokenTtlSeconds,
        30,
        900
    );

    const urlTokenAssetTtlSeconds = clampUrlTokenTtlSeconds(
        env.EBAP_HLS_URLTOKEN_TTL_ASSET_SECONDS ?? Math.max(urlTokenTtlSeconds, 15 * 60),
        60,
        3600
    );

    return {
        port: env.PORT,
        nodeEnv: env.NODE_ENV,
        systemRootSecret: systemRootSecretBytes,
        trackKeyMasterSecrets,
        lyricsServiceUrl: env.LYRICS_SERVICE_URL,
        serviceToken: {
            endpoint: env.SERVICE_TOKEN_ENDPOINT,
            serviceName: env.SERVICE_TOKEN_SERVICE_NAME,
            serviceKey: env.SERVICE_TOKEN_SERVICE_KEY,
        },
        signedUrls: {
            enabled: signedUrlsEnabled,
            ttlSeconds: urlTokenTtlSeconds,
            playlistTtlSeconds: urlTokenPlaylistTtlSeconds,
            assetTtlSeconds: urlTokenAssetTtlSeconds,
            secrets: urlTokenSecrets,
            assetTokenOnly: signedUrlsEnabled && signedUrlsAssetTokenOnly,
            playlistTokenOnly: signedUrlsEnabled && signedUrlsPlaylistTokenOnly,
            playlistRequireCookie: signedUrlsEnabled && signedUrlsPlaylistRequireCookie,
        },
        cookie: {
            secure: cookieSecure,
            sameSite: cookieSameSite,
            domain: env.COOKIE_DOMAIN ?? null,
            ttlSeconds: env.EBAP_HLS_COOKIE_TTL_SECONDS,
            secrets: cookieSecrets,
        },
        redis: {
            host: redisHost,
            port: redisPort,
            password: redisPassword,
        },
        minio: {
            endpoint: env.MINIO_ENDPOINT,
            port: env.MINIO_PORT,
            useSsl: env.MINIO_USE_SSL,
            accessKeyId: env.MINIO_ACCESS_KEY,
            secretAccessKey: env.MINIO_SECRET_KEY,
            bucketEbap: env.EBAP_MINIO_BUCKET,
            bucketHls: env.EBAP_HLS_MINIO_BUCKET,
            manifestPrefix: env.EBAP_MANIFEST_PREFIX,
            hlsPrefix: env.EBAP_HLS_PREFIX,
            s3TimeoutMs: env.EBAP_S3_TIMEOUT_MS,
        },
        limits: {
            maxManifestBytes: env.EBAP_MAX_MANIFEST_BYTES,
            maxChunkBytes: env.EBAP_MAX_CHUNK_BYTES,
            maxInflightBytes: env.EBAP_MAX_INFLIGHT_BYTES,
            maxTranscodeJobs: env.EBAP_HLS_MAX_TRANSCODE_JOBS,
            lockTtlMs: env.EBAP_HLS_LOCK_TTL_MS,
            waitReadyMs: env.EBAP_HLS_WAIT_READY_MS,
            hlsSegmentSeconds: env.EBAP_HLS_SEGMENT_SECONDS,
            sessionRateLimitPerWindow: env.EBAP_HLS_SESSION_RL_PER_WINDOW,
            sessionRateLimitWindowSeconds: env.EBAP_HLS_SESSION_RL_WINDOW_SECONDS,
            maxActiveTracks: env.EBAP_HLS_MAX_ACTIVE_TRACKS,
            activeTracksWindowSeconds: env.EBAP_HLS_ACTIVE_TRACKS_WINDOW_SECONDS,
            assetRateLimitPerWindow: env.EBAP_HLS_ASSET_RL_PER_WINDOW,
            assetRateLimitWindowSeconds: env.EBAP_HLS_ASSET_RL_WINDOW_SECONDS,
        },
        ffmpeg: {
            bin: env.FFMPEG_BIN,
            threads: env.FFMPEG_THREADS,
            aacBitrateK: env.EBAP_HLS_AAC_BITRATE_K,
        },
        streamTicket: {
            accept: env.STREAM_TICKET_ACCEPT,
            enforce: env.STREAM_TICKET_ENFORCE,
            jwtSecret: new TextEncoder().encode(
                env.STREAM_TICKET_JWT_SECRET || String(process.env.JWT_SECRET || '').trim() || env.SYSTEM_ROOT_SECRET
            ),
            authRedis: {
                host: String(env.STREAM_TICKET_AUTH_REDIS_HOST || 'redis-auth').trim(),
                port: Number(env.STREAM_TICKET_AUTH_REDIS_PORT) || 6379,
                password: env.STREAM_TICKET_AUTH_REDIS_PASSWORD || redisPassword || '',
            },
            revokeChannel: String(env.STREAM_TICKET_REVOKE_CHANNEL || process.env.AUTH_REVOKE_PUBSUB_CHANNEL || '').trim()
                || 'earflow:auth:session:revoke:v1',
        },
    };
}
