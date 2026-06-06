#!/usr/bin/env node
'use strict';

const fs = require('fs');

function parseArgs(argv) {
  const out = {
    budget: Number.parseInt(process.env.DB_CONNECTION_BUDGET || '180', 10),
  };
  for (const arg of argv) {
    if (arg.startsWith('--budget=')) {
      out.budget = Number.parseInt(arg.slice('--budget='.length), 10);
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage:
  docker compose config --format json | node scripts/check-db-connection-budget.js --budget=180

The estimate counts direct Postgres app pools and the PgBouncer server pool.
It is intentionally conservative and should be run against the final compose
file you will deploy, including generated scale and PgBouncer overlays.`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!Number.isFinite(out.budget) || out.budget <= 0) {
    throw new Error('Budget must be a positive integer');
  }
  return out;
}

function envMap(raw) {
  if (!raw) return {};
  if (Array.isArray(raw)) {
    const out = {};
    for (const entry of raw) {
      const idx = String(entry).indexOf('=');
      if (idx > 0) out[String(entry).slice(0, idx)] = String(entry).slice(idx + 1);
    }
    return out;
  }
  return raw;
}

function intEnv(env, keys, fallback = 0) {
  for (const key of keys) {
    const raw = env[key];
    if (raw === undefined || raw === null || raw === '') continue;
    const parsed = Number.parseInt(String(raw), 10);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return fallback;
}

function isDirectPostgresClient(env) {
  if (String(env.DB_HOST || '').trim() === 'postgres') return true;
  const url = String(env.DATABASE_URL || '').trim();
  if (!url) return false;
  try {
    return new URL(url).hostname === 'postgres';
  } catch {
    return /@postgres(?::|\/)/.test(url);
  }
}

function servicePoolBudget(name, env) {
  if (name === 'pgbouncer') {
    return intEnv(env, ['PGBOUNCER_DEFAULT_POOL_SIZE'], 50)
      + intEnv(env, ['PGBOUNCER_RESERVE_POOL_SIZE'], 20);
  }
  return intEnv(env, [
    'DB_MAX_CONNECTIONS',
    'RANKING_DB_MAX_CONNECTIONS',
    'DATABASE_DB_MAX_CONNECTIONS',
    'RECO_DB_MAX_CONNECTIONS',
  ], 0);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const raw = fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, '');
  const compose = JSON.parse(raw);
  const services = compose.services || {};

  const rows = [];
  let total = 0;

  for (const [name, svc] of Object.entries(services)) {
    const env = envMap(svc.environment);
    let kind = '';
    let count = 0;

    if (name === 'pgbouncer') {
      kind = 'pgbouncer_server_pool';
      count = servicePoolBudget(name, env);
    } else if (isDirectPostgresClient(env)) {
      kind = 'direct_postgres_pool';
      count = servicePoolBudget(name, env);
    }

    if (count > 0) {
      rows.push({ service: name, kind, maxConnections: count });
      total += count;
    }
  }

  rows.sort((a, b) => b.maxConnections - a.maxConnections || a.service.localeCompare(b.service));
  for (const row of rows) {
    console.log(`${row.service}\t${row.kind}\t${row.maxConnections}`);
  }
  console.log(`TOTAL\testimated_postgres_server_connections\t${total}`);
  console.log(`BUDGET\tmax_allowed\t${opts.budget}`);

  if (total > opts.budget) {
    console.error(`DB connection budget exceeded: estimated ${total}, budget ${opts.budget}`);
    process.exit(2);
  }
}

main();
