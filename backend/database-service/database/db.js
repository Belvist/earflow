const { Pool } = require('pg');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

function parseIntEnv(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const value = parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

const poolMax = parseIntEnv('DB_MAX_CONNECTIONS', isProduction ? 50 : 20, { min: 1, max: 200 });
const poolMin = Math.min(
  parseIntEnv('DB_MIN_CONNECTIONS', isProduction ? 5 : 2, { min: 0, max: 200 }),
  poolMax
);
const idleTimeoutMillis = parseIntEnv('DB_IDLE_TIMEOUT_MS', 30000, { min: 1000 });
const connectionTimeoutMillis = parseIntEnv('DB_CONNECTION_TIMEOUT_MS', 5000, { min: 1000 });
const statementTimeoutMillis = parseIntEnv('DB_STATEMENT_TIMEOUT_MS', 30000, { min: 0 });

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  database: process.env.DB_NAME || 'music_platform',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  max: poolMax,
  min: poolMin,
  idleTimeoutMillis,
  connectionTimeoutMillis,
  acquireTimeoutMillis: parseIntEnv('DB_ACQUIRE_TIMEOUT_MS', 30000, { min: 1000 }),
  statement_timeout: statementTimeoutMillis,
  query_timeout: statementTimeoutMillis,
  allowExitOnIdle: false,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

async function initDatabase() {
  const client = await pool.connect();
  try {
    console.log('Initializing database...');

    const fs = require('fs');
    const path = require('path');
    const initSQL = fs.readFileSync(
      path.join(__dirname, 'init.sql'),
      'utf8'
    );

    await client.query(initSQL);
    console.log('Database initialized');
  } catch (error) {
    console.error('Database initialization error:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function checkConnection() {
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('PostgreSQL connected:', result.rows[0].now);
    return true;
  } catch (error) {
    console.error('PostgreSQL connection error:', error.message);
    return false;
  }
}

async function cleanupOldSessions() {
  try {
    const result = await pool.query(
      'DELETE FROM service_sessions WHERE expires_at < NOW()'
    );
    console.log(`Deleted ${result.rowCount} expired service sessions`);
  } catch (error) {
    console.error('Service session cleanup error:', error);
  }
}

function getPoolStats() {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
    max: pool.options?.max,
    min: pool.options?.min,
  };
}

async function close() {
  try {
    await pool.end();
    console.log('Database pool closed');
  } catch (error) {
    console.error('Error closing database pool:', error);
    throw error;
  }
}

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
  initDatabase,
  checkConnection,
  cleanupOldSessions,
  getPoolStats,
  close,
};
