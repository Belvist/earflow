#!/usr/bin/env node

'use strict';

try {
  require('dotenv').config();
} catch {
}

const { Pool } = require('pg');

function parseIntEnv(name, def) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : def;
}

function parseBoolEnv(name, def) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const v = String(raw).trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return def;
}

function parseOptionalStringEnv(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return null;
  const v = String(raw).trim();
  return v || null;
}

function toIsoDateTime(v) {
  if (!v) return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

async function main() {
  const dryRun = parseBoolEnv('DRY_RUN', true);
  const since = parseOptionalStringEnv('SINCE');
  const until = parseOptionalStringEnv('UNTIL');
  const limitTracks = parseIntEnv('LIMIT_TRACKS', 100000);

  const sinceIso = since ? toIsoDateTime(since) : null;
  const untilIso = until ? toIsoDateTime(until) : null;

  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseIntEnv('DB_PORT', 5432),
    database: process.env.DB_NAME || 'music_platform',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const filters = [];
    const args = [];

    filters.push(`(event_id LIKE 'loadgen:%' OR event_id LIKE 'loadtest:%' OR session_id LIKE 'loadgen-sess-%' OR session_id LIKE 'loadtest-%')`);

    if (sinceIso) {
      filters.push(`event_time >= $${args.length + 1}`);
      args.push(sinceIso);
    }

    if (untilIso) {
      filters.push(`event_time < $${args.length + 1}`);
      args.push(untilIso);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const impactSql = `
      WITH impacted AS (
        SELECT track_id::int AS song_id, COUNT(*)::int AS cnt
        FROM analytics_events_raw
        ${where}
        GROUP BY track_id
        ORDER BY COUNT(*) DESC
        LIMIT ${Math.max(1, Math.min(limitTracks, 500000))}
      )
      SELECT
        (SELECT COUNT(*)::int FROM impacted) AS impacted_tracks,
        (SELECT COALESCE(SUM(cnt), 0)::bigint FROM impacted) AS total_events
    `;

    const impact = await client.query(impactSql, args);
    const impactedTracks = impact.rows?.[0]?.impacted_tracks ?? 0;
    const totalEvents = impact.rows?.[0]?.total_events ?? 0;

    if (impactedTracks === 0 || totalEvents === 0) {
      await client.query('ROLLBACK');
      process.stdout.write('no-op: no matching loadgen events\n');
      return;
    }

    if (dryRun) {
      await client.query('ROLLBACK');
      process.stdout.write(`dry-run: impacted_tracks=${impactedTracks} total_events=${totalEvents}\n`);
      return;
    }

    const updateSql = `
      WITH impacted AS (
        SELECT track_id::int AS song_id, COUNT(*)::int AS cnt
        FROM analytics_events_raw
        ${where}
        GROUP BY track_id
        ORDER BY COUNT(*) DESC
        LIMIT ${Math.max(1, Math.min(limitTracks, 500000))}
      )
      UPDATE songs s
      SET play_count = GREATEST(0, COALESCE(s.play_count, 0) - i.cnt),
          popularity = GREATEST(0, COALESCE(s.popularity, 0) - i.cnt)
      FROM impacted i
      WHERE s.id = i.song_id
    `;

    await client.query(updateSql, args);

    const deleteSql = `DELETE FROM analytics_events_raw ${where}`;
    const deleted = await client.query(deleteSql, args);

    await client.query('COMMIT');

    const deletedCount = Number.isFinite(Number(deleted?.rowCount)) ? Number(deleted.rowCount) : 0;
    process.stdout.write(`ok: decremented_tracks=${impactedTracks} deleted_events=${deletedCount}\n`);
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
    }
    process.stderr.write((e && e.stack) ? String(e.stack) + '\n' : String(e) + '\n');
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
