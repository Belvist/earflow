'use strict';

const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { Client } = require('pg');
const { pipeline } = require('stream/promises');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { createMetrics } = require('./runtimeMetrics');
const { startHealthServer, closeHealthServer } = require('./healthServer');
const { filterApplicableProfiles } = require('./profiles');
const { probeSource } = require('./probe');
const { analyzeLoudness, buildLoudnormFilter, TARGET_LUFS, TARGET_TP } = require('./loudness');
const { runTranscode, deriveVariantKey } = require('./transcode');
const { extractWaveformPeaks, DEFAULT_STORE_BARS } = require('./waveform');
const { createJobPool } = require('./jobPool');
const {
  formatFailedError,
  nextRetryCount,
  requeueEligibleFailed,
} = require('./jobRetry');

const WAVEFORM_STORE_BARS = Math.max(64, Math.min(512, parseInt(process.env.WAVEFORM_STORE_BARS || String(DEFAULT_STORE_BARS), 10) || DEFAULT_STORE_BARS));

const S3_ENDPOINT = process.env.MINIO_ENDPOINT || 'minio';
const S3_PORT = parseInt(process.env.MINIO_PORT || '9000', 10);
const S3_USE_SSL = process.env.MINIO_USE_SSL === 'true';
const S3_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || '';
const S3_SECRET_KEY = process.env.MINIO_SECRET_KEY || '';
const AUDIO_BUCKET = process.env.MINIO_BUCKET_AUDIO || 'music-audio';
const DATABASE_URL = process.env.DATABASE_URL || '';
const TRANSCODE_CONCURRENCY = Math.max(1, parseInt(process.env.TRANSCODE_CONCURRENCY || '2', 10));
const WAVEFORM_CONCURRENCY = Math.max(1, parseInt(process.env.WAVEFORM_CONCURRENCY || '1', 10));
const POLL_INTERVAL_MS = parseInt(process.env.TRANSCODE_POLL_MS || '5000', 10);
const WORK_DIR = process.env.TRANSCODE_WORK_DIR || path.join(os.tmpdir(), 'transcode-work');
const ENABLE_OPUS = process.env.TRANSCODE_ENABLE_OPUS !== 'false';
const ENABLE_FLAC = process.env.TRANSCODE_ENABLE_FLAC !== 'false';
const ENABLE_LOUDNORM = process.env.TRANSCODE_ENABLE_LOUDNORM !== 'false';
const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || process.env.TRANSCODE_HEALTH_PORT || '3098', 10);
const SHUTDOWN_TIMEOUT_MS = Math.max(5000, parseInt(process.env.TRANSCODE_SHUTDOWN_TIMEOUT_MS || '120000', 10));
const FAILED_MAX_RETRIES = Math.max(1, parseInt(process.env.TRANSCODE_FAILED_MAX_RETRIES || '5', 10));
const FAILED_RETRY_INTERVAL_MS = Math.max(60_000, parseInt(process.env.TRANSCODE_FAILED_RETRY_INTERVAL_MS || '3600000', 10));
const FAILED_RETRY_BATCH = Math.max(1, parseInt(process.env.TRANSCODE_FAILED_RETRY_BATCH || '20', 10));
const FAILED_RETRY_POLL_EVERY = Math.max(1, parseInt(process.env.TRANSCODE_FAILED_RETRY_POLL_EVERY || '12', 10));

const s3 = new S3Client({
  endpoint: `${S3_USE_SSL ? 'https' : 'http'}://${S3_ENDPOINT}:${S3_PORT}`,
  region: 'us-east-1',
  credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
  forcePathStyle: true,
});

let shutdownRequested = false;
let hasWaveformColumns = false;
let notifyListener = null;

const metrics = createMetrics({
  concurrency: TRANSCODE_CONCURRENCY,
  waveformConcurrency: WAVEFORM_CONCURRENCY,
});

const jobPool = createJobPool({
  transcodeConcurrency: TRANSCODE_CONCURRENCY,
  waveformConcurrency: WAVEFORM_CONCURRENCY,
  onActiveChange(counts) {
    metrics.setActiveJobs(counts.total, counts.transcode, counts.waveform);
  },
});

const retryOpts = () => ({
  maxRetries: FAILED_MAX_RETRIES,
  minAgeMs: FAILED_RETRY_INTERVAL_MS,
  batchSize: FAILED_RETRY_BATCH,
});

function resolveObjectKey(rawKey) {
  let key = String(rawKey || '').replace(/^\/+/, '');
  const prefix = `${AUDIO_BUCKET}/`;
  if (key.startsWith(prefix)) {
    key = key.slice(prefix.length);
  }
  if (!key || key.includes('..') || key.includes('\0')) {
    throw new Error('invalid object key');
  }
  return key;
}

async function ensureWorkDir() {
  await fsp.mkdir(WORK_DIR, { recursive: true });
}

async function downloadFromS3(objectKey, destPath) {
  const cmd = new GetObjectCommand({ Bucket: AUDIO_BUCKET, Key: objectKey });
  const resp = await s3.send(cmd);
  const ws = fs.createWriteStream(destPath);
  await pipeline(resp.Body, ws);
}

async function uploadToS3(srcPath, objectKey, contentType) {
  const body = fs.createReadStream(srcPath);
  const stat = await fsp.stat(srcPath);
  const cmd = new PutObjectCommand({
    Bucket: AUDIO_BUCKET,
    Key: objectKey,
    Body: body,
    ContentType: contentType,
    ContentLength: stat.size,
  });
  await s3.send(cmd);
  return stat.size;
}

async function markQueueFailed(db, kind, songId, err, { interrupted = false } = {}) {
  const cols = kind === 'waveform'
    ? { status: 'waveform_status', error: 'waveform_error' }
    : { status: 'transcode_status', error: 'transcode_error' };

  if (interrupted || shutdownRequested) {
    await db.query(
      `UPDATE songs SET ${cols.status} = 'pending', ${cols.error} = NULL WHERE id = $1`,
      [songId],
    ).catch(() => { });
    return;
  }

  const prevRes = await db.query(
    `SELECT ${cols.error} FROM songs WHERE id = $1`,
    [songId],
  ).catch(() => ({ rows: [] }));
  const prevErr = prevRes.rows[0]?.[cols.error];
  const retryCount = nextRetryCount(prevErr);
  const msg = formatFailedError(retryCount, String(err?.message || err));

  await db.query(
    `UPDATE songs SET ${cols.status} = 'failed', ${cols.error} = $2 WHERE id = $1`,
    [songId, msg],
  ).catch(() => { });

  if (kind === 'transcode') {
    metrics.markJobFailed(err);
  }
}

async function persistWaveformPeaks(db, songId, inputPath) {
  if (!hasWaveformColumns) return;
  try {
    await db.query(
      `UPDATE songs SET waveform_status = 'processing', waveform_error = NULL WHERE id = $1`,
      [songId],
    );
    const peaks = await extractWaveformPeaks(inputPath, WAVEFORM_STORE_BARS);
    await db.query(
      `UPDATE songs
          SET waveform_peaks = $2::jsonb,
              waveform_bars = $3,
              waveform_status = 'done',
              waveform_error = NULL
        WHERE id = $1`,
      [songId, JSON.stringify(peaks), peaks.length],
    );
  } catch (err) {
    await markQueueFailed(db, 'waveform', songId, err);
  }
}

async function processWaveformOnlyJob(db, songId) {
  const jobDir = path.join(WORK_DIR, `wave-${songId}-${crypto.randomBytes(4).toString('hex')}`);
  await fsp.mkdir(jobDir, { recursive: true });

  try {
    await db.query(
      `UPDATE songs SET waveform_status = 'processing', waveform_error = NULL WHERE id = $1`,
      [songId],
    );

    const songRes = await db.query(
      `SELECT file_path FROM songs WHERE id = $1`,
      [songId],
    );
    if (!songRes.rows.length) return;

    const objectKey = resolveObjectKey(songRes.rows[0].file_path);
    const ext = path.extname(objectKey) || '.audio';
    const inputPath = path.join(jobDir, `source${ext}`);
    await downloadFromS3(objectKey, inputPath);
    await persistWaveformPeaks(db, songId, inputPath);
  } catch (err) {
    await markQueueFailed(db, 'waveform', songId, err);
  } finally {
    await fsp.rm(jobDir, { recursive: true, force: true }).catch(() => { });
  }
}

async function processJob(db, songId) {
  const jobDir = path.join(WORK_DIR, `job-${songId}-${crypto.randomBytes(4).toString('hex')}`);
  await fsp.mkdir(jobDir, { recursive: true });
  let uploadedBytes = 0;

  try {
    metrics.markJobStarted();
    await db.query(
      `UPDATE songs SET transcode_status = 'processing', transcode_error = NULL WHERE id = $1`,
      [songId],
    );

    const songRes = await db.query(
      `SELECT file_path, mime_type FROM songs WHERE id = $1`,
      [songId],
    );
    if (!songRes.rows.length) {
      metrics.markJobCompleted({ variants: 0, bytes: 0 });
      return;
    }

    const { file_path: rawFilePath } = songRes.rows[0];
    const objectKey = resolveObjectKey(rawFilePath);
    const ext = path.extname(objectKey) || '.audio';
    const inputPath = path.join(jobDir, `source${ext}`);

    await downloadFromS3(objectKey, inputPath);

    if (shutdownRequested) {
      throw new Error('shutdown before transcode');
    }

    await persistWaveformPeaks(db, songId, inputPath);

    const sourceInfo = await probeSource(inputPath);

    let allProfiles = filterApplicableProfiles(
      sourceInfo.bitrate,
      sourceInfo.sampleRate,
      sourceInfo.isLossless,
    );

    if (!ENABLE_OPUS) {
      allProfiles = allProfiles.filter((p) => p.codec !== 'libopus');
    }
    if (!ENABLE_FLAC) {
      allProfiles = allProfiles.filter((p) => p.codec !== 'flac');
    }

    if (!allProfiles.length) {
      await db.query(
        `UPDATE songs SET transcode_status = 'done', quality_variants = $2::jsonb WHERE id = $1`,
        [songId, JSON.stringify([])],
      );
      metrics.markJobCompleted({ variants: 0, bytes: 0 });
      return;
    }

    let loudnormFilter = null;
    let loudnessData = null;

    if (ENABLE_LOUDNORM) {
      const analysis = await analyzeLoudness(inputPath);
      if (analysis) {
        loudnormFilter = buildLoudnormFilter(analysis);
        loudnessData = {
          inputLufs: analysis.inputI,
          inputTp: analysis.inputTp,
          inputLra: analysis.inputLra,
          targetLufs: TARGET_LUFS,
          targetTp: TARGET_TP,
        };
      }
    }

    const variants = [];

    for (const profile of allProfiles) {
      if (shutdownRequested) {
        throw new Error('shutdown during variant encode');
      }

      const variantKey = deriveVariantKey(objectKey, profile);
      const outputExt = profile.container === 'webm' ? '.webm'
        : profile.container === 'flac' ? '.flac'
          : '.m4a';
      const outputPath = path.join(jobDir, `output_${profile.tag}${outputExt}`);

      const applyLoudnorm = loudnormFilter && profile.codec !== 'flac';

      await runTranscode(inputPath, outputPath, profile, applyLoudnorm ? loudnormFilter : null);
      const size = await uploadToS3(outputPath, variantKey, profile.contentType);
      uploadedBytes += size;

      const variant = {
        tag: profile.tag,
        bitrate: profile.bitrate,
        codec: profile.codec === 'libopus' ? 'opus' : profile.codec,
        sampleRate: profile.sampleRate,
        channels: profile.channels,
        container: profile.container,
        key: variantKey,
        size,
      };

      if (loudnessData && profile.codec !== 'flac') {
        variant.loudness = loudnessData;
      }

      variants.push(variant);
      await fsp.unlink(outputPath).catch(() => { });
    }

    await db.query(
      `UPDATE songs SET transcode_status = 'done', quality_variants = $2::jsonb WHERE id = $1`,
      [songId, JSON.stringify(variants)],
    );
    metrics.markJobCompleted({ variants: variants.length, bytes: uploadedBytes });
  } catch (err) {
    const interrupted = shutdownRequested
      || /shutdown/i.test(String(err?.message || err));
    await markQueueFailed(db, 'transcode', songId, err, { interrupted });
  } finally {
    await fsp.rm(jobDir, { recursive: true, force: true }).catch(() => { });
  }
}

function runTranscodeJob(db, songId) {
  metrics.markJobClaimed();
  jobPool.schedule('transcode', shutdownRequested, () => processJob(db, songId));
}

function runWaveformJob(db, songId) {
  jobPool.schedule('waveform', shutdownRequested, () => processWaveformOnlyJob(db, songId));
}

async function claimWaveformJob(db) {
  if (!hasWaveformColumns) return null;
  const res = await db.query(
    `UPDATE songs
        SET waveform_status = 'claimed'
      WHERE id = (
        SELECT id FROM songs
         WHERE waveform_status = 'pending'
           AND file_path IS NOT NULL
           AND file_path <> ''
         ORDER BY id ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id`,
  );
  return res.rows.length ? res.rows[0].id : null;
}

async function pollWaveformLoop(db) {
  while (!shutdownRequested) {
    if (!hasWaveformColumns) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    if (!jobPool.canStart('waveform')) {
      await sleep(500);
      continue;
    }

    const songId = await claimWaveformJob(db).catch(() => null);
    if (!songId) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    runWaveformJob(db, songId);
  }
}

async function claimJob(db) {
  const res = await db.query(
    `UPDATE songs
        SET transcode_status = 'claimed'
      WHERE id = (
        SELECT id FROM songs
         WHERE transcode_status = 'pending'
           AND file_path IS NOT NULL
           AND file_path <> ''
         ORDER BY id ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id`,
  );
  return res.rows.length ? res.rows[0].id : null;
}

async function requeueFailedWithMetrics(db) {
  const tc = await requeueEligibleFailed(db, 'transcode', retryOpts()).catch(() => 0);
  let wf = 0;
  if (hasWaveformColumns) {
    wf = await requeueEligibleFailed(db, 'waveform', retryOpts()).catch(() => 0);
  }
  const total = tc + wf;
  if (total > 0) metrics.markRequeued(total);
  return total;
}

async function pollLoop(db) {
  let pollCount = 0;
  while (!shutdownRequested) {
    metrics.markPoll();
    pollCount += 1;

    if (pollCount % FAILED_RETRY_POLL_EVERY === 0) {
      await requeueFailedWithMetrics(db);
    }

    if (!jobPool.canStart('transcode')) {
      await sleep(500);
      continue;
    }

    const songId = await claimJob(db).catch(() => null);
    if (!songId) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    runTranscodeJob(db, songId);
  }
}

async function listenLoop(db) {
  const listener = new Client({ connectionString: DATABASE_URL });
  await listener.connect();
  notifyListener = listener;
  await listener.query('LISTEN transcode_jobs');

  listener.on('notification', async (msg) => {
    if (shutdownRequested) return;
    const songId = parseInt(msg.payload, 10);
    if (!Number.isFinite(songId) || songId <= 0) return;
    if (!jobPool.canStart('transcode')) return;

    const claimed = await db.query(
      `UPDATE songs SET transcode_status = 'claimed' WHERE id = $1 AND transcode_status = 'pending' RETURNING id`,
      [songId],
    ).catch(() => ({ rows: [] }));

    if (!claimed.rows.length) return;

    runTranscodeJob(db, songId);
  });

  listener.on('error', (err) => {
    metrics.markError(err);
    notifyListener = null;
    if (!shutdownRequested) {
      setTimeout(() => listenLoop(db).catch(() => { }), 3000);
    }
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function resetStuckJobs(db) {
  await db.query(
    `UPDATE songs SET transcode_status = 'pending', transcode_error = NULL WHERE transcode_status IN ('claimed', 'processing')`,
  );
  if (hasWaveformColumns) {
    await db.query(
      `UPDATE songs SET waveform_status = 'pending', waveform_error = NULL WHERE waveform_status IN ('claimed', 'processing')`,
    );
  }
}

function closeNotifyListener() {
  if (!notifyListener) return;
  try {
    notifyListener.end();
  } catch {
    /* ignore */
  }
  notifyListener = null;
}

async function gracefulShutdown(db) {
  shutdownRequested = true;
  metrics.setShutdownRequested(true);
  metrics.setReady(false);
  closeNotifyListener();

  const drained = await jobPool.drainInFlight(SHUTDOWN_TIMEOUT_MS);
  if (!drained) {
    metrics.markError(new Error(`shutdown timeout with ${jobPool.activeCounts().inFlight} in-flight jobs`));
  }

  await resetStuckJobs(db);
}

async function main() {
  if (!DATABASE_URL) {
    process.stderr.write('transcode-worker fatal: DATABASE_URL is required\n');
    process.exit(1);
  }

  const healthServer = startHealthServer({ port: HEALTH_PORT, metrics });
  await ensureWorkDir();

  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();

  const schemaRes = await db.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_name = 'songs'
        AND column_name = ANY($1::text[])`,
    [['transcode_status', 'transcode_error', 'quality_variants', 'waveform_peaks', 'waveform_status', 'waveform_bars', 'waveform_error']],
  );
  const presentColumns = new Set(schemaRes.rows.map((row) => row.column_name));
  const missingColumns = ['transcode_status', 'transcode_error', 'quality_variants']
    .filter((column) => !presentColumns.has(column));
  hasWaveformColumns = ['waveform_peaks', 'waveform_status', 'waveform_bars'].every((c) => presentColumns.has(c));
  if (missingColumns.length) {
    const message = `songs table is missing transcode columns: ${missingColumns.join(', ')}; apply backend/00-create-tables.sql transcode migration before starting transcode-worker`;
    metrics.markError(new Error(message));
    metrics.setReady(false);
    await closeHealthServer(healthServer);
    await db.end().catch(() => { });
    process.stderr.write(`transcode-worker not ready: ${message}\n`);
    process.exit(1);
  }

  await resetStuckJobs(db);
  await requeueFailedWithMetrics(db);

  if (hasWaveformColumns) {
    await db.query(
      `UPDATE songs
          SET waveform_status = 'pending'
        WHERE waveform_peaks IS NULL
          AND file_path IS NOT NULL
          AND file_path <> ''
          AND COALESCE(waveform_status, 'none') NOT IN ('pending', 'claimed', 'processing', 'done')`,
    ).catch(() => { });
  }
  metrics.setReady(true);

  const onSignal = () => {
    gracefulShutdown(db).catch((err) => {
      metrics.markError(err);
    });
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);

  listenLoop(db).catch((err) => metrics.markError(err));
  const waveformLoop = pollWaveformLoop(db).catch((err) => metrics.markError(err));

  await pollLoop(db);
  await waveformLoop;

  if (!shutdownRequested) {
    await gracefulShutdown(db);
  } else {
    await jobPool.drainInFlight(SHUTDOWN_TIMEOUT_MS);
    await resetStuckJobs(db);
  }

  metrics.setReady(false);
  await db.end().catch(() => { });
  await closeHealthServer(healthServer);
}

main().catch((err) => {
  metrics.markError(err);
  process.stderr.write(`transcode-worker fatal: ${err?.message || err}\n`);
  process.exit(1);
});
