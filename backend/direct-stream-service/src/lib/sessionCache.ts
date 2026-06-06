import type { Redis } from 'ioredis';

const CACHE_VERSION = 2;
const KEY_PREFIX = `ds:sess:v${CACHE_VERSION}:`;

export type SessionCacheEntry = {
    url: string;
    mime: string;
    objectKey: string;
    contentHash: string;
    trackRef: string;
    qualities: SessionQualityEntry[];
    uploaderId: number | null;
    isAvailable: boolean;
};

export type SessionQualityEntry = {
    tag: string;
    bitrate: number;
    codec: string;
    url: string;
    mime: string;
    loudness?: { inputLufs: number | null; targetLufs: number };
};

function cacheKey(trackId: number): string {
    return `${KEY_PREFIX}${trackId >>> 0}`;
}

export async function getSessionCache(redis: Redis, trackId: number): Promise<SessionCacheEntry | null> {
    try {
        const raw = await redis.get(cacheKey(trackId));
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        const obj = parsed as Record<string, unknown>;
        if (
            typeof obj.url !== 'string' ||
            typeof obj.mime !== 'string' ||
            typeof obj.objectKey !== 'string' ||
            typeof obj.contentHash !== 'string' ||
            typeof obj.trackRef !== 'string' ||
            !Array.isArray(obj.qualities)
        ) {
            return null;
        }
        const uploaderId = typeof obj.uploaderId === 'number' ? Math.trunc(obj.uploaderId) : null;
        const isAvailable = obj.isAvailable !== false;
        return {
            url: obj.url,
            mime: obj.mime,
            objectKey: obj.objectKey,
            contentHash: obj.contentHash,
            trackRef: obj.trackRef,
            qualities: (obj.qualities as unknown[]).filter((q): q is SessionQualityEntry => {
                if (!q || typeof q !== 'object') return false;
                const qo = q as Record<string, unknown>;
                return typeof qo.tag === 'string' && typeof qo.url === 'string';
            }),
            uploaderId,
            isAvailable,
        };
    } catch {
        return null;
    }
}

export async function setSessionCache(
    redis: Redis,
    trackId: number,
    entry: SessionCacheEntry,
    ttlSeconds: number
): Promise<void> {
    try {
        await redis.set(cacheKey(trackId), JSON.stringify(entry), 'EX', ttlSeconds);
    } catch {
        // non-fatal: cache miss on next request
    }
}
