'use strict';

const DEFAULT_MIN_NOTE_LENGTH = 20;
const DEFAULT_MIN_TRUSTED_LINKS_FOR_AUTO_APPROVE = 2;
const DEFAULT_MANUAL_REVIEW_MIN_TRACKS = 5;
const DEFAULT_MANUAL_REVIEW_MIN_PLAYS = 10000;

const TRUSTED_EVIDENCE_HOSTS = [
    'spotify.com',
    'open.spotify.com',
    'music.apple.com',
    'youtube.com',
    'youtu.be',
    'soundcloud.com',
    'bandcamp.com',
    'vk.com',
    'instagram.com',
    'tiktok.com',
    'x.com',
    'twitter.com',
    't.me',
    'telegram.me',
    'deezer.com',
    'tidal.com',
    'music.yandex.ru',
];

function parseBool(value, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback;
    const s = String(value).trim().toLowerCase();
    if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true;
    if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false;
    return fallback;
}

function parsePositiveInt(value, fallback) {
    const n = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isSafeInteger(n) || n <= 0) return fallback;
    return n;
}

function buildArtistClaimAutoReviewConfig(env = process.env) {
    return {
        enabled: parseBool(env.ARTIST_CLAIM_AUTO_REVIEW_ENABLED, true),
        autoApproveEnabled: parseBool(env.ARTIST_CLAIM_AUTO_APPROVE_ENABLED, true),
        minNoteLength: parsePositiveInt(env.ARTIST_CLAIM_MIN_NOTE_LENGTH, DEFAULT_MIN_NOTE_LENGTH),
        minTrustedLinksForAutoApprove: parsePositiveInt(
            env.ARTIST_CLAIM_AUTO_APPROVE_MIN_TRUSTED_LINKS,
            DEFAULT_MIN_TRUSTED_LINKS_FOR_AUTO_APPROVE
        ),
        manualReviewMinTracks: parsePositiveInt(env.ARTIST_CLAIM_MANUAL_REVIEW_MIN_TRACKS, DEFAULT_MANUAL_REVIEW_MIN_TRACKS),
        manualReviewMinPlays: parsePositiveInt(env.ARTIST_CLAIM_MANUAL_REVIEW_MIN_PLAYS, DEFAULT_MANUAL_REVIEW_MIN_PLAYS),
    };
}

function normalizeNote(value) {
    if (value === null || value === undefined) return '';
    if (typeof value !== 'string') return '';
    return value.normalize('NFC').trim();
}

function normalizeHost(host) {
    return String(host || '').trim().toLowerCase().replace(/^www\./, '');
}

function isTrustedEvidenceHost(host) {
    const normalized = normalizeHost(host);
    if (!normalized) return false;
    return TRUSTED_EVIDENCE_HOSTS.some((allowed) => normalized === allowed || normalized.endsWith(`.${allowed}`));
}

function extractEvidenceLinks(note) {
    const text = normalizeNote(note);
    const matches = text.match(/https?:\/\/[^\s<>"')]+/gi) || [];
    const links = [];
    for (const raw of matches.slice(0, 20)) {
        try {
            const url = new URL(raw);
            links.push({
                url: raw,
                host: normalizeHost(url.hostname),
                trusted: isTrustedEvidenceHost(url.hostname),
            });
        } catch {
            // Ignore malformed URL-like tokens.
        }
    }
    return links;
}

function getClaimStatus(claim) {
    return String(claim?.status || '').trim().toLowerCase();
}

function toNonNegativeNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 0;
    return n;
}

function getArtistClaimRisk({ artistContext, config }) {
    const ctx = artistContext && typeof artistContext === 'object' ? artistContext : {};
    const cfg = config || buildArtistClaimAutoReviewConfig();
    const trackCount = toNonNegativeNumber(ctx.trackCount ?? ctx.track_count);
    const totalPlays = toNonNegativeNumber(ctx.totalPlays ?? ctx.total_plays);
    const popular = ctx.popular === true || String(ctx.popular || '').toLowerCase() === 'true';

    if (popular) {
        return { level: 'manual', reason: 'AUTO_MANUAL_REVIEW_POPULAR_ARTIST', popular, trackCount, totalPlays };
    }
    if (trackCount >= cfg.manualReviewMinTracks) {
        return { level: 'manual', reason: 'AUTO_MANUAL_REVIEW_ACTIVE_CATALOG_ARTIST', popular, trackCount, totalPlays };
    }
    if (totalPlays >= cfg.manualReviewMinPlays) {
        return { level: 'manual', reason: 'AUTO_MANUAL_REVIEW_HIGH_PLAY_COUNT', popular, trackCount, totalPlays };
    }
    return { level: 'low', reason: 'AUTO_LOW_RISK_UNPOPULAR_ARTIST', popular, trackCount, totalPlays };
}

function evaluateArtistClaimAutoReview({ claim, note, ownerUserId, artistContext, config } = {}) {
    const cfg = config || buildArtistClaimAutoReviewConfig();
    const status = getClaimStatus(claim);

    if (!cfg.enabled) {
        return {
            decision: 'manual_review',
            action: null,
            reason: 'AUTO_REVIEW_DISABLED',
        };
    }

    if (status && status !== 'pending') {
        return {
            decision: 'skip',
            action: null,
            reason: 'CLAIM_NOT_PENDING',
        };
    }

    const ownerId = Number(ownerUserId);
    if (Number.isSafeInteger(ownerId) && ownerId > 0) {
        return {
            decision: 'reject',
            action: 'reject',
            reason: 'AUTO_REJECTED_OWNER_ASSIGNED',
        };
    }

    const normalizedNote = normalizeNote(note);
    const links = extractEvidenceLinks(normalizedNote);
    const trustedLinks = links.filter((link) => link.trusted);
    const risk = getArtistClaimRisk({ artistContext, config: cfg });

    if (risk.level === 'manual') {
        if (normalizedNote.length < cfg.minNoteLength || links.length < 1) {
            return {
                decision: 'needs_changes',
                action: 'needs_changes',
                reason: 'AUTO_NEEDS_CHANGES_EVIDENCE_REQUIRED_FOR_PROTECTED_ARTIST',
                evidence: {
                    links: links.length,
                    trustedLinks: trustedLinks.length,
                },
                risk,
            };
        }

        return {
            decision: 'manual_review',
            action: null,
            reason: risk.reason,
            evidence: {
                links: links.length,
                trustedLinks: trustedLinks.length,
            },
            risk,
        };
    }

    if (cfg.autoApproveEnabled) {
        return {
            decision: 'approve',
            action: 'approve',
            reason: 'AUTO_APPROVED_UNPOPULAR_ARTIST',
            evidence: {
                links: links.length,
                trustedLinks: trustedLinks.length,
            },
            risk,
        };
    }

    return {
        decision: 'manual_review',
        action: null,
        reason: 'AUTO_APPROVE_DISABLED',
        evidence: {
            links: links.length,
            trustedLinks: trustedLinks.length,
        },
        risk,
    };
}

module.exports = {
    buildArtistClaimAutoReviewConfig,
    evaluateArtistClaimAutoReview,
    extractEvidenceLinks,
    getArtistClaimRisk,
};
