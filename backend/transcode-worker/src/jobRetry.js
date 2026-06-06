'use strict';

const RETRIES_PREFIX_RE = /^\[retries:(\d+)\]\s*/;

function parseRetryCount(errorText) {
  const m = String(errorText || '').match(RETRIES_PREFIX_RE);
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function stripRetryPrefix(errorText) {
  return String(errorText || '').replace(RETRIES_PREFIX_RE, '').trim();
}

/** @param {number} retryCount attempts already consumed (1..max) */
function formatFailedError(retryCount, message) {
  const body = stripRetryPrefix(message) || 'unknown';
  return `[retries:${retryCount}] ${body}`.slice(0, 1000);
}

function nextRetryCount(previousError) {
  return parseRetryCount(previousError) + 1;
}

const QUEUE_COLUMNS = {
  transcode: {
    status: 'transcode_status',
    error: 'transcode_error',
    extra: "file_path IS NOT NULL AND file_path <> ''",
  },
  waveform: {
    status: 'waveform_status',
    error: 'waveform_error',
    extra: "file_path IS NOT NULL AND file_path <> ''",
  },
};

/**
 * @param {import('pg').Client} db
 * @param {'transcode'|'waveform'} kind
 * @param {{ maxRetries: number, minAgeMs: number, batchSize: number }} opts
 */
async function requeueEligibleFailed(db, kind, opts) {
  const cols = QUEUE_COLUMNS[kind];
  if (!cols) return 0;

  const maxRetries = Math.max(1, opts.maxRetries);
  const batchSize = Math.max(1, opts.batchSize);
  const minAgeSec = Math.max(0, Math.floor(opts.minAgeMs / 1000));

  const sql = `
    UPDATE songs
       SET ${cols.status} = 'pending',
           ${cols.error} = NULL
     WHERE id IN (
       SELECT id FROM songs
        WHERE ${cols.status} = 'failed'
          AND updated_at < NOW() - ($2::int * INTERVAL '1 second')
          AND (
            ${cols.error} IS NULL
            OR ${cols.error} !~ '^\\[retries:[0-9]+\\]'
            OR COALESCE(SUBSTRING(${cols.error} FROM '^\\[retries:([0-9]+)\\]')::int, 0) < $1
          )
          AND ${cols.extra}
        ORDER BY updated_at ASC
        LIMIT $3
     )
     RETURNING id`;

  const res = await db.query(sql, [maxRetries, minAgeSec, batchSize]);
  return res.rowCount || 0;
}

module.exports = {
  parseRetryCount,
  stripRetryPrefix,
  formatFailedError,
  nextRetryCount,
  requeueEligibleFailed,
};
