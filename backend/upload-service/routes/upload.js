'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');

const { deriveTitleFromFilename, normalizeTitle, normalizeArtist, normalizeAlbum } = require('../lib/normalizeText');
const audioMeta = require('../lib/audioMeta');

const UPLOAD_CONTEXT_HEADER = 'x-earflow-upload-context';
const UPLOAD_CONTEXT_ARTIST_PORTAL = 'artist-portal';

function createUploadRouter({
    authenticateUser,
    uploadLimiter,
    storageModule,
    fileValidator,
    db,
    accessControl,
    localUploadDir,
}) {
    const router = express.Router();

    function normalizeCoverPathForClient(rawCoverPath) {
        const coverPath = (rawCoverPath || '').toString().trim();
        if (!coverPath) return null;
        if (coverPath.startsWith('http://') || coverPath.startsWith('https://')) {
            return coverPath;
        }
        const normalized = coverPath.replace(/^\/+/, '');
        const filename = path.basename(normalized);
        if (!filename) return null;
        return `/covers/${filename}`;
    }

    function normalizeSongForClient(song) {
        if (!song || typeof song !== 'object') return song;
        const normalizedCover = normalizeCoverPathForClient(song.cover_path || song.coverPath);
        return {
            id: song.id,
            title: song.title,
            artist: song.artist,
            album: song.album,
            duration: song.duration || song.durationSeconds || song.duration_seconds,
            genre: song.genre,
            year: song.year,
            cover_path: normalizedCover || song.cover_path || song.coverPath,
            has_ebap: !!(song.has_ebap || song.hasEbap),
        };
    }

    const uploadRoot = String(localUploadDir || '').trim();
    if (!uploadRoot) {
        throw new Error('Upload directory is not configured');
    }

    const normalizeTempExtension = (originalname) => {
        const base = path.basename(String(originalname || ''));
        const ext = path.extname(base).toLowerCase();
        if (!ext) return '';
        if (fileValidator?.EXTENSION_SIGNATURE_MAP && typeof fileValidator.EXTENSION_SIGNATURE_MAP === 'object') {
            if (!Object.prototype.hasOwnProperty.call(fileValidator.EXTENSION_SIGNATURE_MAP, ext)) {
                return '';
            }
        }
        return ext;
    };

    const storage = multer.diskStorage({
        destination: (req, file, cb) => {
            void req;
            void file;
            cb(null, uploadRoot);
        },
        filename: (req, file, cb) => {
            void req;
            const ext = normalizeTempExtension(file.originalname);
            cb(null, `${uuidv4()}${ext}`);
        },
    });

    const upload = multer({
        storage,
        limits: {
            fileSize: fileValidator.LIMITS.maxFileSize,
            files: 1,
        },
    });

    async function cleanupTemp(filePath) {
        const p = String(filePath || '').trim();
        if (!p) return;
        await fs.remove(p).catch(() => null);
    }

    async function rollbackObjects({ audioKey, coverKey }) {
        if (!storageModule || typeof storageModule.deleteFile !== 'function') return;
        if (audioKey) {
            await storageModule.deleteFile(String(audioKey).replace(/^\/+/, ''), 'audio').catch(() => null);
        }
        if (coverKey) {
            await storageModule.deleteFile(String(coverKey).replace(/^\/+/, ''), 'covers').catch(() => null);
        }
    }

    async function ensureArtistUploaderOrAdmin(req) {
        const userId = accessControl.getRequestUserId(req);
        const requestIsAdmin = accessControl.getRequestIsAdmin(req);
        if (!userId) {
            const e = new Error('AUTH_REQUIRED');
            e.status = 401;
            throw e;
        }
        if (requestIsAdmin) {
            return { userId, requestIsAdmin, activeArtist: null };
        }
        if (db && db.artistOwnerships && typeof db.artistOwnerships.getOwnedArtistByUserId === 'function') {
            let owned = null;
            try {
                owned = await db.artistOwnerships.getOwnedArtistByUserId(userId);
            } catch {
                const e = new Error('DB_UNAVAILABLE');
                e.status = 503;
                e.code = 'DB_UNAVAILABLE';
                throw e;
            }
            if (owned && typeof owned.artistName === 'string' && owned.artistName.trim()) {
                return { userId, requestIsAdmin, activeArtist: { userId, artistName: owned.artistName.trim() } };
            }
        }

        const e = new Error('ACCESS_DENIED');
        e.status = 403;
        throw e;
    }

    function ensureArtistPortalUploadContext(req) {
        const raw = req && req.headers ? req.headers[UPLOAD_CONTEXT_HEADER] : null;
        const value = Array.isArray(raw) ? raw[0] : raw;
        if (String(value || '').trim().toLowerCase() === UPLOAD_CONTEXT_ARTIST_PORTAL) {
            return;
        }

        const e = new Error('ARTIST_PORTAL_ONLY');
        e.status = 403;
        e.code = 'ARTIST_PORTAL_ONLY';
        throw e;
    }

    async function handleUpload(req, res) {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ error: 'NO_FILE', code: 'NO_FILE' });
        }

        let audioKey = null;
        let coverKey = null;

        try {
            ensureArtistPortalUploadContext(req);

            const { userId, requestIsAdmin, activeArtist } = await ensureArtistUploaderOrAdmin(req);

            const limit = await fileValidator.checkUploadLimits(userId, db.songs.getUserUploadStats);
            if (!limit.allowed) {
                await cleanupTemp(file.path);
                return res.status(429).json({ error: limit.reason || 'UPLOAD_LIMIT', code: limit.reason || 'UPLOAD_LIMIT' });
            }

            const validation = await fileValidator.validateFile(file);
            if (!validation.valid) {
                await cleanupTemp(file.path);
                const code = Array.isArray(validation.errors) && validation.errors.length ? String(validation.errors[0]) : 'INVALID_FILE';
                return res.status(400).json({ error: code, code });
            }

            const ext = path.extname(validation.sanitizedFilename || file.originalname || '').toLowerCase();
            const contentType = (typeof fileValidator.mimeForExtension === 'function'
                ? fileValidator.mimeForExtension(ext)
                : null) || 'application/octet-stream';

            const fileHash = validation.hash || null;
            if (fileHash) {
                const dup = await fileValidator.checkDuplicate(fileHash, userId, db.songs.getSongByHash);
                if (dup.isDuplicate && dup.existingSong) {
                    await cleanupTemp(file.path);
                    return res.status(200).json(normalizeSongForClient(dup.existingSong));
                }
            }

            let meta = null;
            try {
                meta = await audioMeta.readAudioMeta({
                    filePath: file.path,
                    normalizeTitle,
                    normalizeArtist,
                    normalizeAlbum,
                });
            } catch {
                const e = new Error('AUDIO_META_FAILED');
                e.status = 422;
                e.code = 'AUDIO_META_FAILED';
                throw e;
            }

            const title = meta.title || deriveTitleFromFilename(file.originalname);
            const artist = requestIsAdmin ? (meta.artist || null) : (activeArtist?.artistName || null);
            const album = meta.album || null;

            if (!requestIsAdmin && (!artist || !String(artist).trim())) {
                const e = new Error('ARTIST_ACCESS_REQUIRED');
                e.status = 403;
                e.code = 'ARTIST_ACCESS_REQUIRED';
                throw e;
            }

            const safeFilename = validation.sanitizedFilename || file.originalname || 'audio';
            audioKey = storageModule.generateObjectKey(safeFilename, 'audio/');
            try {
                await storageModule.uploadFileFromPathWithKey(file.path, audioKey, {
                    bucket: 'audio',
                    contentType,
                    metadata: {
                        uploader: String(userId),
                    },
                });
            } catch {
                const e = new Error('STORAGE_UNAVAILABLE');
                e.status = 503;
                e.code = 'STORAGE_UNAVAILABLE';
                throw e;
            }

            const rawCover = await audioMeta.extractCoverBuffer(file.path);
            const coverWebp = rawCover ? await audioMeta.normalizeCoverToWebp(rawCover) : null;
            if (coverWebp) {
                coverKey = storageModule.generateObjectKey('cover.webp', 'covers/');
                try {
                    await storageModule.uploadBuffer(coverWebp, coverKey, 'image/webp');
                } catch {
                    const e = new Error('STORAGE_UNAVAILABLE');
                    e.status = 503;
                    e.code = 'STORAGE_UNAVAILABLE';
                    throw e;
                }
            }

            let created = null;
            try {
                created = await db.songs.createSong({
                    user_id: userId,
                    title,
                    artist,
                    album,
                    duration: meta.durationSeconds,
                    genre: meta.genre,
                    year: meta.year,
                    file_path: audioKey,
                    file_size: file.size,
                    mime_type: contentType,
                    cover_path: coverKey,
                    file_hash: fileHash,
                });
            } catch (err) {
                if (Number.isFinite(err?.status) && typeof err?.code === 'string') {
                    throw err;
                }

                const pgCode = err && typeof err === 'object' && typeof err.code === 'string' ? err.code : null;
                const diagnostics = err && typeof err === 'object' ? {
                    pgCode: typeof err.code === 'string' ? err.code : null,
                    constraint: typeof err.constraint === 'string' ? err.constraint : null,
                    column: typeof err.column === 'string' ? err.column : null,
                    table: typeof err.table === 'string' ? err.table : null,
                    schema: typeof err.schema === 'string' ? err.schema : null,
                } : null;

                const mapped = (() => {
                    if (
                        pgCode === '23502' ||
                        pgCode === '23503' ||
                        pgCode === '23505' ||
                        pgCode === '23514' ||
                        pgCode === '22P02' ||
                        pgCode === '22001' ||
                        pgCode === '22003'
                    ) {
                        return { code: 'DB_CONSTRAINT_VIOLATION', status: 422 };
                    }
                    if (pgCode === '42P01' || pgCode === '42703' || pgCode === '42883') return { code: 'DB_SCHEMA_MISMATCH', status: 503 };
                    if (pgCode === '57P01' || pgCode === '57P02' || pgCode === '57P03') return { code: 'DB_UNAVAILABLE', status: 503 };
                    return { code: 'DB_WRITE_FAILED', status: 503 };
                })();

                const e = new Error(mapped.code);
                e.status = mapped.status;
                e.code = mapped.code;
                e.details = diagnostics;
                throw e;
            }

            await cleanupTemp(file.path);
            return res.status(201).json(normalizeSongForClient(created));
        } catch (error) {
            await cleanupTemp(file.path);
            await rollbackObjects({ audioKey, coverKey });

            const status = Number.isFinite(error?.status) ? error.status : 500;
            if (status === 401) return res.status(401).json({ error: 'Authentication required' });

            const code = typeof error?.code === 'string' ? error.code : null;
            if (code === 'ARTIST_PORTAL_ONLY') return res.status(403).json({ error: 'Artist portal required', code });
            if (status === 403) return res.status(403).json({ error: 'Доступ запрещен' });
            if (code === 'DB_UNAVAILABLE') return res.status(503).json({ error: 'Service unavailable', code });
            if (code === 'DB_WRITE_FAILED') return res.status(503).json({ error: 'Service unavailable', code, details: error?.details || null });
            if (code === 'DB_SCHEMA_MISMATCH') return res.status(503).json({ error: 'Service unavailable', code });
            if (code === 'DB_CONSTRAINT_VIOLATION') return res.status(422).json({ error: 'Invalid metadata', code, details: error?.details || null });
            if (code === 'MINIO_UNAVAILABLE') return res.status(503).json({ error: 'Storage unavailable', code });
            if (code === 'STORAGE_UNAVAILABLE') return res.status(503).json({ error: 'Storage unavailable', code });
            if (code === 'AUDIO_META_FAILED') return res.status(422).json({ error: 'Invalid audio file', code });

            return res.status(500).json({ error: 'Upload failed', code: 'UPLOAD_FAILED' });
        }
    }

    router.post('/api/upload', authenticateUser, uploadLimiter, upload.single('file'), handleUpload);
    router.post('/api/upload/song', authenticateUser, uploadLimiter, upload.single('file'), handleUpload);

    return router;
}

module.exports = createUploadRouter;
