#!/usr/bin/env node
/**
 * Earflow db-migrations runner — canonical PostgreSQL schema pipeline.
 *
 * Rules (see docs/DECISIONS.md entry):
 * - Single global advisory lock (pg_advisory_lock) held for the whole run.
 * - sha256 checksum per recorded migration; checksum mismatch -> hard fail.
 * - Migrations are transactional by default. A file can opt out with a
 *   first-line marker:  -- migration: non-transactional
 *   (required for CREATE INDEX CONCURRENTLY).
 * - SQL files are executed verbatim by the server — no client-side splitting
 *   (PL/pgSQL dollar-quoted bodies are safe).
 *
 * Env: PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE or DATABASE_URL.
 * Mode: default = migrate; --verify-baseline = check schema vs baseline, then stamp.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const ADVISORY_LOCK_ID = '8888844444111111';
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

const lockTimeoutMs = parseInt(process.env.DB_MIGRATIONS_LOCK_TIMEOUT_MS || '60000', 10);

function poolConfig() {
  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL };
  return {
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432', 10),
    database: process.env.PGDATABASE || 'music_platform',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
  };
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function ensureTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_id     TEXT PRIMARY KEY,
      checksum_sha256  TEXT NOT NULL,
      applied_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      execution_ms     INTEGER NOT NULL
    )
  `);
}

function isNonTransactional(sql) {
  // explicit first 5 lines marker OR auto-detect concurrent index
  const head = sql.split('\n').slice(0, 5).join('\n');
  if (/--\s*migration:\s*non-transactional/i.test(head)) return true;
  return /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i.test(sql)
      || /\bREINDEX\b/i.test(sql.replace(/--[^\n]*/g, ''))
      || /\bVACUUM\b/i.test(sql.replace(/--[^\n]*/g, ''));
}

async function acquireLock(client) {
  // Session-level advisory lock, held until release.
  await client.query('SELECT pg_advisory_lock($1::bigint)', [ADVISORY_LOCK_ID]);
}

async function releaseLock(client) {
  try { await client.query('SELECT pg_advisory_unlock($1::bigint)', [ADVISORY_LOCK_ID]); } catch (_) {}
}

async function getApplied(client) {
  const r = await client.query('SELECT migration_id, checksum_sha256, applied_at, execution_ms FROM schema_migrations ORDER BY migration_id');
  return new Map(r.rows.map(row => [row.migration_id, row]));
}

async function applyOne(client, id, sql, checksum) {
  const started = Date.now();
  if (isNonTransactional(sql)) {
    // server executes whole file outside explicit transaction
    await client.query(sql);
  } else {
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  }
  const execution_ms = Date.now() - started;
  await client.query(
    'INSERT INTO schema_migrations (migration_id, checksum_sha256, execution_ms) VALUES ($1, $2, $3)',
    [id, checksum, execution_ms]
  );
  return execution_ms;
}

async function main() {
  const pool = new Pool({ ...poolConfig(), max: 1 }); // single connection — lock is per-session
  const client = await pool.connect();
  try {
    await acquireLock(client);
    await ensureTable(client);
    const applied = await getApplied(client);

    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => /^\d{6}_.+\.sql$/.test(f))
      .sort();

    for (const f of files) {
      const id = f.replace(/\.sql$/, '');
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
      const sum = sha256(sql);
      const prev = applied.get(id);
      if (prev) {
        if (prev.checksum_sha256 !== sum) {
          throw new Error(`checksum mismatch for ${f}: applied=${prev.checksum_sha256} current=${sum}`);
        }
        console.log(`skip ${f} (applied ${prev.applied_at.toISOString()})`);
        continue;
      }
      console.log(`apply ${f}${isNonTransactional(sql) ? ' [non-transactional]' : ''} ...`);
      const ms = await applyOne(client, id, sql, sum);
      console.log(`   ok in ${ms}ms`);
    }
    console.log('migrations: done');
  } finally {
    await releaseLock(client);
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('MIGRATION FAILED:', e.message);
  process.exit(1);
});
