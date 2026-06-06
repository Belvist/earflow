import type { Config } from '../config';
import { getRedis } from './client';

const tokenBucketLua = String.raw`
local key = KEYS[1]
local now = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local capacity = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local ttl = tonumber(ARGV[5])

local data = redis.call('HMGET', key, 't', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])

if tokens == nil then tokens = capacity end
if ts == nil then ts = now end

local delta = now - ts
if delta < 0 then delta = 0 end

tokens = math.min(capacity, tokens + (delta * rate))
local allowed = 0
if tokens >= cost then
  allowed = 1
  tokens = tokens - cost
end

redis.call('HMSET', key, 't', tokens, 'ts', now)
redis.call('EXPIRE', key, ttl)

local retryAfter = 0
if allowed == 0 then
  local missing = cost - tokens
  if missing < 0 then missing = 0 end
  retryAfter = math.ceil(missing / rate)
end

return {allowed, retryAfter}
`;

export async function consumeTokenBucket(params: {
    cfg: Config;
    key: string;
    nowMs: number;
    ratePerSecond: number;
    capacity: number;
    cost: number;
    ttlSeconds: number;
}): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const redis = await getRedis(params.cfg);

    const nowSeconds = Math.floor(params.nowMs / 1000);
    const rate = Math.max(0.000001, params.ratePerSecond);
    const capacity = Math.max(1, params.capacity);
    const cost = Math.max(1, params.cost);
    const ttlSeconds = Math.max(1, params.ttlSeconds);

    const res = await redis.eval(tokenBucketLua, {
        keys: [params.key],
        arguments: [String(nowSeconds), String(rate), String(capacity), String(cost), String(ttlSeconds)],
    });

    const arr = Array.isArray(res) ? res : [];
    const allowed = Number(arr[0]) === 1;
    const retryAfterSecondsRaw = Math.trunc(Number(arr[1]));
    const retryAfterSeconds = allowed ? 0 : Math.max(1, Number.isFinite(retryAfterSecondsRaw) ? retryAfterSecondsRaw : 1);

    return { allowed, retryAfterSeconds };
}
