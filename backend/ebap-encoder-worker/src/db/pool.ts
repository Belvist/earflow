import { Pool } from 'pg';
import type { Config } from '../config';

export type Db = {
    pool: Pool;
    close: () => Promise<void>;
};

export function createDb(cfg: Config): Db {
    const pool = new Pool({
        host: cfg.db.host,
        port: cfg.db.port,
        database: cfg.db.name,
        user: cfg.db.user,
        password: cfg.db.password,
        max: cfg.db.maxConnections,
        min: cfg.db.minConnections,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
        statement_timeout: 120_000,
        query_timeout: 120_000,
        allowExitOnIdle: false,
    });

    pool.on('error', (err) => {
        console.error('postgres_pool_error', { message: err.message, code: (err as any).code });
    });

    return {
        pool,
        close: async () => {
            await pool.end();
        },
    };
}
