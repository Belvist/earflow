'use strict';

const path = require('path');
const unzipper = require('unzipper');
const db = require('./database');
const { normalizePlainText, plainTextToSyncedLines } = require('./plainLyrics');

function parsePositiveInt(value) {
    const n = parseInt(String(value || ''), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function clampString(value, maxLen) {
    const s = typeof value === 'string' ? value.trim() : '';
    if (!s) return '';
    return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function safeBaseName(filename) {
    const base = path.basename(String(filename || '')).replace(/\0/g, '').trim();
    if (!base) return '';
    return base.length > 220 ? base.slice(0, 220) : base;
}

function hasCyrillic(value) {
    return /[\u0400-\u04FF]/.test(String(value || ''));
}

function looksLikeUtf8Mojibake(value) {
    const s = String(value || '');
    if (!s) return false;
    if (hasCyrillic(s)) return false;
    return /[ÐÑ]/.test(s);
}

function tryRecoverUtf8Filename(value) {
    const s = String(value || '');
    if (!looksLikeUtf8Mojibake(s)) return s;
    let recovered = '';
    try {
        recovered = Buffer.from(s, 'latin1').toString('utf8');
    } catch {
        recovered = '';
    }
    if (!recovered) return s;
    if (!hasCyrillic(recovered)) return s;
    if (/\uFFFD/.test(recovered)) return s;
    return recovered;
}

function parseFileMappingFromBaseName(baseName) {
    const name = String(baseName || '').trim();
    if (!name) return { songId: null, artist: '', title: '' };

    const numericMatch = name.match(/^\s*(\d{1,10})\s*$/);
    if (numericMatch) {
        const sid = parsePositiveInt(numericMatch[1]);
        return { songId: sid, artist: '', title: '' };
    }

    const normalized = name.replace(/\s+/g, ' ').trim();
    const parts = normalized.split(' - ');
    if (parts.length >= 2) {
        const artist = clampString(parts[0], 200);
        const title = clampString(parts.slice(1).join(' - '), 200);
        return { songId: null, artist, title };
    }

    return { songId: null, artist: '', title: clampString(normalized, 200) };
}

async function readZipEntriesFromBuffer(zipBuffer, limits) {
    const dir = await unzipper.Open.buffer(zipBuffer);
    const files = Array.isArray(dir?.files) ? dir.files : [];

    const out = [];
    let totalBytes = 0;

    for (const entry of files) {
        if (!entry || entry.type !== 'File') continue;

        const entryPath = typeof entry.path === 'string' ? entry.path : '';
        const base = safeBaseName(tryRecoverUtf8Filename(entryPath));
        if (!base) continue;
        if (entryPath.includes('..') || entryPath.startsWith('/') || entryPath.startsWith('\\')) continue;

        const ext = path.extname(base).toLowerCase();
        if (ext !== '.txt' && ext !== '.lrc') continue;

        const uncompressed = Number(entry?.vars?.uncompressedSize);
        if (Number.isFinite(uncompressed) && uncompressed > limits.maxEntryBytes) {
            out.push({ fileName: base, ok: false, error: 'ENTRY_TOO_LARGE' });
            continue;
        }

        if (out.length >= limits.maxFiles) {
            out.push({ fileName: base, ok: false, error: 'TOO_MANY_FILES' });
            break;
        }

        let buf;
        try {
            buf = await entry.buffer();
        } catch {
            out.push({ fileName: base, ok: false, error: 'ENTRY_READ_FAILED' });
            continue;
        }

        const size = buf ? buf.byteLength : 0;
        if (size <= 0) {
            out.push({ fileName: base, ok: false, error: 'EMPTY_FILE' });
            continue;
        }
        if (size > limits.maxEntryBytes) {
            out.push({ fileName: base, ok: false, error: 'ENTRY_TOO_LARGE' });
            continue;
        }

        totalBytes += size;
        if (totalBytes > limits.maxTotalBytes) {
            out.push({ fileName: base, ok: false, error: 'ZIP_TOTAL_TOO_LARGE' });
            break;
        }

        out.push({ fileName: base, ok: true, buffer: buf });
    }

    return out;
}

async function resolveSongIdForImport({ uploaderId, requestIsAdmin, mapping }) {
    const uid = parsePositiveInt(uploaderId);
    if (!uid) return { status: 'unauthorized', songId: null, candidates: [] };

    if (mapping.songId) {
        const allowed = await db.canUserEditLyricsRbac({ requestUserId: uid, requestIsAdmin, songId: mapping.songId });
        return allowed
            ? { status: 'ok', songId: mapping.songId, candidates: [] }
            : { status: 'forbidden', songId: null, candidates: [] };
    }

    const artist = clampString(mapping.artist, 200);
    const title = clampString(mapping.title, 200);
    if (!title) return { status: 'not_found', songId: null, candidates: [] };

    const findByArtistTitle = async ({ artist: a, title: t }) => {
        if (!a || !t) return [];
        if (requestIsAdmin === true) {
            return await db.findSongsByArtistTitle({ artist: a, title: t, limit: 5 });
        }
        return await db.findSongsByUploaderArtistTitle({ uploaderId: uid, artist: a, title: t, limit: 5 });
    };

    const byArtistTitle = artist ? await findByArtistTitle({ artist, title }) : [];
    if (byArtistTitle.length === 1) return { status: 'ok', songId: byArtistTitle[0].id, candidates: [] };
    if (byArtistTitle.length > 1) return { status: 'conflict', songId: null, candidates: byArtistTitle };

    const swapped = artist ? await findByArtistTitle({ artist: title, title: artist }) : [];
    if (swapped.length === 1) return { status: 'ok', songId: swapped[0].id, candidates: [] };
    if (swapped.length > 1) return { status: 'conflict', songId: null, candidates: swapped };

    const findByTitle = async (t) => {
        if (!t) return [];
        if (requestIsAdmin === true) {
            return await db.findSongsByTitle({ title: t, limit: 5 });
        }
        return await db.findSongsByUploaderTitle({ uploaderId: uid, title: t, limit: 5 });
    };

    const byTitle = await findByTitle(title);
    if (byTitle.length === 1) return { status: 'ok', songId: byTitle[0].id, candidates: [] };
    if (byTitle.length > 1) return { status: 'conflict', songId: null, candidates: byTitle };

    const byAltTitle = artist ? await findByTitle(artist) : [];
    if (byAltTitle.length === 1) return { status: 'ok', songId: byAltTitle[0].id, candidates: [] };
    if (byAltTitle.length > 1) return { status: 'conflict', songId: null, candidates: byAltTitle };

    return { status: 'not_found', songId: null, candidates: [] };
}

function parseImportLanguage(raw) {
    const language = clampString(raw, 5) || 'ru';
    if (language.length < 2 || language.length > 5) {
        const err = new Error('INVALID_LANGUAGE');
        err.status = 400;
        err.safeMessage = 'Ошибка валидации';
        err.details = ['Недопустимый язык'];
        throw err;
    }
    return language;
}

async function importLyricsFromUpload({ userId, requestIsAdmin, file, language: rawLanguage }) {
    const uid = parsePositiveInt(userId);
    if (!uid) {
        const err = new Error('UNAUTHORIZED');
        err.status = 401;
        err.safeMessage = 'Требуется авторизация';
        throw err;
    }

    const f = file && typeof file === 'object' ? file : null;
    const originalName = safeBaseName(tryRecoverUtf8Filename(f?.originalname));
    const buf = f?.buffer;

    if (!originalName || !(buf instanceof Buffer) || buf.byteLength <= 0) {
        const err = new Error('FILE_REQUIRED');
        err.status = 400;
        err.safeMessage = 'Файл обязателен';
        throw err;
    }

    const language = parseImportLanguage(rawLanguage);

    const ext = path.extname(originalName).toLowerCase();
    const limits = {
        maxFiles: 200,
        maxEntryBytes: 256 * 1024,
        maxTotalBytes: 5 * 1024 * 1024,
    };

    const items = [];

    if (ext === '.zip') {
        let entries;
        try {
            entries = await readZipEntriesFromBuffer(buf, limits);
        } catch {
            const err = new Error('ZIP_UNPACK_FAILED');
            err.status = 400;
            err.safeMessage = 'Невозможно распаковать архив';
            throw err;
        }

        for (const e of entries) {
            if (!e.ok) {
                items.push({ fileName: e.fileName, status: 'invalid', reason: e.error });
                continue;
            }
            items.push({ fileName: e.fileName, buffer: e.buffer, status: 'pending' });
        }
    } else if (ext === '.txt' || ext === '.lrc') {
        items.push({ fileName: originalName, buffer: buf, status: 'pending' });
    } else {
        const err = new Error('UNSUPPORTED_FILE_TYPE');
        err.status = 400;
        err.safeMessage = 'Поддерживаются только .txt, .lrc или .zip';
        throw err;
    }

    if (items.length === 0) {
        const err = new Error('NO_FILES');
        err.status = 400;
        err.safeMessage = 'Нет подходящих файлов для импорта';
        throw err;
    }

    const results = [];
    let imported = 0;

    for (const item of items) {
        if (item.status !== 'pending') {
            results.push({ fileName: item.fileName, status: item.status, reason: item.reason });
            continue;
        }

        const base = path.basename(item.fileName);
        const baseNoExt = base.replace(/\.[^.]+$/, '');
        const mapping = parseFileMappingFromBaseName(baseNoExt);
        const resolved = await resolveSongIdForImport({ uploaderId: uid, requestIsAdmin, mapping });

        if (resolved.status === 'forbidden') {
            results.push({ fileName: item.fileName, status: 'forbidden' });
            continue;
        }

        if (resolved.status === 'conflict') {
            results.push({
                fileName: item.fileName,
                status: 'conflict',
                candidates: resolved.candidates.map((c) => ({ id: c.id, artist: c.artist, title: c.title })).slice(0, 5),
            });
            continue;
        }

        if (resolved.status !== 'ok' || !resolved.songId) {
            results.push({ fileName: item.fileName, status: 'not_found' });
            continue;
        }

        const rawText = item.buffer.toString('utf8');
        const normalized = normalizePlainText(rawText);
        if (!normalized) {
            results.push({ fileName: item.fileName, status: 'invalid', reason: 'EMPTY_LYRICS' });
            continue;
        }

        const meta = await db.getSongMetadata(resolved.songId);
        const durationSeconds = meta ? meta.duration : null;
        const lines = plainTextToSyncedLines({ plainText: normalized, durationSeconds });
        if (!Array.isArray(lines) || lines.length === 0) {
            results.push({ fileName: item.fileName, status: 'invalid', reason: 'PARSE_FAILED' });
            continue;
        }

        await db.createLyrics({
            songId: resolved.songId,
            lines,
            language,
            createdBy: uid,
            source: 'import',
        });

        imported += 1;
        results.push({ fileName: item.fileName, status: 'imported', songId: resolved.songId });
    }

    return {
        ok: true,
        imported,
        total: results.length,
        results,
    };
}

module.exports = {
    importLyricsFromUpload,
    safeBaseName,
};
