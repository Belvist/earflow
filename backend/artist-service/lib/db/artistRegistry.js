'use strict';

const { pool } = require('./pool');

function normalizeArtistName(value) {
    const raw = value === undefined || value === null ? '' : String(value);
    return raw.normalize('NFC').trim().slice(0, 255);
}

function normalizeArtistKey(value) {
    const name = normalizeArtistName(value);
    if (!name) return '';
    return name.replace(/\s+/g, ' ').toLowerCase();
}

function parsePositiveInt(value) {
    const n = parseInt(String(value || ''), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function parseLimit(value, fallback, max) {
    const n = parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(n, max);
}

function parseOffset(value) {
    const n = parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n) || n < 0) return 0;
    return n;
}

async function listArtistsForSitemap({ limit, offset } = {}) {
    const lim = parseLimit(limit, 5000, 50000);
    const off = parseOffset(offset);

    const result = await pool.query(
        `SELECT public_id, name, updated_at
           FROM artists
          WHERE public_id IS NOT NULL
          ORDER BY updated_at DESC NULLS LAST, id DESC
          LIMIT $1 OFFSET $2`,
        [lim, off]
    );

    return (result.rows || []).map((r) => ({
        publicId: r.public_id ? String(r.public_id) : null,
        name: r.name ? String(r.name) : '',
        updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
    })).filter((r) => r.publicId);
}

function normalizePublicId(value) {
    const raw = value === undefined || value === null ? '' : String(value);
    const v = raw.trim().toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(v)) return '';
    return v;
}

function normalizeBio(value) {
    if (value === null) return null;
    if (value === undefined) return undefined;
    if (typeof value !== 'string') return undefined;
    const trimmed = value.normalize('NFC').trim().slice(0, 2000);
    return trimmed.replace(/[<>\r\n]/g, '');
}

function normalizeHeroCoverPath(value) {
    if (value === null) return null;
    if (value === undefined) return undefined;
    if (typeof value !== 'string') return undefined;

    const raw = value.trim();
    if (!raw) return null;
    if (/^https?:\/\//i.test(raw)) return undefined;

    const normalized = raw.replace(/^\/+/, '');
    const withoutPrefix = normalized.startsWith('covers/') ? normalized.slice('covers/'.length) : (normalized.startsWith('covers\\') ? normalized.slice('covers\\'.length) : (normalized.startsWith('covers') ? normalized : normalized));
    const filename = withoutPrefix.includes('/') ? withoutPrefix.split('/').pop() : withoutPrefix;
    if (!filename) return undefined;
    if (!/^[A-Za-z0-9._-]{1,200}$/.test(filename)) return undefined;
    return `covers/${filename}`;
}

function normalizeAvatarCoverPath(value) {
    return normalizeHeroCoverPath(value);
}

function normalizeBannerCoverPath(value) {
    return normalizeHeroCoverPath(value);
}

async function ensureArtistCard(name, createdByUserId = null) {
    const normalizedName = normalizeArtistName(name);
    const key = normalizeArtistKey(normalizedName);
    if (!key) return null;

    const creatorId = parsePositiveInt(createdByUserId);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const insert = await client.query(
            `INSERT INTO artists (name, name_key, created_by_user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (name_key) DO NOTHING
       RETURNING id, public_id, name, name_key, is_verified, popular, hero_cover_path, avatar_cover_path, banner_cover_path, bio`,
            [normalizedName, key, creatorId]
        );

        if (insert.rows && insert.rows.length > 0) {
            await client.query('COMMIT');
            return insert.rows[0];
        }

        const existing = await client.query(
            `SELECT id, public_id, name, name_key, is_verified, popular, hero_cover_path, avatar_cover_path, banner_cover_path, bio
         FROM artists
        WHERE name_key = $1
        LIMIT 1`,
            [key]
        );

        await client.query('COMMIT');
        return existing.rows && existing.rows.length > 0 ? existing.rows[0] : null;
    } catch (err) {
        try {
            await client.query('ROLLBACK');
        } catch {
        }
        throw err;
    } finally {
        client.release();
    }
}

async function getArtistCardByName(name) {
    const key = normalizeArtistKey(name);
    if (!key) return null;

    const result = await pool.query(
        `SELECT id, public_id, name, name_key, is_verified, popular, hero_cover_path, avatar_cover_path, banner_cover_path, bio
       FROM artists
      WHERE name_key = $1
      LIMIT 1`,
        [key]
    );

    return result.rows && result.rows.length > 0 ? result.rows[0] : null;
}

async function listPopularArtistCards({ limit, offset } = {}) {
    const lim = parseLimit(limit, 20, 100);
    const off = parseOffset(offset);

    const result = await pool.query(
        `SELECT id, public_id, name, name_key, is_verified, popular, hero_cover_path, avatar_cover_path, banner_cover_path, bio
           FROM artists
          WHERE popular = TRUE
          ORDER BY updated_at DESC NULLS LAST, id DESC
          LIMIT $1 OFFSET $2`,
        [lim, off]
    );

    return result.rows || [];
}

async function getArtistCardsByNameKeys(nameKeys) {
    const keys = Array.isArray(nameKeys) ? nameKeys.map((k) => String(k || '').trim().toLowerCase()).filter(Boolean) : [];
    if (keys.length === 0) return [];

    const unique = Array.from(new Set(keys)).slice(0, 200);
    const result = await pool.query(
        `SELECT id, public_id, name, name_key, is_verified, popular, hero_cover_path, avatar_cover_path, banner_cover_path, bio
           FROM artists
          WHERE name_key = ANY($1::text[])`,
        [unique]
    );
    return result.rows || [];
}

async function listMyClaims({ userId, status, limit, offset }) {
    const uid = parsePositiveInt(userId);
    if (!uid) return [];

    const s = String(status || '').trim().toLowerCase();
    const normalizedStatus = s === 'approved' || s === 'rejected' || s === 'pending' || s === 'needs_changes' ? s : '';
    const lim = parseLimit(limit, 20, 100);
    const off = parseOffset(offset);

    const result = await pool.query(
        `SELECT
            cr.id,
            cr.status,
            cr.note,
            cr.review_reason,
            cr.reviewed_by_user_id,
            cr.reviewed_at,
            cr.created_at,
            cr.updated_at,
            a.id AS artist_id,
            a.public_id AS artist_public_id,
            a.name AS artist_name
          FROM artist_claim_requests cr
          JOIN artists a ON a.id = cr.artist_id
         WHERE cr.user_id = $1
           AND ($2::text IS NULL OR cr.status = $2)
         ORDER BY cr.created_at DESC
         LIMIT $3 OFFSET $4`,
        [uid, normalizedStatus || null, lim, off]
    );

    return result.rows || [];
}

async function reviewClaimNeedsChangesTx(client, { claimId, reviewerUserId, reviewReason }) {
    const update = await client.query(
        `UPDATE artist_claim_requests
            SET status = 'needs_changes',
                review_reason = $2,
                reviewed_by_user_id = $3,
                reviewed_at = NOW(),
                updated_at = NOW()
          WHERE id = $1
          RETURNING id, artist_id, user_id, status, review_reason, reviewed_by_user_id, reviewed_at, created_at, updated_at`,
        [claimId, reviewReason, reviewerUserId]
    );
    return update.rows && update.rows.length > 0 ? update.rows[0] : null;
}

async function reviewClaimRejectTx(client, { claimId, reviewerUserId, reviewReason }) {
    const update = await client.query(
        `UPDATE artist_claim_requests
            SET status = 'rejected',
                review_reason = $2,
                reviewed_by_user_id = $3,
                reviewed_at = NOW(),
                updated_at = NOW()
          WHERE id = $1
          RETURNING id, artist_id, user_id, status, review_reason, reviewed_by_user_id, reviewed_at, created_at, updated_at`,
        [claimId, reviewReason, reviewerUserId]
    );
    return update.rows && update.rows.length > 0 ? update.rows[0] : null;
}

async function ensureArtistAccountMemberTx(client, { artistId, userId, role = 'owner' }) {
    const aid = parsePositiveInt(artistId);
    const uid = parsePositiveInt(userId);
    const memberRole = String(role || 'owner').trim().slice(0, 32) || 'owner';
    if (!aid || !uid) return null;

    const accountRes = await client.query(
        `INSERT INTO artist_accounts (artist_id, status)
       VALUES ($1, 'active')
       ON CONFLICT (artist_id) DO UPDATE
         SET status = 'active',
             updated_at = NOW()
       RETURNING id`,
        [aid]
    );

    const account = accountRes.rows && accountRes.rows.length > 0 ? accountRes.rows[0] : null;
    const accountId = parsePositiveInt(account?.id);
    if (!accountId) return null;

    const memberRes = await client.query(
        `INSERT INTO artist_account_members (account_id, user_id, role, status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT DO NOTHING
       RETURNING id`,
        [accountId, uid, memberRole]
    );

    return {
        accountId,
        memberId: memberRes.rows && memberRes.rows.length > 0 ? parsePositiveInt(memberRes.rows[0]?.id) : null,
    };
}

async function reviewClaimApproveTx(client, { claim, claimId, reviewerUserId, reviewReason }) {
    const ownerRes = await client.query(
        `SELECT user_id
           FROM artist_ownerships
          WHERE artist_id = $1
            AND status = 'active'
            AND revoked_at IS NULL
          LIMIT 1`,
        [claim.artist_id]
    );
    const existingOwner = ownerRes.rows && ownerRes.rows.length > 0 ? ownerRes.rows[0] : null;
    if (existingOwner && parsePositiveInt(existingOwner.user_id)) {
        return { error: 'ARTIST_ALREADY_HAS_OWNER' };
    }

    await client.query(
        `INSERT INTO artist_ownerships (artist_id, user_id, role, status)
       VALUES ($1, $2, 'owner', 'active')`,
        [claim.artist_id, claim.user_id]
    );

    await ensureArtistAccountMemberTx(client, {
        artistId: claim.artist_id,
        userId: claim.user_id,
        role: 'owner',
    });

    await client.query(
        `INSERT INTO artist_uploaders (user_id, artist_name, is_active, created_at, updated_at)
       SELECT $2, a.name, TRUE, NOW(), NOW()
         FROM artists a
        WHERE a.id = $1
       ON CONFLICT (user_id) DO UPDATE
         SET artist_name = EXCLUDED.artist_name,
             is_active = TRUE,
             updated_at = NOW()`,
        [claim.artist_id, claim.user_id]
    );

    await client.query(
        `UPDATE artists
          SET is_verified = TRUE,
              updated_at = NOW()
        WHERE id = $1`,
        [claim.artist_id]
    );

    await client.query(
        `UPDATE artist_claim_requests
          SET status = 'rejected',
              review_reason = 'AUTO_REJECTED_OWNER_ASSIGNED',
              reviewed_by_user_id = $2,
              reviewed_at = NOW(),
              updated_at = NOW()
        WHERE artist_id = $1
          AND status = 'pending'
          AND id <> $3`,
        [claim.artist_id, reviewerUserId, claimId]
    );

    const update = await client.query(
        `UPDATE artist_claim_requests
          SET status = 'approved',
              review_reason = $2,
              reviewed_by_user_id = $3,
              reviewed_at = NOW(),
              updated_at = NOW()
        WHERE id = $1
        RETURNING id, artist_id, user_id, status, review_reason, reviewed_by_user_id, reviewed_at, created_at, updated_at`,
        [claimId, reviewReason, reviewerUserId]
    );
    return update.rows && update.rows.length > 0 ? update.rows[0] : null;
}

async function updateArtistCardById({ artistId, bio, heroCoverPath, avatarCoverPath, bannerCoverPath }) {
    const id = parsePositiveInt(artistId);
    if (!id) return null;

    const nextBio = normalizeBio(bio);
    const nextHero = normalizeHeroCoverPath(heroCoverPath);
    const nextAvatar = normalizeAvatarCoverPath(avatarCoverPath);
    const nextBanner = normalizeBannerCoverPath(bannerCoverPath);

    const updates = [];
    const values = [];
    let i = 1;

    if (nextBio !== undefined) {
        updates.push(`bio = $${i++}`);
        values.push(nextBio);
    }
    if (nextHero !== undefined) {
        updates.push(`hero_cover_path = $${i++}`);
        values.push(nextHero);
    }
    if (nextAvatar !== undefined) {
        updates.push(`avatar_cover_path = $${i++}`);
        values.push(nextAvatar);
    }
    if (nextBanner !== undefined) {
        updates.push(`banner_cover_path = $${i++}`);
        values.push(nextBanner);
    }

    if (updates.length === 0) return null;

    values.push(id);
    const result = await pool.query(
        `UPDATE artists
            SET ${updates.join(', ')}, updated_at = NOW()
          WHERE id = $${i}
          RETURNING id, public_id, name, name_key, is_verified, popular, hero_cover_path, avatar_cover_path, banner_cover_path, bio`,
        values
    );

    return result.rows && result.rows.length > 0 ? result.rows[0] : null;
}

async function getArtistCardByPublicId(publicId) {
    const pid = normalizePublicId(publicId);
    if (!pid) return null;

    const result = await pool.query(
        `SELECT id, public_id, name, name_key, is_verified, popular, hero_cover_path, avatar_cover_path, banner_cover_path, bio
       FROM artists
      WHERE public_id = $1
      LIMIT 1`,
        [pid]
    );

    return result.rows && result.rows.length > 0 ? result.rows[0] : null;
}

async function getActiveOwnerUserId(artistId) {
    const id = parsePositiveInt(artistId);
    if (!id) return null;

    const result = await pool.query(
        `SELECT user_id
       FROM artist_ownerships
      WHERE artist_id = $1
        AND status = 'active'
        AND revoked_at IS NULL
      LIMIT 1`,
        [id]
    );

    const row = result.rows && result.rows.length > 0 ? result.rows[0] : null;
    return row ? parsePositiveInt(row.user_id) : null;
}

async function getOwnedArtistByUserId(userId) {
    const uid = parsePositiveInt(userId);
    if (!uid) return null;

    const result = await pool.query(
        `SELECT a.id, a.public_id, a.name, a.name_key, a.is_verified, a.hero_cover_path, a.bio
       FROM artist_ownerships o
       JOIN artists a ON a.id = o.artist_id
      WHERE o.user_id = $1
        AND o.status = 'active'
        AND o.revoked_at IS NULL
      ORDER BY o.created_at DESC
      LIMIT 1`,
        [uid]
    );

    return result.rows && result.rows.length > 0 ? result.rows[0] : null;
}

async function upsertClaimRequest({ artistId, userId, note }) {
    const aid = parsePositiveInt(artistId);
    const uid = parsePositiveInt(userId);
    const message = (note ?? '').toString().trim().slice(0, 2000);

    if (!aid || !uid) return null;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const inserted = await client.query(
            `INSERT INTO artist_claim_requests (artist_id, user_id, note)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING id, artist_id, user_id, status, note, review_reason, reviewed_by_user_id, reviewed_at, created_at, updated_at`,
            [aid, uid, message]
        );

        if (inserted.rows && inserted.rows.length > 0) {
            await client.query('COMMIT');
            return inserted.rows[0];
        }

        const updated = await client.query(
            `UPDATE artist_claim_requests
          SET note = $3,
              status = 'pending',
              review_reason = NULL,
              reviewed_by_user_id = NULL,
              reviewed_at = NULL,
              updated_at = NOW()
        WHERE artist_id = $1
          AND user_id = $2
          AND status IN ('pending', 'needs_changes')
        RETURNING id, artist_id, user_id, status, note, review_reason, reviewed_by_user_id, reviewed_at, created_at, updated_at`,
            [aid, uid, message]
        );

        await client.query('COMMIT');
        return updated.rows && updated.rows.length > 0 ? updated.rows[0] : null;
    } catch (err) {
        try {
            await client.query('ROLLBACK');
        } catch {
        }
        throw err;
    } finally {
        client.release();
    }
}

async function getMyClaimForArtist({ artistId, userId }) {
    const aid = parsePositiveInt(artistId);
    const uid = parsePositiveInt(userId);
    if (!aid || !uid) return null;

    const result = await pool.query(
        `SELECT id, artist_id, user_id, status, note, review_reason, reviewed_by_user_id, reviewed_at, created_at, updated_at
       FROM artist_claim_requests
      WHERE artist_id = $1 AND user_id = $2
      ORDER BY created_at DESC
      LIMIT 1`,
        [aid, uid]
    );

    return result.rows && result.rows.length > 0 ? result.rows[0] : null;
}

async function listClaimRequests({ status, limit, offset }) {
    const s = String(status || '').trim().toLowerCase();
    const normalizedStatus = s === 'approved' || s === 'rejected' || s === 'pending' || s === 'needs_changes' ? s : 'pending';
    const lim = parseLimit(limit, 50, 200);
    const off = parseOffset(offset);

    const result = await pool.query(
        `SELECT
        cr.id,
        cr.status,
        cr.note,
        cr.review_reason,
        cr.reviewed_by_user_id,
        cr.reviewed_at,
        cr.created_at,
        cr.updated_at,
        a.id AS artist_id,
        a.public_id AS artist_public_id,
        a.name AS artist_name,
        a.name_key AS artist_key,
        a.is_verified AS artist_is_verified,
        a.popular AS artist_popular,
        u.id AS user_id,
        u.username AS username
      FROM artist_claim_requests cr
      JOIN artists a ON a.id = cr.artist_id
      JOIN users u ON u.id = cr.user_id
     WHERE cr.status = $1
     ORDER BY cr.created_at DESC
     LIMIT $2 OFFSET $3`,
        [normalizedStatus, lim, off]
    );

    return result.rows || [];
}

async function reviewClaimRequestInternal({ claimId, reviewerUserId, action, reason, allowSystemReviewer = false }) {
    const cid = parsePositiveInt(claimId);
    const rid = parsePositiveInt(reviewerUserId);
    const a = String(action || '').trim().toLowerCase();
    const reviewReason = (reason ?? '').toString().trim().slice(0, 1000);

    if (!cid) return { error: 'INVALID_CLAIM_ID' };
    if (!rid && !allowSystemReviewer) return { error: 'INVALID_REVIEWER' };
    if (a !== 'approve' && a !== 'reject' && a !== 'needs_changes') return { error: 'INVALID_REVIEW_ACTION' };

    const reviewerId = rid || null;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const claimRes = await client.query(
            `SELECT id, artist_id, user_id, status
         FROM artist_claim_requests
        WHERE id = $1
        FOR UPDATE`,
            [cid]
        );

        const claim = claimRes.rows && claimRes.rows.length > 0 ? claimRes.rows[0] : null;
        if (!claim) {
            await client.query('ROLLBACK');
            return { error: 'CLAIM_NOT_FOUND' };
        }

        const claimStatus = String(claim.status || '').trim().toLowerCase();
        if (claimStatus === 'approved') {
            await client.query('ROLLBACK');
            return { error: 'CLAIM_ALREADY_APPROVED', status: claimStatus };
        }
        if (claimStatus !== 'pending' && claimStatus !== 'needs_changes' && claimStatus !== 'rejected') {
            await client.query('ROLLBACK');
            return { error: 'CLAIM_NOT_REVIEWABLE', status: claimStatus };
        }
        let result = null;
        if (a === 'needs_changes') {
            result = await reviewClaimNeedsChangesTx(client, { claimId: cid, reviewerUserId: reviewerId, reviewReason });
        } else if (a === 'reject') {
            result = await reviewClaimRejectTx(client, { claimId: cid, reviewerUserId: reviewerId, reviewReason });
        } else {
            result = await reviewClaimApproveTx(client, { claim, claimId: cid, reviewerUserId: reviewerId, reviewReason });
        }

        if (result && result.error) {
            await client.query('ROLLBACK');
            return result;
        }

        await client.query('COMMIT');
        return result;
    } catch (err) {
        try {
            await client.query('ROLLBACK');
        } catch {
        }
        throw err;
    } finally {
        client.release();
    }
}

async function reviewClaimRequest({ claimId, reviewerUserId, action, reason }) {
    return reviewClaimRequestInternal({ claimId, reviewerUserId, action, reason, allowSystemReviewer: false });
}

async function autoReviewClaimRequest({ claimId, action, reason }) {
    const reviewReason = (reason || 'AUTO_REVIEW').toString().trim().slice(0, 1000);
    return reviewClaimRequestInternal({
        claimId,
        reviewerUserId: null,
        action,
        reason: reviewReason,
        allowSystemReviewer: true,
    });
}

module.exports = {
    normalizeArtistName,
    normalizeArtistKey,
    normalizePublicId,
    ensureArtistCard,
    getArtistCardByName,
    getArtistCardByPublicId,
    getArtistCardsByNameKeys,
    listPopularArtistCards,
    getActiveOwnerUserId,
    getOwnedArtistByUserId,
    listArtistsForSitemap,
    updateArtistCardById,
    upsertClaimRequest,
    getMyClaimForArtist,
    listMyClaims,
    listClaimRequests,
    reviewClaimRequest,
    autoReviewClaimRequest,
};
