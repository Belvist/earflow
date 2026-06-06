import { createClient } from 'redis';
import type { Config } from '../config';

type RedisClient = ReturnType<typeof createClient>;

let client: RedisClient | null = null;
let connecting: Promise<RedisClient> | null = null;

export async function getRedis(cfg: Config): Promise<RedisClient> {
    if (client) return client;
    if (!connecting) {
        const opts: Parameters<typeof createClient>[0] = {
            socket: {
                host: cfg.redis.host,
                port: cfg.redis.port,
            },
        };
        if (cfg.redis.password) {
            opts.password = cfg.redis.password;
        }
        const c = createClient(opts);
        connecting = c.connect().then(() => {
            client = c;
            return c;
        });
    }
    return connecting;
}
