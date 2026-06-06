'use strict';

const http = require('http');
const { Pool } = require('pg');
const cfg = require('./config');
const mb = require('./musicbrainz');
const spotify = require('./spotify');
const { createMetrics } = require('./metrics');

const pool = cfg.databaseUrl
    ? new Pool({ connectionString: cfg.databaseUrl, max: cfg.dbMaxConnections, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000, statement_timeout: 15000 })
    : null;
const metrics = createMetrics();

function jsonResponse(res, status, data) {
    const body = JSON.stringify(data);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
}

async function readBody(req, maxBytes = 32768) {
    return new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', (c) => {
            if (raw.length + c.length > maxBytes) {
                req.destroy();
                reject(Object.assign(new Error('Payload too large'), { status: 413 }));
                return;
            }
            raw += c;
        });
        req.on('end', () => resolve(raw));
        req.on('error', reject);
    });
}

async function handleSearch(req, res) {
    const raw = await readBody(req);
    const body = JSON.parse(raw || '{}');
    const query = String(body.query || '').trim();
    const type = String(body.type || 'recording').toLowerCase();
    const limit = Math.min(20, Math.max(1, parseInt(String(body.limit || '10'), 10)));

    if (!query) return jsonResponse(res, 400, { error: 'query is required' });

    const results = {};
    if (type === 'recording' || type === 'track') {
        results.recordings = await mb.searchRecording(query, limit);
    } else if (type === 'artist') {
        results.artists = await mb.searchArtist(query, limit);
    } else {
        const [recordings, artists] = await Promise.all([
            mb.searchRecording(query, Math.ceil(limit / 2)),
            mb.searchArtist(query, Math.floor(limit / 2)),
        ]);
        results.recordings = recordings;
        results.artists = artists;
    }

    if (spotify.isEnabled() && (type === 'recording' || type === 'track' || type === 'all')) {
        try {
            results.spotifyTracks = await spotify.searchTrack(query, Math.min(5, limit));
        } catch { /* Spotify is optional */ }
    }

    return jsonResponse(res, 200, results);
}

async function handleEnrich(req, res) {
    const raw = await readBody(req);
    const body = JSON.parse(raw || '{}');
    const songId = parseInt(String(body.songId || ''), 10);
    const mbid = String(body.mbid || '').trim();

    if (!Number.isFinite(songId) || songId <= 0) {
        return jsonResponse(res, 400, { error: 'songId is required' });
    }

    if (!mbid) return jsonResponse(res, 400, { error: 'mbid is required' });

    const recording = await mb.getRecordingById(mbid);
    if (!recording) return jsonResponse(res, 404, { error: 'Recording not found on MusicBrainz' });

    const enrichment = { mbid: recording.mbid };
    if (recording.genres && recording.genres.length > 0) enrichment.genre = recording.genres[0];
    if (recording.releases && recording.releases[0]?.date) {
        const year = parseInt(recording.releases[0].date, 10);
        if (Number.isFinite(year) && year > 0) enrichment.year = year;
    }

    if (pool) {
        const sets = [];
        const vals = [];
        let idx = 1;
        if (enrichment.genre) { sets.push(`genre = $${idx++}`); vals.push(enrichment.genre); }
        if (enrichment.year) { sets.push(`year = $${idx++}`); vals.push(enrichment.year); }
        if (sets.length > 0) {
            vals.push(songId);
            await pool.query(`UPDATE songs SET ${sets.join(', ')} WHERE id = $${idx}`, vals);
        }
    }

    return jsonResponse(res, 200, { enriched: true, songId, recording });
}

async function handleBatchEnrich(req, res) {
    const raw = await readBody(req, 65536);
    const body = JSON.parse(raw || '{}');
    const items = Array.isArray(body.items) ? body.items.slice(0, 5) : [];

    if (items.length === 0) return jsonResponse(res, 400, { error: 'items array is required' });

    const results = [];
    for (const item of items) {
        const songId = parseInt(String(item.songId || ''), 10);
        const query = String(item.query || '').trim();
        if (!Number.isFinite(songId) || songId <= 0 || !query) continue;

        try {
            const recordings = await mb.searchRecording(query, 1);
            if (recordings.length === 0) {
                results.push({ songId, status: 'not_found' });
                continue;
            }
            const top = recordings[0];
            const enrichment = { mbid: top.mbid };
            if (top.year) enrichment.year = top.year;

            if (pool && enrichment.year) {
                await pool.query(
                    `UPDATE songs SET year = $1 WHERE id = $2 AND year IS NULL`,
                    [enrichment.year, songId]
                );
            }
            results.push({ songId, status: 'ok', recording: top });
        } catch (err) {
            results.push({ songId, status: 'error', error: String(err.message || 'error') });
            if (err.status === 429) break;
        }
    }

    return jsonResponse(res, 200, { results });
}

async function handleArtistEnrich(req, res) {
    const raw = await readBody(req);
    const body = JSON.parse(raw || '{}');
    const artistId = parseInt(String(body.artistId || ''), 10);
    const mbid = String(body.mbid || '').trim();
    const query = String(body.query || '').trim();

    let artist = null;
    if (mbid) {
        artist = await mb.getArtistById(mbid);
    } else if (query) {
        const results = await mb.searchArtist(query, 1);
        if (results.length > 0) artist = await mb.getArtistById(results[0].mbid);
    }

    if (!artist) return jsonResponse(res, 404, { error: 'Artist not found on MusicBrainz' });

    if (pool && Number.isFinite(artistId) && artistId > 0) {
        const sets = [];
        const vals = [];
        let idx = 1;
        if (artist.mbid) { sets.push(`mbid = COALESCE(mbid, $${idx++})`); vals.push(artist.mbid); }
        if (artist.bio) { sets.push(`bio = COALESCE(bio, $${idx++})`); vals.push(artist.bio); }
        if (artist.country) { sets.push(`country = COALESCE(country, $${idx++})`); vals.push(artist.country); }
        if (sets.length > 0) {
            vals.push(artistId);
            await pool.query(`UPDATE artists SET ${sets.join(', ')} WHERE id = $${idx}`, vals).catch(() => { });
        }
    }

    return jsonResponse(res, 200, { artist });
}

const server = http.createServer(async (req, res) => {
    const startedAt = process.hrtime.bigint();
    const url = new URL(req.url, 'http://localhost');
    const route = metrics.routeName(url.pathname);
    res.on('finish', () => {
        const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
        metrics.recordHttp({ method: req.method, route, status: res.statusCode, durationSeconds });
    });

    if (req.method === 'GET' && url.pathname === '/health') {
        return jsonResponse(res, 200, { status: 'ok', spotify: spotify.isEnabled() });
    }

    if (req.method === 'GET' && url.pathname === '/metrics') {
        const body = metrics.prometheusText();
        res.writeHead(200, {
            'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
            'Cache-Control': 'no-store',
            'Content-Length': Buffer.byteLength(body),
        });
        return res.end(body);
    }

    if (req.method !== 'POST') {
        res.writeHead(404);
        return res.end();
    }

    const isDev = String(process.env.NODE_ENV || '').toLowerCase() !== 'production';
    if (!isDev) {
        const uid = String(req.headers['x-user-id'] || '').trim();
        if (!uid || !/^\d+$/.test(uid)) {
            return jsonResponse(res, 401, { error: 'Authentication required' });
        }
    }

    try {
        if (url.pathname === '/api/import/search') return await handleSearch(req, res);
        if (url.pathname === '/api/import/enrich') return await handleEnrich(req, res);
        if (url.pathname === '/api/import/batch-enrich') return await handleBatchEnrich(req, res);
        if (url.pathname === '/api/import/artist-enrich') return await handleArtistEnrich(req, res);
        res.writeHead(404);
        res.end();
    } catch (err) {
        const status = err.status && Number.isFinite(err.status) ? err.status : 500;
        jsonResponse(res, status, { error: String(err.message || 'Internal error') });
    }
});

server.listen(cfg.port, '0.0.0.0', () => {
    process.stdout.write(`import-service listening on :${cfg.port}\n`);
});

process.on('SIGTERM', () => {
    server.close();
    pool?.end().catch(() => { });
    process.exit(0);
});
