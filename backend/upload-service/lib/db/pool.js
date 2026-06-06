const { Pool } = require('pg');

const isProduction = process.env.NODE_ENV === 'production';

function parseIntEnv(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
    const value = parseInt(raw, 10);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(Math.max(value, min), max);
}

function requiredEnv(name) {
    const value = process.env[name];
    if (!value || String(value).trim() === '') {
        throw new Error(`Missing required env: ${name}`);
    }
    return String(value);
}

function getPoolConfig() {
    const host = process.env.DB_HOST || 'postgres';
    const port = parseInt(process.env.DB_PORT || '5432', 10);
    const database = requiredEnv('DB_NAME');
    const user = requiredEnv('DB_USER');
    const password = requiredEnv('DB_PASSWORD');

    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
        throw new Error('Invalid DB_PORT');
    }

    const maxConnections = parseIntEnv('DB_MAX_CONNECTIONS', isProduction ? 30 : 10, { min: 1, max: 200 });
    const minConnections = Math.min(
        parseIntEnv('DB_MIN_CONNECTIONS', isProduction ? 5 : 1, { min: 0, max: 200 }),
        maxConnections
    );
    const idleTimeoutMillis = parseIntEnv('DB_IDLE_TIMEOUT_MS', 30_000, { min: 1_000 });
    const connectionTimeoutMillis = parseIntEnv('DB_CONNECTION_TIMEOUT_MS', 5_000, { min: 1_000 });
    const statementTimeoutMillis = parseIntEnv('DB_STATEMENT_TIMEOUT_MS', 30_000, { min: 0 });

    return {
        host,
        port,
        database,
        user,
        password,
        max: maxConnections,
        min: minConnections,
        idleTimeoutMillis,
        connectionTimeoutMillis,
        statement_timeout: statementTimeoutMillis,
        query_timeout: statementTimeoutMillis,
        allowExitOnIdle: false,
    };
}

const pool = new Pool(getPoolConfig());

pool.on('error', (err) => {
    console.error('PostgreSQL pool error:', err);
});

async function query(text, params) {
    return await pool.query(text, params);
}

async function close() {
    await pool.end();
}

module.exports = {
    pool,
    query,
    close,
};
