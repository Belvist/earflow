'use strict';

const mm = require('music-metadata');
const sharp = require('sharp');
const { execFile } = require('child_process');
const util = require('util');
const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const crypto = require('crypto');

const execFilePromise = util.promisify(execFile);

function normalizeGenre(value) {
    if (value === undefined || value === null) return null;
    const s = String(value).normalize('NFC').trim().replace(/\s+/g, ' ');
    return s ? s.slice(0, 100) : null;
}

function normalizeYear(value) {
    if (value === undefined || value === null || String(value).trim() === '') return null;
    const n = parseInt(String(value), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

async function ffprobeReadFormat(filePath) {
    try {
        const { stdout } = await execFilePromise('ffprobe', [
            '-v', 'quiet',
            '-print_format', 'json',
            '-show_format',
            filePath,
        ], { timeout: 30000 });

        const data = JSON.parse(stdout);
        const tags = data && data.format && data.format.tags ? data.format.tags : {};
        const duration = data && data.format && data.format.duration ? parseFloat(data.format.duration) : null;
        return {
            tags,
            duration: Number.isFinite(duration) ? duration : null,
        };
    } catch {
        return { tags: {}, duration: null };
    }
}

async function readAudioMeta({ filePath, normalizeTitle, normalizeArtist, normalizeAlbum }) {
    const p = String(filePath || '').trim();
    if (!p) {
        return { title: null, artist: null, album: null, genre: null, year: null, durationSeconds: null };
    }

    let title = null;
    let artist = null;
    let album = null;
    let genre = null;
    let year = null;
    let durationSeconds = null;

    const probed = await ffprobeReadFormat(p);
    if (Number.isFinite(probed?.duration) && probed.duration > 0) {
        durationSeconds = Math.round(probed.duration);
    }

    try {
        const meta = await mm.parseFile(p, { duration: !durationSeconds });
        if (normalizeTitle) title = normalizeTitle(meta?.common?.title) ?? null;
        if (normalizeArtist) artist = normalizeArtist(meta?.common?.artist) ?? null;
        if (normalizeAlbum) album = normalizeAlbum(meta?.common?.album) ?? null;
        const g = Array.isArray(meta?.common?.genre) ? meta.common.genre[0] : meta?.common?.genre;
        genre = normalizeGenre(g);
        year = normalizeYear(meta?.common?.year);
        if (!durationSeconds && Number.isFinite(meta?.format?.duration) && meta.format.duration > 0) {
            durationSeconds = Math.round(meta.format.duration);
        }
    } catch {
    }

    if (!title && normalizeTitle) title = normalizeTitle(probed?.tags?.title) ?? null;
    if (!artist && normalizeArtist) artist = normalizeArtist(probed?.tags?.artist) ?? null;
    if (!album && normalizeAlbum) album = normalizeAlbum(probed?.tags?.album) ?? null;

    return { title, artist, album, genre, year, durationSeconds };
}

async function extractCoverBuffer(filePath) {
    const p = String(filePath || '').trim();
    if (!p) return null;

    try {
        const meta = await mm.parseFile(p, { duration: false });
        const pics = Array.isArray(meta?.common?.picture) ? meta.common.picture : [];
        const first = pics.length > 0 ? pics[0] : null;
        if (first && Buffer.isBuffer(first.data) && first.data.length > 0) {
            return first.data;
        }
    } catch {
    }

    const tmpName = `cover_${Date.now()}_${crypto.randomBytes(8).toString('hex')}.jpg`;
    const tmpPath = path.join(os.tmpdir(), tmpName);

    try {
        await execFilePromise('ffmpeg', [
            '-y',
            '-i', p,
            '-an',
            '-map', '0:v:0',
            '-frames:v', '1',
            tmpPath,
        ], { timeout: 30000 });

        if (await fs.pathExists(tmpPath)) {
            const stat = await fs.stat(tmpPath);
            if (stat.size > 0) {
                return await fs.readFile(tmpPath);
            }
        }
    } catch {
        return null;
    } finally {
        await fs.remove(tmpPath).catch(() => null);
    }

    return null;
}

async function normalizeCoverToWebp(coverBuffer) {
    if (!Buffer.isBuffer(coverBuffer) || coverBuffer.length === 0) return null;
    try {
        return await sharp(coverBuffer)
            .resize(1000, 1000, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 85 })
            .toBuffer();
    } catch {
        return null;
    }
}

module.exports = {
    readAudioMeta,
    extractCoverBuffer,
    normalizeCoverToWebp,
};
