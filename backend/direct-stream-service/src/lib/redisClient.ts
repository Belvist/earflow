import Redis, { type RedisOptions } from 'ioredis';

export function createRedisClient(cfg: {
    host: string;
    port: number;
    password: string | null;
}): Redis {
    const options: RedisOptions = {
        host: cfg.host,
        port: cfg.port,
        password: cfg.password || undefined,
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: 3000,
        commandTimeout: 2000,
        retryStrategy: (times: number) => {
            const delay = Math.min(times * 500, 30000);
            return delay;
        },
    };

    const client = new Redis(options);

    client.on('error', () => {
        // silent: Redis is optional for this service
    });

    return client;
}
