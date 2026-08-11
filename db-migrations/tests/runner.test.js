const { test, before } = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const RUNNER = path.join(__dirname, '..', 'runner', 'run.js');
const MIGRATIONS = path.join(__dirname, '..', 'migrations');

const ENV = {
  ...process.env,
  PGHOST: process.env.PGHOST || '127.0.0.1',
  PGPORT: process.env.PGPORT || '15434',
  PGUSER: process.env.PGUSER || 'postgres',
  PGPASSWORD: process.env.PGPASSWORD || 'postgres',
  PGDATABASE: process.env.PGDATABASE || 'music_platform',
};

let pool;
before(async () => {
  pool = new Pool({
    host: ENV.PGHOST, port: +ENV.PGPORT, user: ENV.PGUSER,
    password: ENV.PGPASSWORD, database: ENV.PGDATABASE, max: 2,
  });
});

function run(extraEnv = {}) {
  try {
    const out = execFileSync('node', [RUNNER], { env: { ...ENV, ...extraEnv }, encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

async function exists(sql) {
  const r = await pool.query(sql);
  return Number(r.rows[0].count) > 0;
}

test('fresh DB: baseline applied', async () => {
  const r = run();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /apply 000001_baseline|skip 000001_baseline/);
});

test('second run is a no-op', () => {
  const r = run();
  assert.equal(r.code, 0);
  assert.match(r.out, /skip 000001_baseline\.sql/);
});

test('required reco functions exist after baseline', async () => {
  for (const fn of ['reco_scale_vector', 'reco_blend_user_embedding', 'reco_repel_user_embedding', 'reco_user_embedding_from_clusters', 'reco_apply_feedback_to_taste_clusters']) {
    assert.equal(await exists(`SELECT count(*) FROM pg_proc WHERE proname='${fn}'`), true, fn);
  }
});

test('search outbox triggers exist after baseline', async () => {
  for (const tg of ['trg_search_outbox_songs', 'trg_search_outbox_artists', 'trg_search_outbox_albums']) {
    assert.equal(await exists(`SELECT count(*) FROM pg_trigger WHERE tgname='${tg}' AND NOT tgisinternal`), true, tg);
  }
});

test('playlist + lyrics schema exist after baseline', async () => {
  for (const t of ['playlists', 'playlist_tracks', 'user_queue', 'queue_state', 'lyrics', 'lyrics_external_cache', 'lyrics_reports']) {
    assert.equal(await exists(`SELECT count(*) FROM information_schema.tables WHERE table_name='${t}'`), true, t);
  }
});

test('canonical new five tables exist after baseline', async () => {
  for (const t of ['song_moods', 'subscription_plans', 'subscriptions', 'user_mood_profile', 'user_preferences']) {
    assert.equal(await exists(`SELECT count(*) FROM information_schema.tables WHERE table_name='${t}'`), true, t);
  }
});

test('six legacy objects absent after baseline', async () => {
  for (const t of ['equalizer_presets', 'listening_history', 'user_song_likes']) {
    assert.equal(await exists(`SELECT count(*) FROM information_schema.tables WHERE table_name='${t}'`), false, t);
  }
  for (const v of ['playlist_songs']) {
    assert.equal(await exists(`SELECT count(*) FROM pg_views WHERE viewname='${v}'`), false, v);
  }
  for (const f of ['playlist_songs_view_ins', 'playlist_songs_view_del', 'cleanup_expired_sessions', 'refresh_recommendation_views']) {
    assert.equal(await exists(`SELECT count(*) FROM pg_proc WHERE proname='${f}'`), false, f);
  }
});

test('checksum mismatch -> hard fail', async () => {
  const f = path.join(MIGRATIONS, '000001_baseline.sql');
  const orig = fs.readFileSync(f, 'utf8');
  fs.writeFileSync(f, orig + '\n-- checksum-probe\n');
  const r = run();
  fs.writeFileSync(f, orig);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /checksum mismatch/);
});

test('broken migration rolls back and is not recorded', async () => {
  const f = path.join(MIGRATIONS, '777777_broken_probe.sql');
  fs.writeFileSync(f, 'CREATE TABLE broken_probe (id int);\nTHIS IS NOT SQL;\n');
  const r = run();
  fs.unlinkSync(f);
  assert.notEqual(r.code, 0);
  assert.equal(await exists(`SELECT count(*) FROM information_schema.tables WHERE table_name='broken_probe'`), false);
  assert.equal(await exists(`SELECT count(*) FROM schema_migrations WHERE migration_id='777777_broken_probe'`), false);
});

test('two concurrent runners: only one applies a slow migration', async () => {
  const f = path.join(MIGRATIONS, '888888_concurrency_probe.sql');
  fs.writeFileSync(f, "-- probe\nSELECT pg_sleep(2);\nCREATE TABLE concurrency_probe (id int);\n");
  const results = await Promise.all([
    new Promise(res => res(run())),
    new Promise(res => { setTimeout(() => res(run()), 400); }),
  ]);
  fs.unlinkSync(f);
  const applied = (await pool.query(`SELECT count(*)::int c FROM schema_migrations WHERE migration_id='888888_concurrency_probe'`)).rows[0].c;
  assert.equal(applied, 1);
  assert.equal(results.every(r => r.code === 0), true, JSON.stringify(results));
});
