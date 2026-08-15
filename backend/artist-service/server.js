'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const { getCookieValue } = require('./lib/http/cookies');
const createAuthenticateUser = require('./middleware/authenticateUser');
const artistsDb = require('./lib/db/artists');
const artistRegistryDb = require('./lib/db/artistRegistry');
const albumsDb = require('./lib/db/albums');
const songsSitemapDb = require('./lib/db/songs');
const artistAnalyticsDb = require('./lib/db/artistAnalytics');
const {
    buildArtistClaimAutoReviewConfig,
    evaluateArtistClaimAutoReview,
} = require('./lib/artistClaimAutoReview');

const { registerSitemap } = require('./lib/sitemap');

function parsePositiveIntStrict(value) {
    const raw = value === undefined || value === null ? '' : String(value).trim();
    if (!/^\d+$/.test(raw)) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function resolveArtistIdentifier(raw) {
    const token = typeof raw === 'string' ? raw : '';
    const normalized = token.normalize('NFC').trim();
    const m = /^([a-f0-9]{32})(?:-.*)?$/i.exec(normalized);
    const pidCandidate = m ? String(m[1] || '') : normalized;
    const pid = artistRegistryDb.normalizePublicId(pidCandidate);
    return pid ? { kind: 'public_id', value: pid } : { kind: 'name', value: normalized };
}

function normalizeArtistNameInput(value) {
    const raw = value === undefined || value === null ? '' : String(value);
    const normalized = raw.normalize('NFC').trim().slice(0, 255);
    if (!normalized) return '';
    return normalized;
}

function normalizeAlbumNameParam(value) {
    const raw = value === undefined || value === null ? '' : String(value);
    return raw.normalize('NFC').trim().slice(0, 255);
}

async function resolveArtistCardOrNull(raw, userIdForCreate) {
    const resolved = resolveArtistIdentifier(raw);
    if (resolved.kind === 'public_id') {
        return await artistRegistryDb.getArtistCardByPublicId(resolved.value);
    }
    return await artistRegistryDb.ensureArtistCard(resolved.value, userIdForCreate);
}

async function resolveArtistCardReadOnlyOrNull(raw) {
    const resolved = resolveArtistIdentifier(raw);
    if (resolved.kind === 'public_id') {
        return await artistRegistryDb.getArtistCardByPublicId(resolved.value);
    }
    const normalized = normalizeArtistNameInput(resolved.value);
    if (!normalized) return null;

    const existing = await artistRegistryDb.getArtistCardByName(normalized);
    if (existing) return existing;

    const meta = await artistsDb.getArtistMeta(normalized);
    const trackCount = meta && Number.isFinite(Number(meta.trackCount)) ? Number(meta.trackCount) : 0;
    if (trackCount <= 0) {
        let anyCount = 0;
        try {
            anyCount = await artistsDb.getArtistTrackCountAny(normalized);
        } catch {
            anyCount = 0;
        }
        if (anyCount <= 0) return null;
    }

    return await artistRegistryDb.ensureArtistCard(normalized, null);
}

require('dotenv').config();

function sanitizeUrlForLogs(rawUrl) {
    try {
        const url = new URL(rawUrl, 'http://localhost');
        for (const key of [...url.searchParams.keys()]) {
            const lower = key.toLowerCase();
            if (lower === 'token' || lower.includes('token') || lower.includes('authorization') || lower.includes('password') || lower.includes('secret')) {
                url.searchParams.set(key, '[REDACTED]');
            }
        }
        return url.pathname + (url.search ? url.search : '');
    } catch {
        return String(rawUrl || '').replace(/([?&]token=)[^&]+/gi, '$1[REDACTED]');
    }
}

function normalizeCoverPathForClient(rawCoverPath) {
    const coverPath = (rawCoverPath || '').toString().trim();
    if (!coverPath) return null;
    if (coverPath.startsWith('http://') || coverPath.startsWith('https://')) {
        return coverPath;
    }
    const normalized = coverPath.replace(/^\/+/, '');
    const filename = normalized.split('/').pop();
    if (!filename) return null;
    if (!/^[A-Za-z0-9._-]{1,200}$/.test(filename)) return null;
    return `/covers/${encodeURIComponent(filename)}`;
}

function parseNonNegativeIntStrict(value) {
    const raw = value === undefined || value === null ? '' : String(value).trim();
    if (!/^(?:0|[1-9]\d*)$/.test(raw)) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function clampLimitForList(value, fallback, max) {
    const n = parsePositiveIntStrict(value);
    if (!n) return fallback;
    return Math.min(n, max);
}

function normalizeArtistCardForClient(card) {
    if (!card || typeof card !== 'object') return null;
    const artistPublicId = card.public_id ? String(card.public_id) : (card.publicId ? String(card.publicId) : '');
    const name = card.name ? String(card.name) : (card.artist ? String(card.artist) : '');
    if (!name) return null;

    const hero = normalizeCoverPathForClient(card.hero_cover_path || card.heroCoverPath || null);
    const avatar = normalizeCoverPathForClient(card.avatar_cover_path || card.avatarCoverPath || null);
    const banner = normalizeCoverPathForClient(card.banner_cover_path || card.bannerCoverPath || null);

    return {
        artistId: Number.isFinite(Number(card.id)) ? Number(card.id) : null,
        artistPublicId: artistPublicId || null,
        artistName: name,
        isVerified: card.is_verified === true || card.isVerified === true,
        heroCoverPath: hero,
        avatarCoverPath: avatar,
        bannerCoverPath: banner,
    };
}

const popularArtistsCache = new Map();

function getPopularArtistsCacheKey({ limit, offset }) {
    return `popular:${limit}:${offset}`;
}

function readPopularArtistsCache(key) {
    const entry = popularArtistsCache.get(key);
    if (!entry || typeof entry !== 'object') return null;
    const at = typeof entry.at === 'number' ? entry.at : 0;
    if (!at) return null;
    if (Date.now() - at > 60 * 1000) {
        popularArtistsCache.delete(key);
        return null;
    }
    return entry.data || null;
}

function writePopularArtistsCache(key, data) {
    popularArtistsCache.set(key, { at: Date.now(), data });
    if (popularArtistsCache.size <= 50) return;
    const entries = Array.from(popularArtistsCache.entries())
        .map(([k, v]) => ({ k, at: v && typeof v.at === 'number' ? v.at : 0 }))
        .sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
    const toDelete = entries.slice(0, Math.max(0, popularArtistsCache.size - 50));
    for (const item of toDelete) {
        popularArtistsCache.delete(item.k);
    }
}

function normalizeSongForClient(song) {
    if (!song || typeof song !== 'object') return song;
    const normalizedCover = normalizeCoverPathForClient(song.cover_path || song.coverPath);
    const playCountRaw = song.play_count ?? song.playCount;
    const popularityRaw = song.popularity;
    const playCount = Number.isFinite(Number(playCountRaw)) ? Number(playCountRaw) : 0;
    const popularity = Number.isFinite(Number(popularityRaw)) ? Number(popularityRaw) : 0;
    const publicIdRaw = String(song.public_id || song.publicId || '').trim().toLowerCase();
    const publicId = /^[0-9a-f]{16}$/.test(publicIdRaw) ? publicIdRaw : null;
    return {
        id: song.id,
        public_id: publicId,
        title: song.title,
        artist: song.artist,
        album: song.album,
        duration: song.duration,
        genre: song.genre,
        year: song.year,
        cover_path: normalizedCover || song.cover_path || song.coverPath,
        has_ebap: !!(song.has_ebap || song.hasEbap),
        play_count: playCount,
        popularity,
    };
}

function normalizeClaimNote(value) {
    if (value === null) return null;
    if (value === undefined) return '';
    if (typeof value !== 'string') return '';
    return value.normalize('NFC').trim().slice(0, 2000);
}

async function safeGetActiveOwnerUserId(card) {
    try {
        if (!card || !Number.isFinite(Number(card.id))) return null;
        return await artistRegistryDb.getActiveOwnerUserId(card.id);
    } catch {
        return null;
    }
}

function emptyArtistMetaResponse() {
    return { artist: null, trackCount: 0, albumCount: 0, totalPlays: null, heroCoverPath: null, topTrack: null };
}

function normalizeArtistMetaOrFallback(meta, name) {
    if (meta && typeof meta === 'object') return meta;
    return { artist: name, trackCount: 0, albumCount: 0, totalPlays: null, heroCoverPath: null, topTrack: null };
}

function hasUrlEvidence(text) {
    const s = typeof text === 'string' ? text : '';
    return /https?:\/\//i.test(s);
}

function toNonNegativeNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 0;
    return n;
}

function requireInternalServiceToken(req, res, next) {
    const expectedToken = process.env.INTERNAL_SERVICE_TOKEN || '';
    if (!expectedToken || expectedToken.length < 32) {
        return res.status(503).json({ error: 'SERVICE_AUTH_MISCONFIGURED' });
    }

    const provided = String(req.headers['x-internal-token'] || '').trim();
    if (!provided) {
        return res.status(401).json({ error: 'SERVICE_TOKEN_REQUIRED' });
    }

    const expected = Buffer.from(expectedToken);
    const actual = Buffer.from(provided);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
        return res.status(403).json({ error: 'SERVICE_TOKEN_INVALID' });
    }

    next();
}

function buildDashboardMetrics(meta) {
    return {
        monthlyPlays: toNonNegativeNumber(meta?.monthlyPlays),
        totalPlaysAllTime: toNonNegativeNumber(meta?.totalPlaysAllTime ?? meta?.totalPlays),
        uniqueListenersMonthly: toNonNegativeNumber(meta?.uniqueListenersMonthly),
        uniqueListenersAllTime: toNonNegativeNumber(meta?.uniqueListenersAllTime),
        likesCount: toNonNegativeNumber(meta?.likesCount),
        dislikesCount: toNonNegativeNumber(meta?.dislikesCount),
        playlistAdds: toNonNegativeNumber(meta?.playlistAdds),
    };
}

function attachArtistToClaim(claim, card, artistContext = null) {
    const ctx = artistContext && typeof artistContext === 'object' ? artistContext : {};
    return {
        ...claim,
        artist_name: card?.name || null,
        artist_public_id: card?.public_id || null,
        artist_popular: ctx.popular === true || card?.popular === true,
        artist_track_count: toNonNegativeNumber(ctx.trackCount ?? ctx.track_count),
        artist_total_plays: toNonNegativeNumber(ctx.totalPlays ?? ctx.total_plays),
    };
}

function normalizeAutoReviewForClient(review) {
    if (!review || typeof review !== 'object') return null;
    return {
        decision: String(review.decision || ''),
        action: review.action ? String(review.action) : null,
        reason: review.reason ? String(review.reason) : null,
        result: review.result ? String(review.result) : null,
        error: review.error ? String(review.error) : null,
    };
}

async function getArtistClaimContext(card) {
    const name = card?.name ? String(card.name) : '';
    const context = {
        popular: card?.popular === true,
        trackCount: 0,
        totalPlays: 0,
    };

    if (!name) return context;

    try {
        const meta = await artistsDb.getArtistMeta(name);
        context.trackCount = toNonNegativeNumber(meta?.trackCount);
        context.totalPlays = toNonNegativeNumber(meta?.totalPlays);
    } catch {
        context.trackCount = 0;
        context.totalPlays = 0;
    }

    if (context.trackCount <= 0) {
        try {
            context.trackCount = toNonNegativeNumber(await artistsDb.getArtistTrackCountAny(name));
        } catch {
            context.trackCount = 0;
        }
    }

    return context;
}

async function enrichClaimItemsForAdmin(items) {
    const list = Array.isArray(items) ? items : [];
    return await Promise.all(list.map(async (item) => {
        const artistName = item?.artist_name ? String(item.artist_name) : '';
        const context = {
            popular: item?.artist_popular === true,
            trackCount: 0,
            totalPlays: 0,
        };

        if (artistName) {
            try {
                const meta = await artistsDb.getArtistMeta(artistName);
                context.trackCount = toNonNegativeNumber(meta?.trackCount);
                context.totalPlays = toNonNegativeNumber(meta?.totalPlays);
            } catch {
                context.trackCount = 0;
                context.totalPlays = 0;
            }
        }

        return {
            ...item,
            artist_popular: context.popular,
            artist_track_count: context.trackCount,
            artist_total_plays: context.totalPlays,
        };
    }));
}

async function resolveArtistCardForClaimOrNull({ artistToken, userId, note }) {
    const resolved = resolveArtistIdentifier(artistToken);
    if (resolved.kind === 'public_id') {
        return await artistRegistryDb.getArtistCardByPublicId(resolved.value);
    }

    const name = normalizeArtistNameInput(resolved.value);
    if (!name) return null;

    const existing = await artistRegistryDb.getArtistCardByName(name);
    if (existing) return existing;

    const meta = await artistsDb.getArtistMeta(name);
    const trackCount = meta && Number.isFinite(Number(meta.trackCount)) ? Number(meta.trackCount) : 0;
    if (trackCount > 0) {
        return await artistRegistryDb.ensureArtistCard(name, null);
    }

    if (!hasUrlEvidence(note)) {
        return null;
    }

    return await artistRegistryDb.ensureArtistCard(name, userId);
}

const app = express();
const PORT = process.env.PORT || 3040;
const isProduction = process.env.NODE_ENV === 'production';

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:3001';
const JWT_SECRET = process.env.JWT_SECRET;
const artistClaimAutoReviewConfig = buildArtistClaimAutoReviewConfig(process.env);

if (!JWT_SECRET || JWT_SECRET.length < 32) {
    console.error('FATAL: JWT_SECRET must be set and at least 32 characters');
    process.exit(1);
}

const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
    : (() => {
        const cookieDomainRaw = String(process.env.COOKIE_DOMAIN || '').trim();
        const host = cookieDomainRaw.replace(/^\.+/, '').trim() || 'earflow.ru';
        return [`https://${host}`, `https://www.${host}`];
    })();

app.set('trust proxy', 1);

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
            connectSrc: ["'self'"],
        }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        if (!isProduction && /\.(ngrok-free\.app|ngrok\.io|loca\.lt)$/.test(origin)) {
            return callback(null, true);
        }
        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
}));

app.use(express.json({ limit: '64kb' }));

registerSitemap(app, {
    artistRegistryDb,
    albumsDb,
    songsDb: songsSitemapDb,
    isProduction,
    publicBaseUrl: process.env.PUBLIC_WEB_BASE_URL || 'https://earflow.ru',
});

const authenticateUser = createAuthenticateUser({
    authServiceUrl: AUTH_SERVICE_URL,
    jwtSecret: JWT_SECRET,
    axios,
    jwt,
    getCookieValue,
});

async function maybeAutoReviewArtistClaim({ claim, card, note, ownerUserId, artistContext }) {
    const review = evaluateArtistClaimAutoReview({
        claim,
        card,
        note,
        ownerUserId,
        artistContext,
        config: artistClaimAutoReviewConfig,
    });

    if (!review.action) {
        return { claim, review: { ...review, result: 'skipped' } };
    }

    try {
        const updated = await artistRegistryDb.autoReviewClaimRequest({
            claimId: claim?.id,
            action: review.action,
            reason: review.reason,
        });

        if (updated && !updated.error) {
            return { claim: updated, review: { ...review, result: 'applied' } };
        }

        return {
            claim,
            review: {
                ...review,
                result: 'failed',
                error: updated?.error || 'AUTO_REVIEW_NO_UPDATE',
            },
        };
    } catch (err) {
        console.warn('artist_claim_auto_review_failed', {
            claimId: claim?.id || null,
            action: review.action,
            reason: review.reason,
            error: err?.message || String(err),
        });
        return {
            claim,
            review: {
                decision: 'manual_review',
                action: null,
                reason: 'AUTO_REVIEW_FAILED',
                result: 'failed',
                error: 'AUTO_REVIEW_FAILED',
            },
        };
    }
}

app.get('/api/artists/claims/my', authenticateUser, async (req, res) => {
    const userId = req.user?.id;
    const requestIsAdmin = req.user?.isAdmin === true;
    const uid = parsePositiveIntStrict(userId);
    if (!uid) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    if (requestIsAdmin) {
        return res.status(403).json({ error: 'ADMIN_CANNOT_CLAIM', code: 'ADMIN_CANNOT_CLAIM' });
    }

    try {
        const status = typeof req.query.status === 'string' ? req.query.status : '';
        const limit = req.query.limit;
        const offset = req.query.offset;
        const items = await artistRegistryDb.listMyClaims({ userId: uid, status, limit, offset });
        return res.json(Array.isArray(items) ? items : []);
    } catch {
        return res.status(500).json({ error: 'Ошибка' });
    }
});

app.post('/api/artists/claims', authenticateUser, async (req, res) => {
    const userId = req.user?.id;
    const requestIsAdmin = req.user?.isAdmin === true;
    const uid = parsePositiveIntStrict(userId);
    if (!uid) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    if (requestIsAdmin) {
        return res.status(403).json({ error: 'ARTIST_ACCESS_REQUIRED' });
    }

    try {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const artistToken = typeof body.artist === 'string' ? body.artist : '';
        const note = normalizeClaimNote(body.note);
        const artistName = normalizeArtistNameInput(artistToken);
        if (!artistName) {
            return res.status(400).json({ error: 'INVALID_ARTIST' });
        }

        const existingOwned = await artistRegistryDb.getOwnedArtistByUserId(uid);
        if (existingOwned && Number.isFinite(Number(existingOwned.id))) {
            return res.status(409).json({ error: 'ALREADY_ARTIST' });
        }

        const existingCard = await artistRegistryDb.getArtistCardByName(artistName);
        const card = existingCard && Number.isFinite(Number(existingCard.id))
            ? existingCard
            : await artistRegistryDb.ensureArtistCard(artistName, uid);
        if (!card || !Number.isFinite(Number(card.id)) || !card.name) {
            return res.status(400).json({ error: 'INVALID_ARTIST' });
        }

        const ownerUserId = await artistRegistryDb.getActiveOwnerUserId(card.id);
        if (ownerUserId && Number.isFinite(Number(ownerUserId))) {
            return res.status(409).json({ error: 'ARTIST_ALREADY_HAS_OWNER' });
        }

        const artistContext = await getArtistClaimContext(card);
        const claim = await artistRegistryDb.upsertClaimRequest({ artistId: card.id, userId: uid, note });
        if (!claim) {
            return res.status(400).json({ error: 'INVALID_CLAIM' });
        }

        const autoReview = await maybeAutoReviewArtistClaim({
            claim,
            card,
            note,
            ownerUserId,
            artistContext,
        });
        const finalClaim = autoReview.claim || claim;

        return res.status(201).json({
            claim: attachArtistToClaim(finalClaim, card, artistContext),
            autoReview: normalizeAutoReviewForClient(autoReview.review),
        });
    } catch {
        return res.status(500).json({ error: 'Ошибка' });
    }
});

app.patch('/api/artists/me/card', authenticateUser, async (req, res) => {
    const userId = req.user?.id;
    const requestIsAdmin = req.user?.isAdmin === true;
    const uid = parsePositiveIntStrict(userId);
    if (!uid) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    if (requestIsAdmin) {
        return res.status(403).json({ error: 'ARTIST_ACCESS_REQUIRED' });
    }

    try {
        const owned = await artistRegistryDb.getOwnedArtistByUserId(uid);
        if (!owned || !Number.isFinite(Number(owned.id))) {
            return res.status(403).json({ error: 'ARTIST_OWNER_REQUIRED' });
        }

        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const bio = Object.prototype.hasOwnProperty.call(body, 'bio') ? body.bio : undefined;
        const heroCoverPath = Object.prototype.hasOwnProperty.call(body, 'heroCoverPath') ? body.heroCoverPath : undefined;
        const avatarCoverPath = Object.prototype.hasOwnProperty.call(body, 'avatarCoverPath') ? body.avatarCoverPath : undefined;
        const bannerCoverPath = Object.prototype.hasOwnProperty.call(body, 'bannerCoverPath') ? body.bannerCoverPath : undefined;

        const updated = await artistRegistryDb.updateArtistCardById({
            artistId: owned.id,
            bio,
            heroCoverPath,
            avatarCoverPath,
            bannerCoverPath,
        });

        if (!updated) {
            return res.status(400).json({ error: 'INVALID_UPDATE' });
        }

        return res.json({
            artistId: updated.id,
            artistPublicId: updated.public_id ? String(updated.public_id) : null,
            artistName: updated.name,
            isVerified: updated.is_verified === true,
            bio: updated.bio || null,
            heroCoverPath: updated.hero_cover_path || null,
            avatarCoverPath: updated.avatar_cover_path || null,
            bannerCoverPath: updated.banner_cover_path || null,
        });
    } catch {
        return res.status(500).json({ error: 'Ошибка' });
    }
});

app.get('/api/artists/me/card', authenticateUser, async (req, res) => {
    const userId = req.user?.id;
    const requestIsAdmin = req.user?.isAdmin === true;
    const uid = parsePositiveIntStrict(userId);
    if (!uid) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    if (requestIsAdmin) {
        return res.status(403).json({ error: 'ARTIST_ACCESS_REQUIRED' });
    }

    try {
        const owned = await artistRegistryDb.getOwnedArtistByUserId(uid);
        if (!owned || !Number.isFinite(Number(owned.id))) {
            return res.status(403).json({ error: 'ARTIST_OWNER_REQUIRED' });
        }

        const card = await artistRegistryDb.getArtistCardByName(owned.name);
        if (!card) {
            return res.status(404).json({ error: 'ARTIST_NOT_FOUND' });
        }

        return res.json({
            artistId: card.id,
            artistPublicId: card.public_id ? String(card.public_id) : null,
            artistName: card.name,
            isVerified: card.is_verified === true,
            bio: card.bio || null,
            heroCoverPath: card.hero_cover_path || null,
            avatarCoverPath: card.avatar_cover_path || null,
            bannerCoverPath: card.banner_cover_path || null,
        });
    } catch {
        return res.status(500).json({ error: 'Ошибка' });
    }
});

const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: isProduction ? 200 : 1000,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/health' || req.path === '/metrics',
});

app.use(globalLimiter);

app.get('/api/albums/resolve', authenticateUser, async (req, res) => {
    try {
        const artistRaw = typeof req.query.artist === 'string' ? req.query.artist : '';
        const nameRaw = typeof req.query.name === 'string' ? req.query.name : '';
        const albumName = normalizeAlbumNameParam(nameRaw);
        if (!albumName) {
            return res.status(400).json({ error: 'Некорректный альбом' });
        }

        const card = await resolveArtistCardOrNull(artistRaw, req.user?.id);
        if (!card || !card.name || !Number.isFinite(Number(card.id))) {
            return res.status(404).json({ error: 'Артист не найден' });
        }

        const album = await albumsDb.ensureAlbum({ artistId: card.id, name: albumName });
        if (!album || !album.public_id) {
            return res.status(500).json({ error: 'Не удалось создать альбом' });
        }

        return res.json({
            albumPublicId: String(album.public_id),
            albumName: album.name,
            artistName: card.name,
            artistPublicId: card.public_id ? String(card.public_id) : null,
        });
    } catch {
        return res.status(500).json({ error: 'Ошибка' });
    }
});

app.get('/api/albums/:albumPublicId', async (req, res) => {
    try {
        const pid = typeof req.params.albumPublicId === 'string' ? req.params.albumPublicId : '';
        const album = await albumsDb.getAlbumByPublicId(pid);
        if (!album) {
            return res.status(404).json({ error: 'Альбом не найден' });
        }

        const artist = await albumsDb.getAlbumArtistCard(album);
        if (!artist || !artist.name) {
            return res.status(404).json({ error: 'Артист не найден' });
        }

        const stats = await albumsDb.getAlbumStats({ artistName: artist.name, albumName: album.name });
        const heroCoverPath = normalizeCoverPathForClient(stats.heroCoverPath);

        return res.json({
            albumPublicId: String(album.public_id),
            albumName: album.name,
            artistName: artist.name,
            artistPublicId: artist.public_id ? String(artist.public_id) : null,
            trackCount: Number.isFinite(Number(stats.trackCount)) ? Number(stats.trackCount) : 0,
            totalPlays: stats.totalPlays === null || stats.totalPlays === undefined ? null : (Number.isFinite(Number(stats.totalPlays)) ? Number(stats.totalPlays) : 0),
            year: stats.year === null || stats.year === undefined ? null : (Number.isFinite(Number(stats.year)) ? Number(stats.year) : null),
            heroCoverPath,
        });
    } catch {
        return res.status(500).json({ error: 'Ошибка' });
    }
});

app.get('/api/albums/:albumPublicId/tracks', async (req, res) => {
    try {
        const pid = typeof req.params.albumPublicId === 'string' ? req.params.albumPublicId : '';
        const album = await albumsDb.getAlbumByPublicId(pid);
        if (!album) {
            return res.status(404).json({ error: 'Альбом не найден' });
        }

        const artist = await albumsDb.getAlbumArtistCard(album);
        if (!artist || !artist.name) {
            return res.status(404).json({ error: 'Артист не найден' });
        }

        const limit = req.query.limit;
        const offset = req.query.offset;
        const tracks = await albumsDb.listAlbumTracks({ artistName: artist.name, albumName: album.name }, { limit, offset });
        const normalized = (Array.isArray(tracks) ? tracks : []).map(normalizeSongForClient);
        return res.json(normalized);
    } catch {
        return res.status(500).json({ error: 'Ошибка' });
    }
});

const morganFormat = isProduction ? ':remote-addr - :method :url :status :response-time ms' : 'dev';
morgan.token('safe-url', (req) => sanitizeUrlForLogs(req.originalUrl || req.url));
const effectiveMorganFormat = isProduction ? ':remote-addr - :method :safe-url :status :response-time ms' : 'dev';
app.use(morgan(effectiveMorganFormat, { skip: (req) => req.path === '/health' }));

app.get('/health', (req, res) => {
    void req;
    res.json({ status: 'healthy', service: 'artist-service' });
});

app.get('/metrics', (req, res) => {
    void req;
    res.json({ uptime_seconds: process.uptime(), node_version: process.version });
});

app.get('/api/artists/me', authenticateUser, async (req, res) => {
    const userId = req.user?.id;
    const requestIsAdmin = req.user?.isAdmin === true;
    const uid = parsePositiveIntStrict(userId);
    if (!uid) {
        return res.status(401).json({ isArtist: false, isAdmin: false, artistName: null, artistPublicId: null, userId: null });
    }
    try {
        const owned = await artistRegistryDb.getOwnedArtistByUserId(uid);
        if (owned && owned.name) {
            return res.json({ isArtist: true, isAdmin: requestIsAdmin, artistName: owned.name, artistPublicId: owned.public_id || null, userId: uid });
        }
    } catch {
    }

    return res.json({ isArtist: false, isAdmin: requestIsAdmin, artistName: null, artistPublicId: null, userId: uid });
});

app.get('/api/artists', async (req, res) => {
    try {
        const q = typeof req.query.q === 'string' ? req.query.q : '';
        const limit = req.query.limit;
        const offset = req.query.offset;
        const items = await artistsDb.listArtists({ q, limit, offset });
        return res.json(Array.isArray(items) ? items : []);
    } catch {
        return res.json([]);
    }
});

app.get('/api/artists/popular', async (req, res) => {
    const limit = clampLimitForList(req.query.limit, 12, 48);
    const offset = (() => {
        const n = parseNonNegativeIntStrict(req.query.offset);
        return n === null ? 0 : n;
    })();

    const cacheKey = getPopularArtistsCacheKey({ limit, offset });
    const cached = readPopularArtistsCache(cacheKey);
    if (cached) {
        return res.json(cached);
    }

    try {
        const curated = await artistRegistryDb.listPopularArtistCards({ limit, offset });
        const curatedNorm = (Array.isArray(curated) ? curated : [])
            .map(normalizeArtistCardForClient)
            .filter(Boolean);

        if (curatedNorm.length > 0) {
            const payload = { items: curatedNorm, limit, offset, source: 'curated' };
            writePopularArtistsCache(cacheKey, payload);
            return res.json(payload);
        }

        const fallback = await artistsDb.listPopularArtistsFallback({ limit, offset });
        const fallbackItems = (Array.isArray(fallback) ? fallback : [])
            .map((a) => {
                const name = a && a.name ? String(a.name) : '';
                if (!name) return null;
                const trackCount = Number.isFinite(Number(a.trackCount)) ? Number(a.trackCount) : 0;
                const cover = normalizeCoverPathForClient(a && (a.coverPath || a.cover_path) ? (a.coverPath || a.cover_path) : null);
                return { artistName: name, artistPublicId: null, isVerified: false, trackCount, heroCoverPath: cover };
            })
            .filter(Boolean);

        const nameKeys = fallbackItems.map((i) => artistRegistryDb.normalizeArtistKey(i.artistName)).filter(Boolean);
        const cards = await artistRegistryDb.getArtistCardsByNameKeys(nameKeys);
        const cardsByKey = new Map(
            (Array.isArray(cards) ? cards : [])
                .filter((c) => c && c.name_key)
                .map((c) => [String(c.name_key), c])
        );

        const missingCards = fallbackItems
            .map((item) => {
                const key = artistRegistryDb.normalizeArtistKey(item.artistName);
                if (!key) return null;
                if (cardsByKey.has(key)) return null;
                return { key, name: item.artistName };
            })
            .filter(Boolean);

        if (missingCards.length > 0) {
            const created = await Promise.all(
                missingCards.map((m) => artistRegistryDb.ensureArtistCard(m.name, null).catch(() => null))
            );
            for (const c of created) {
                if (c && c.name_key) {
                    cardsByKey.set(String(c.name_key), c);
                }
            }
        }

        const enrichedItems = fallbackItems.map((item) => {
            const key = artistRegistryDb.normalizeArtistKey(item.artistName);
            const card = key ? cardsByKey.get(key) : null;
            if (!card) return item;

            const norm = normalizeArtistCardForClient(card);
            if (!norm) return item;

            return {
                ...item,
                artistPublicId: norm.artistPublicId || item.artistPublicId,
                isVerified: norm.isVerified === true || item.isVerified === true,
                heroCoverPath: norm.heroCoverPath || item.heroCoverPath || null,
                avatarCoverPath: norm.avatarCoverPath || item.avatarCoverPath || null,
                bannerCoverPath: norm.bannerCoverPath || item.bannerCoverPath || null,
            };
        });

        const payload = { items: enrichedItems, limit, offset, source: 'fallback' };
        writePopularArtistsCache(cacheKey, payload);
        return res.json(payload);
    } catch {
        return res.json({ items: [], limit, offset, source: 'error' });
    }
});

app.get('/api/artists/:artist/meta', async (req, res) => {
    try {
        const artistToken = typeof req.params.artist === 'string' ? req.params.artist : '';
        const card = await resolveArtistCardReadOnlyOrNull(artistToken);
        if (!card) return res.status(404).json(emptyArtistMetaResponse());

        const name = card.name ? String(card.name) : '';
        if (!name) return res.status(404).json(emptyArtistMetaResponse());

        let meta = null;
        try {
            meta = await artistsDb.getArtistMeta(name);
        } catch {
            meta = null;
        }
        meta = normalizeArtistMetaOrFallback(meta, name);
        const ownerUserId = await safeGetActiveOwnerUserId(card);

        const heroCover = normalizeCoverPathForClient(meta?.heroCoverPath ?? null);
        const avatarCoverPath = normalizeCoverPathForClient(card.avatar_cover_path || null);
        const bannerCoverPath = normalizeCoverPathForClient(card.banner_cover_path || null);

        const artistId = Number.isFinite(Number(card.id)) ? Number(card.id) : null;
        const artistPublicId = card.public_id ? String(card.public_id) : null;
        const isVerified = card.is_verified === true;

        const trackCount = Number.isFinite(Number(meta?.trackCount)) ? Number(meta.trackCount) : 0;
        const albumCount = Number.isFinite(Number(meta?.albumCount)) ? Number(meta.albumCount) : 0;
        const totalPlays = meta?.totalPlays === null || meta?.totalPlays === undefined
            ? null
            : (Number.isFinite(Number(meta.totalPlays)) ? Number(meta.totalPlays) : 0);

        const bio = typeof card.bio === 'string' ? card.bio.slice(0, 2000) : null;

        return res.json({
            artist: meta?.artist ? meta.artist : null,
            artistId,
            artistPublicId,
            isVerified,
            hasOwner: !!ownerUserId,
            bio,
            trackCount,
            albumCount,
            totalPlays,
            heroCoverPath: heroCover,
            avatarCoverPath,
            bannerCoverPath,
            topTrack: meta?.topTrack ? meta.topTrack : null,
        });
    } catch {
        return res.json(emptyArtistMetaResponse());
    }
});

app.get('/api/artists/admin/claims', authenticateUser, async (req, res) => {
    if (req.user?.isAdmin !== true) {
        return res.status(403).json({ error: 'Недостаточно прав' });
    }
    try {
        const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
        const limit = req.query.limit;
        const offset = req.query.offset;
        const items = await artistRegistryDb.listClaimRequests({ status, limit, offset });
        return res.json(await enrichClaimItemsForAdmin(items));
    } catch {
        return res.status(500).json({ error: 'Ошибка' });
    }
});

app.post('/api/artists/admin/claims/:id/review', authenticateUser, async (req, res) => {
    if (req.user?.isAdmin !== true) {
        return res.status(403).json({ error: 'Недостаточно прав' });
    }
    try {
        const claimId = req.params.id;
        const action = req.body && typeof req.body.action === 'string' ? req.body.action : '';
        const reason = req.body && typeof req.body.reason === 'string' ? req.body.reason : '';

        const updated = await artistRegistryDb.reviewClaimRequest({
            claimId,
            reviewerUserId: req.user?.id,
            action,
            reason,
        });

        if (updated && updated.error) {
            const code = String(updated.error || 'CLAIM_REVIEW_FAILED');
            if (code === 'ARTIST_ALREADY_HAS_OWNER') {
                return res.status(409).json({ error: code, code });
            }
            if (code === 'CLAIM_NOT_FOUND') {
                return res.status(404).json({ error: code, code });
            }
            if (code === 'CLAIM_ALREADY_APPROVED' || code === 'CLAIM_NOT_REVIEWABLE') {
                return res.status(409).json({ error: code, code, status: updated.status || null });
            }
            return res.status(400).json({ error: code, code });
        }

        if (!updated) {
            return res.status(400).json({ error: 'Заявка не найдена или уже обработана' });
        }
        return res.json({ ok: true, claim: updated });
    } catch {
        return res.status(500).json({ error: 'Ошибка' });
    }
});

app.get('/internal/artists/:artist/analytics', requireInternalServiceToken, async (req, res) => {
    try {
        const artistToken = typeof req.params.artist === 'string' ? req.params.artist : '';
        const card = await resolveArtistCardReadOnlyOrNull(artistToken);
        if (!card || !card.name) {
            return res.status(404).json({ error: 'ARTIST_NOT_FOUND' });
        }

        const trendDays = Math.min(Math.max(parseInt(String(req.query.days || '30'), 10) || 30, 1), 90);
        const topTracksLimit = Math.min(Math.max(parseInt(String(req.query.topTracks || '20'), 10) || 20, 1), 50);

        const analytics = await artistAnalyticsDb.getFullAnalytics(card.name, {
            trendDays,
            topTracksLimit,
        });

        return res.json({
            artistName: card.name,
            artistPublicId: card.public_id ? String(card.public_id) : null,
            ...analytics,
        });
    } catch {
        return res.status(500).json({ error: 'ANALYTICS_ERROR' });
    }
});

app.get('/internal/artists/:artist/dashboard-metrics', requireInternalServiceToken, async (req, res) => {
    try {
        const artistToken = typeof req.params.artist === 'string' ? req.params.artist : '';
        const card = await resolveArtistCardReadOnlyOrNull(artistToken);
        if (!card || !card.name) {
            return res.status(404).json({ error: 'ARTIST_NOT_FOUND' });
        }

        let meta = null;
        try {
            meta = await artistsDb.getArtistMeta(card.name);
        } catch {
            meta = null;
        }

        return res.json({
            artistName: card.name,
            artistPublicId: card.public_id ? String(card.public_id) : null,
            ...buildDashboardMetrics(meta),
        });
    } catch {
        return res.status(500).json({ error: 'DASHBOARD_METRICS_ERROR' });
    }
});

app.get('/api/artists/:artist/tracks', async (req, res) => {
    try {
        const artist = typeof req.params.artist === 'string' ? req.params.artist : '';
        const limit = req.query.limit;
        const offset = req.query.offset;
        const sort = req.query.sort;
        const year = req.query.year;
        const card = await resolveArtistCardReadOnlyOrNull(artist);
        if (!card || !card.name) {
            return res.json([]);
        }
        const tracks = await artistsDb.listArtistTracks(card.name, { limit, offset, sort, year });
        const normalized = (Array.isArray(tracks) ? tracks : []).map(normalizeSongForClient);
        return res.json(normalized);
    } catch {
        return res.json([]);
    }
});

app.listen(PORT, () => {
    void isProduction;
});
