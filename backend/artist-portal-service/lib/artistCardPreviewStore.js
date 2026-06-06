'use strict';

const crypto = require('node:crypto');
const { getRedisClient } = require('./redisClient');

const TOKEN_TTL_SECONDS = Number.isFinite(Number(process.env.ARTIST_CARD_PREVIEW_TOKEN_TTL_SECONDS))
    ? Math.max(30, Math.min(Number(process.env.ARTIST_CARD_PREVIEW_TOKEN_TTL_SECONDS), 3600))
    : 10 * 60;

const DRAFT_TTL_SECONDS = Number.isFinite(Number(process.env.ARTIST_CARD_PREVIEW_DRAFT_TTL_SECONDS))
    ? Math.max(30, Math.min(Number(process.env.ARTIST_CARD_PREVIEW_DRAFT_TTL_SECONDS), 6 * 3600))
    : TOKEN_TTL_SECONDS;

const SAFE_COVER_PATH_RE = /^[a-zA-Z0-9/_.-]{1,500}$/;

function nowIso() {
    return new Date().toISOString();
}

function safeText(v) {
    if (v === null || v === undefined) return '';
    return String(v);
}

function isPublicId(value) {
    const v = safeText(value).trim().toLowerCase();
    return /^[a-f0-9]{32}$/.test(v);
}

function sanitizeDraftPayload(body) {
    const src = body && typeof body === 'object' ? body : {};

    const bio = Object.prototype.hasOwnProperty.call(src, 'bio') ? safeText(src.bio) : undefined;
    const heroCoverPath = Object.prototype.hasOwnProperty.call(src, 'heroCoverPath') ? safeText(src.heroCoverPath) : undefined;
    const avatarCoverPath = Object.prototype.hasOwnProperty.call(src, 'avatarCoverPath') ? safeText(src.avatarCoverPath) : undefined;
    const bannerCoverPath = Object.prototype.hasOwnProperty.call(src, 'bannerCoverPath') ? safeText(src.bannerCoverPath) : undefined;

    const payload = {};

    if (bio !== undefined) {
        const trimmed = bio.trim();
        if (trimmed.length > 2000) {
            const e = new Error('BIO_TOO_LONG');
            e.status = 400;
            throw e;
        }
        payload.bio = trimmed;
    }

    for (const [key, raw] of [
        ['heroCoverPath', heroCoverPath],
        ['avatarCoverPath', avatarCoverPath],
        ['bannerCoverPath', bannerCoverPath],
    ]) {
        if (raw === undefined) continue;
        const v = raw.trim().replace(/^\/+/, '');
        if (v.length > 512) {
            const e = new Error('COVER_PATH_TOO_LONG');
            e.status = 400;
            throw e;
        }
        if (!SAFE_COVER_PATH_RE.test(v) || v.includes('\0') || v.includes('..') || v.includes('\\') || v.includes('//') || v.endsWith('/')) {
            const e = new Error('INVALID_COVER_PATH');
            e.status = 400;
            throw e;
        }
        payload[key] = v;
    }

    return payload;
}

function tokenKey(token) {
    return `mp:artist_preview:token:${token}`;
}

function draftKey(token) {
    return `mp:artist_preview:draft:${token}`;
}

function generateToken() {
    return crypto.randomBytes(24).toString('base64url');
}

async function createPreviewToken({ userId, artistPublicId }) {
    if (!Number.isSafeInteger(userId) || userId <= 0) {
        const e = new Error('INVALID_USER');
        e.status = 400;
        throw e;
    }
    if (!isPublicId(artistPublicId)) {
        const e = new Error('INVALID_ARTIST_PUBLIC_ID');
        e.status = 400;
        throw e;
    }

    const redis = await getRedisClient();
    if (!redis) {
        const e = new Error('REDIS_UNAVAILABLE');
        e.status = 503;
        throw e;
    }

    const token = generateToken();
    const createdAt = nowIso();

    const data = {
        userId,
        artistPublicId: String(artistPublicId).toLowerCase(),
        createdAt,
    };

    await redis.set(tokenKey(token), JSON.stringify(data), { EX: TOKEN_TTL_SECONDS });

    return { token, expiresInSeconds: TOKEN_TTL_SECONDS };
}

async function validatePreviewToken({ token, artistPublicId }) {
    const t = safeText(token).trim();
    const pid = safeText(artistPublicId).trim().toLowerCase();
    if (!t || !/^[A-Za-z0-9_-]{20,128}$/.test(t)) return null;
    if (!isPublicId(pid)) return null;

    const redis = await getRedisClient();
    if (!redis) return null;

    const raw = await redis.get(tokenKey(t));
    if (!raw) return null;

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }

    const storedPid = parsed && typeof parsed === 'object' ? safeText(parsed.artistPublicId).toLowerCase() : '';
    const userId = parsed && typeof parsed === 'object' ? Number(parsed.userId) : null;
    if (!storedPid || storedPid !== pid) return null;
    if (!Number.isSafeInteger(userId) || userId <= 0) return null;

    return { token: t, artistPublicId: storedPid, userId };
}

async function putDraft({ token, userId, artistPublicId, draft }) {
    const validated = await validatePreviewToken({ token, artistPublicId });
    if (!validated) {
        const e = new Error('INVALID_TOKEN');
        e.status = 403;
        throw e;
    }
    if (validated.userId !== userId) {
        const e = new Error('FORBIDDEN');
        e.status = 403;
        throw e;
    }

    const payload = sanitizeDraftPayload(draft);
    const redis = await getRedisClient();
    if (!redis) {
        const e = new Error('REDIS_UNAVAILABLE');
        e.status = 503;
        throw e;
    }

    const data = {
        ...payload,
        updatedAt: nowIso(),
    };

    await redis.set(draftKey(validated.token), JSON.stringify(data), { EX: DRAFT_TTL_SECONDS });

    return { ok: true };
}

async function getDraft({ token, artistPublicId }) {
    const validated = await validatePreviewToken({ token, artistPublicId });
    if (!validated) return null;

    const redis = await getRedisClient();
    if (!redis) return null;

    const raw = await redis.get(draftKey(validated.token));
    if (!raw) return {};

    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

module.exports = {
    createPreviewToken,
    validatePreviewToken,
    putDraft,
    getDraft,
    TOKEN_TTL_SECONDS,
};
