import { randomBytes } from 'node:crypto';
import { createClient } from 'redis';

function randomToken(): string {
    return randomBytes(16).toString('hex');
}

export type RedisLock = {
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

export async function tryAcquireLock(params: {
    redis: ReturnType<typeof createClient>;
    key: string;
    ttlMs: number;
}): Promise<RedisLock | null> {
    const token = randomToken();
    const ok = await params.redis.set(params.key, token, { NX: true, PX: params.ttlMs });
    if (ok !== 'OK') return null;

    return {
        key: params.key,
        token,
        extend: async (ttlMs: number) => {
            const t = Math.max(1000, Math.trunc(ttlMs));
            const result = await params.redis.eval(EXTEND_SCRIPT, { keys: [params.key], arguments: [token, String(t)] });
            return result === 1;
        },
        release: async () => {
            await params.redis.eval(RELEASE_SCRIPT, { keys: [params.key], arguments: [token] });
        },
    };
}
