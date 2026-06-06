'use strict';

const http = require('http');
const { Pool } = require('pg');
const cfg = require('./config');
const { downloadRange, uploadBuffer } = require('./s3');
const { parseSongMetadata } = require('./parser');
const { createMetrics } = require('./metrics');

const pool = new Pool({
    connectionString: cfg.databaseUrl,
    max: cfg.dbMaxConnections,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15000,
});

let processingCount = 0;
const metrics = createMetrics({ concurrency: cfg.concurrency });

function incrementProcessing() {
    processingCount++;
    metrics.setProcessing(processingCount);
}

function decrementProcessing() {
    processingCount = Math.max(0, processingCount - 1);
    metrics.setProcessing(processingCount);
}

async function processRow(row) {
    metrics.markJobStarted();
    let buf;
    try {
        buf = await downloadRange(cfg.minioBucketAudio, row.file_path, cfg.maxFileSizeBytes);
    } catch (err) {
        metrics.markJobFailed('download_failed');
        await pool.query(
            `UPDATE songs SET metadata_parse_status = 'error', metadata_parse_error = $1, updated_at = NOW() WHERE id = $2`,
            [String(err.message || 'Download failed').slice(0, 500), row.id]
        );
        return;
    }

    const { metadata, coverBuffer, coverMime } = await parseSongMetadata(buf, row.mime_type);

    let newCoverPath = null;
    if (coverBuffer && !row.cover_path) {
        const ext = (coverMime || '').includes('png') ? 'png' : 'jpg';
        const key = `covers/auto-${row.id}-${Date.now()}.${ext}`;
        try {
            await uploadBuffer(cfg.minioBucketCovers, key, coverBuffer, coverMime || 'image/jpeg');
            newCoverPath = key;
        } catch { /* cover upload is non-fatal */ }
    }

    const metaJson = JSON.stringify(metadata);
    if (newCoverPath) {
        await pool.query(
            `UPDATE songs
             SET parsed_metadata = $1::jsonb,
                 metadata_parse_status = 'done',
                 cover_path = COALESCE(NULLIF(cover_path, ''), $2)
             WHERE id = $3`,
            [metaJson, newCoverPath, row.id]
        );
    } else {
        await pool.query(
            `UPDATE songs
             SET parsed_metadata = $1::jsonb,
                 metadata_parse_status = 'done'
             WHERE id = $2`,
            [metaJson, row.id]
        );
    }
    metrics.markJobCompleted({ coverUploaded: Boolean(newCoverPath) });
}

function dispatchRow(row) {
    if (processingCount >= cfg.concurrency) return false;
    incrementProcessing();
    processRow(row)
        .catch(() => {
            metrics.markJobFailed('unexpected');
            pool.query(
                `UPDATE songs SET metadata_parse_status = 'error', metadata_parse_error = 'Unexpected error', updated_at = NOW() WHERE id = $1`,
                [row.id]
            ).catch(() => { });
        })
        .finally(() => { decrementProcessing(); });
    return true;
}

async function claimAndDispatch(songId) {
    if (processingCount >= cfg.concurrency) return;
    const res = await pool.query(
        `UPDATE songs SET metadata_parse_status = 'processing'
         WHERE id = $1 AND metadata_parse_status IN ('pending', 'error')
         RETURNING id, file_path, mime_type, cover_path`,
        [songId]
    );
    if (res.rows.length > 0) dispatchRow(res.rows[0]);
}

async function pollPending() {
    const available = cfg.concurrency - processingCount;
    if (available <= 0) return;
    const res = await pool.query(
        `UPDATE songs SET metadata_parse_status = 'processing'
         WHERE id IN (
             SELECT id FROM songs
             WHERE metadata_parse_status = 'pending'
                OR (metadata_parse_status = 'error' AND updated_at < NOW() - INTERVAL '5 minutes')
             ORDER BY id ASC
             LIMIT $1
             FOR UPDATE SKIP LOCKED
         )
         RETURNING id, file_path, mime_type, cover_path`,
        [available]
    );
    for (const row of res.rows) dispatchRow(row);
}

let notifyClient = null;

async function listenForNotify() {
    const client = await pool.connect();
    notifyClient = client;
    try {
        await client.query('LISTEN metadata_parse_jobs');
        client.on('notification', (msg) => {
            const id = parseInt(String(msg.payload || ''), 10);
            if (Number.isFinite(id) && id > 0) {
                claimAndDispatch(id).catch(() => { });
            }
        });
        client.on('error', () => {
            notifyClient = null;
            try { client.release(true); } catch { }
            setTimeout(() => listenForNotify().catch(() => { }), 5000);
        });
    } catch {
        notifyClient = null;
        try { client.release(true); } catch { }
        setTimeout(() => listenForNotify().catch(() => { }), 5000);
    }
}

setInterval(() => { pollPending().catch(() => { }); }, cfg.pollIntervalMs);
listenForNotify().catch(() => { });
pollPending().catch(() => { });

const server = http.createServer(async (req, res) => {
    const startedAt = process.hrtime.bigint();
    const url = new URL(req.url, `http://localhost`);
    const route = metrics.routeName(url.pathname);
    res.on('finish', () => {
        const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
        metrics.recordHttp({ method: req.method, route, status: res.statusCode, durationSeconds });
    });

    if (req.method === 'GET' && url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', processing: processingCount, concurrency: cfg.concurrency }));
        return;
    }

    if (req.method === 'GET' && url.pathname === '/metrics') {
        const body = metrics.prometheusText();
        res.writeHead(200, {
            'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
            'Cache-Control': 'no-store',
            'Content-Length': Buffer.byteLength(body),
        });
        res.end(body);
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/metadata/parse') {
        let raw = '';
        req.on('data', (c) => { if (raw.length < 4096) raw += c; });
        await new Promise((resolve) => req.on('end', resolve));
        try {
            const { songId } = JSON.parse(raw || '{}');
            const id = parseInt(String(songId || ''), 10);
            if (!Number.isFinite(id) || id <= 0) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid songId' }));
                return;
            }
            await pool.query(
                `UPDATE songs SET metadata_parse_status = 'pending', metadata_parse_error = NULL WHERE id = $1`,
                [id]
            );
            claimAndDispatch(id).catch(() => { });
            res.writeHead(202, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ queued: true, songId: id }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: String(err.message || 'Internal error') }));
        }
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/metadata/batch') {
        let raw = '';
        req.on('data', (c) => { if (raw.length < 8192) raw += c; });
        await new Promise((resolve) => req.on('end', resolve));
        try {
            const { songIds } = JSON.parse(raw || '{}');
            const ids = (Array.isArray(songIds) ? songIds : [])
                .map((x) => parseInt(String(x || ''), 10))
                .filter((x) => Number.isFinite(x) && x > 0)
                .slice(0, 20);
            if (ids.length === 0) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'songIds must be a non-empty array' }));
                return;
            }
            const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
            await pool.query(
                `UPDATE songs SET metadata_parse_status = 'pending', metadata_parse_error = NULL
                 WHERE id IN (${placeholders})`,
                ids
            );
            for (const id of ids) claimAndDispatch(id).catch(() => { });
            res.writeHead(202, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ queued: ids.length, songIds: ids }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: String(err.message || 'Internal error') }));
        }
        return;
    }

    res.writeHead(404);
    res.end();
});

server.listen(cfg.port, '0.0.0.0', () => {
    process.stdout.write(`metadata-parser-service listening on :${cfg.port}\n`);
});

process.on('SIGTERM', () => {
    server.close();
    if (notifyClient) { try { notifyClient.release(true); } catch { } notifyClient = null; }
    pool.end().catch(() => { });
    process.exit(0);
});
