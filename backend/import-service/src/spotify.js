'use strict';

const https = require('https');
const cfg = require('./config');

let _token = null;
let _tokenExpiresAt = 0;

function httpsPost(url, body, headers) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const opts = {
            hostname: parsed.hostname,
            path: parsed.pathname + parsed.search,
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), ...headers },
        };
        const req = https.request(opts, (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { data += c; });
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', reject);
        req.setTimeout(8000, () => { req.destroy(); reject(new Error('Request timeout')); });
        req.write(body);
        req.end();
    });
}

function httpsGet(url, headers) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const opts = {
            hostname: parsed.hostname,
            path: parsed.pathname + parsed.search,
            method: 'GET',
            headers: { Accept: 'application/json', ...headers },
        };
        const req = https.request(opts, (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { data += c; });
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', reject);
        req.setTimeout(8000, () => { req.destroy(); reject(new Error('Request timeout')); });
        req.end();
    });
}

function isEnabled() {
    return !!(cfg.spotifyClientId && cfg.spotifyClientSecret);
}

async function getToken() {
    if (!isEnabled()) throw new Error('Spotify not configured');
    if (_token && Date.now() < _tokenExpiresAt - 30000) return _token;
    const creds = Buffer.from(`${cfg.spotifyClientId}:${cfg.spotifyClientSecret}`).toString('base64');
    const { status, body } = await httpsPost(
        'https://accounts.spotify.com/api/token',
        'grant_type=client_credentials',
        { Authorization: `Basic ${creds}` }
    );
    if (status !== 200) throw new Error(`Spotify auth failed: ${status}`);
    const data = JSON.parse(body);
    _token = data.access_token;
    _tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
    return _token;
}

async function searchTrack(query, limit = 5) {
    const token = await getToken();
    const qs = new URLSearchParams({ q: query, type: 'track', limit: String(limit) }).toString();
    const { status, body } = await httpsGet(`https://api.spotify.com/v1/search?${qs}`, {
        Authorization: `Bearer ${token}`,
    });
    if (status === 429) throw Object.assign(new Error('Spotify rate limited'), { status: 429 });
    if (status >= 400) throw Object.assign(new Error(`Spotify error ${status}`), { status });
    const data = JSON.parse(body);
    return (data.tracks?.items || []).map((t) => ({
        spotifyId: t.id,
        title: t.name,
        artist: t.artists.map((a) => a.name).join(', '),
        album: t.album?.name || null,
        year: t.album?.release_date ? parseInt(t.album.release_date, 10) || null : null,
        durationMs: t.duration_ms,
        popularity: t.popularity,
        previewUrl: t.preview_url || null,
        coverUrl: t.album?.images?.[0]?.url || null,
        isrc: t.external_ids?.isrc || null,
    }));
}

async function getAudioFeatures(spotifyId) {
    const token = await getToken();
    const { status, body } = await httpsGet(`https://api.spotify.com/v1/audio-features/${spotifyId}`, {
        Authorization: `Bearer ${token}`,
    });
    if (status === 429) throw Object.assign(new Error('Spotify rate limited'), { status: 429 });
    if (status >= 400) return null;
    const d = JSON.parse(body);
    return {
        bpm: d.tempo ? Math.round(d.tempo) : null,
        key: d.key,
        mode: d.mode,
        timeSignature: d.time_signature,
        energy: d.energy,
        danceability: d.danceability,
        valence: d.valence,
        acousticness: d.acousticness,
        instrumentalness: d.instrumentalness,
        speechiness: d.speechiness,
        loudness: d.loudness,
    };
}

module.exports = { isEnabled, searchTrack, getAudioFeatures };
