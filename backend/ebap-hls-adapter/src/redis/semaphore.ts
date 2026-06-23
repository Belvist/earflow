import { randomBytes } from 'node:crypto';
import { createClient } from 'redis';

function randomToken(): string {
    return randomBytes(16).toString('hex');
}

export type RedisSemaphore = {
    key: string;
    token: string;
    extend: (ttlMs: number) => Promise<boolean>;
    release: () => Promise<void>;
};

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

const EXTEND_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
else
  return 0
end
`;

export async function tryAcquireSemaphore(params: {
    redis: ReturnType<typeof createClient>;
    keyPrefix: string;
    limit: number;
    ttlMs: number;
}): Promise<RedisSemaphore | null> {
    const limit = Math.max(1, Math.trunc(params.limit));
    const ttlMs = Math.max(1000, Math.trunc(params.ttlMs));

    for (let i = 0; i < limit; i++) {
        const key = `${params.keyPrefix}:${i}`;
        const token = randomToken();
        const ok = await params.redis.set(key, token, { NX: true, PX: ttlMs });
        if (ok !== 'OK') continue;

        return {
            key,
            token,
            extend: async (ttlMs: number) => {
                const t = Math.max(1000, Math.trunc(ttlMs));
                const result = await params.redis.eval(EXTEND_SCRIPT, { keys: [key], arguments: [token, String(t)] });
                return result === 1;
            },
            release: async () => {
                await params.redis.eval(RELEASE_SCRIPT, { keys: [key], arguments: [token] });
            },
        };
    }

    return null;
}
