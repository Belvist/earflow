'use strict';

const https = require('https');
const http = require('http');
const cfg = require('./config');

const MB_BASE = 'https://musicbrainz.org/ws/2';
let lastMbRequestAt = 0;

function httpGet(url, headers) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const mod = parsed.protocol === 'https:' ? https : http;
        const opts = {
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: 'GET',
            headers: { 'User-Agent': cfg.musicbrainzUserAgent, 'Accept': 'application/json', ...headers },
        };
        const req = mod.request(opts, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { body += c; });
            res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('Request timeout')); });
        req.end();
    });
}

async function mbGet(path, params) {
    const now = Date.now();
    const wait = cfg.mbRateLimitMs - (now - lastMbRequestAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastMbRequestAt = Date.now();

    const qs = new URLSearchParams({ ...params, fmt: 'json' }).toString();
    const url = `${MB_BASE}${path}?${qs}`;
    const { status, body } = await httpGet(url);
    if (status === 429) throw Object.assign(new Error('MusicBrainz rate limited'), { status: 429 });
    if (status >= 400) throw Object.assign(new Error(`MusicBrainz error ${status}`), { status });
    return JSON.parse(body);
}

async function searchRecording(query, limit = 10) {
    const data = await mbGet('/recording', { query, limit: String(limit) });
    return (data.recordings || []).map((r) => ({
        mbid: r.id,
        title: r.title,
        artist: r['artist-credit'] ? r['artist-credit'].map((a) => a.name || a.artist?.name || '').join(', ') : '',
        album: r.releases && r.releases[0] ? r.releases[0].title : null,
        year: r['first-release-date'] ? parseInt(r['first-release-date'], 10) || null : null,
        duration: r.length ? Math.round(r.length / 1000) : null,
    }));
}

async function searchArtist(query, limit = 5) {
    const data = await mbGet('/artist', { query, limit: String(limit) });
    return (data.artists || []).map((a) => ({
        mbid: a.id,
        name: a.name,
        country: a.country || null,
        type: a.type || null,
        disambiguation: a.disambiguation || null,
    }));
}

async function getRecordingById(mbid) {
    const data = await mbGet(`/recording/${mbid}`, { inc: 'artist-credits+releases+genres+tags' });
    return {
        mbid: data.id,
        title: data.title,
        artist: data['artist-credit'] ? data['artist-credit'].map((a) => a.name || a.artist?.name || '').join(', ') : '',
        duration: data.length ? Math.round(data.length / 1000) : null,
        genres: (data.genres || []).map((g) => g.name).slice(0, 5),
        tags: (data.tags || []).slice(0, 10).map((t) => t.name),
        releases: (data.releases || []).slice(0, 3).map((r) => ({
            mbid: r.id,
            title: r.title,
            date: r.date || null,
            country: r.country || null,
        })),
    };
}

async function getArtistById(mbid) {
    const data = await mbGet(`/artist/${mbid}`, { inc: 'genres+tags+url-rels' });
    const urls = (data.relations || [])
        .filter((r) => r['target-type'] === 'url')
        .reduce((acc, r) => { acc[r.type] = r.url.resource; return acc; }, {});
    return {
        mbid: data.id,
        name: data.name,
        country: data.country || null,
        type: data.type || null,
        disambiguation: data.disambiguation || null,
        bio: data.annotation || null,
        genres: (data.genres || []).map((g) => g.name).slice(0, 10),
        tags: (data.tags || []).slice(0, 10).map((t) => t.name),
        urls,
    };
}

module.exports = { searchRecording, searchArtist, getRecordingById, getArtistById };
