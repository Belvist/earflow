'use strict';

const { query } = require('./pool');

const ARTIST_SPLIT_REGEX = String.raw`\s*(?:;|,|&|\mfeat\.?\M|\mft\.?\M)\s*`;

function buildArtistMatchSql(columnSql, paramSql) {
    return `EXISTS (
    SELECT 1
      FROM regexp_split_to_table(COALESCE(${columnSql}, ''), '${ARTIST_SPLIT_REGEX}') AS part
     WHERE lower(btrim(part)) = lower(${paramSql})
  )`;
}

function normalizeAlbumName(value) {
    const raw = value === undefined || value === null ? '' : String(value);
    return raw.normalize('NFC').trim().slice(0, 255);
}

function normalizeAlbumKey(value) {
    const name = normalizeAlbumName(value);
    if (!name) return '';
    return name.replace(/\s+/g, ' ').toLowerCase();
}

function normalizePublicId(value) {
    const raw = value === undefined || value === null ? '' : String(value);
    const v = raw.trim().toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(v)) return '';
    return v;
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

async function listAlbumsForSitemap({ limit, offset } = {}) {
    const lim = parseLimit(limit, 5000, 50000);
    const off = parseOffset(offset);

    const result = await query(
        `SELECT a.public_id AS album_public_id,
                a.name AS album_name,
                a.updated_at AS album_updated_at,
                ar.public_id AS artist_public_id,
                ar.name AS artist_name
           FROM albums a
           JOIN artists ar ON ar.id = a.artist_id
          WHERE a.public_id IS NOT NULL
          ORDER BY a.updated_at DESC NULLS LAST, a.id DESC
          LIMIT $1 OFFSET $2`,
        [lim, off]
    );

    return (result.rows || []).map((r) => ({
        albumPublicId: r.album_public_id ? String(r.album_public_id) : null,
        albumName: r.album_name ? String(r.album_name) : '',
        updatedAt: r.album_updated_at ? new Date(r.album_updated_at).toISOString() : null,
        artistPublicId: r.artist_public_id ? String(r.artist_public_id) : null,
        artistName: r.artist_name ? String(r.artist_name) : '',
    })).filter((r) => r.albumPublicId);
}

async function ensureAlbum({ artistId, name }) {
    const aid = parseInt(String(artistId || ''), 10);
    if (!Number.isFinite(aid) || aid <= 0) return null;

    const albumName = normalizeAlbumName(name);
    const key = normalizeAlbumKey(albumName);
    if (!key) return null;

    const result = await query(
        `INSERT INTO albums (artist_id, name, name_key)
         VALUES ($1, $2, $3)
         ON CONFLICT (artist_id, name_key) DO UPDATE SET name = EXCLUDED.name
         RETURNING id, public_id, artist_id, name, name_key, created_at, updated_at`,
        [aid, albumName, key]
    );

    return result.rows && result.rows.length > 0 ? result.rows[0] : null;
}

async function getAlbumByPublicId(publicId) {
    const pid = normalizePublicId(publicId);
    if (!pid) return null;

    const result = await query(
        `SELECT id, public_id, artist_id, name, name_key, created_at, updated_at
           FROM albums
          WHERE public_id = $1
          LIMIT 1`,
        [pid]
    );

    return result.rows && result.rows.length > 0 ? result.rows[0] : null;
}

async function getAlbumArtistCard(album) {
    const row = album && typeof album === 'object' ? album : null;
    if (!row) return null;

    const result = await query(
        `SELECT id, public_id, name, name_key, is_verified, hero_cover_path, bio
           FROM artists
          WHERE id = $1
          LIMIT 1`,
        [row.artist_id]
    );

    return result.rows && result.rows.length > 0 ? result.rows[0] : null;
}

async function listAlbumTracks({ artistName, albumName }, params = {}) {
    const aName = (artistName ?? '').toString().normalize('NFC').trim();
    const alb = normalizeAlbumName(albumName);
    if (!aName || !alb) return [];

    const limit = parseLimit(params.limit, 200, 500);
    const offset = parseOffset(params.offset);

    const result = await query(
        `SELECT s.id, s.title, s.artist, s.album, s.duration, s.genre, s.year, s.cover_path, s.has_ebap, s.play_count, s.popularity, s.created_at, s.updated_at
           FROM songs s
          WHERE ${buildArtistMatchSql('s.artist', '$1')}
            AND lower(btrim(COALESCE(s.album, ''))) = lower($2)
          ORDER BY s.created_at ASC, s.id ASC
          LIMIT $3 OFFSET $4`,
        [aName, alb, limit, offset]
    );

    return result.rows || [];
}

async function getAlbumStats({ artistName, albumName }) {
    const aName = (artistName ?? '').toString().normalize('NFC').trim();
    const alb = normalizeAlbumName(albumName);
    if (!aName || !alb) {
        return { trackCount: 0, totalPlays: null, heroCoverPath: null, year: null };
    }

    const result = await query(
        `SELECT
            COUNT(*)::int AS track_count,
            COALESCE(SUM(s.play_count), 0)::bigint AS total_plays,
            MAX(s.year)::int AS year,
            (
              SELECT s2.cover_path
                FROM songs s2
               WHERE ${buildArtistMatchSql('s2.artist', '$1')}
                 AND lower(btrim(COALESCE(s2.album, ''))) = lower($2)
                 AND s2.cover_path IS NOT NULL
                 AND btrim(s2.cover_path) <> ''
               ORDER BY s2.play_count DESC NULLS LAST, s2.popularity DESC NULLS LAST, s2.created_at DESC
               LIMIT 1
            ) AS hero_cover_path
          FROM songs s
         WHERE ${buildArtistMatchSql('s.artist', '$1')}
           AND lower(btrim(COALESCE(s.album, ''))) = lower($2)`,
        [aName, alb]
    );

    const row = result.rows && result.rows.length > 0 ? result.rows[0] : null;
    if (!row) {
        return { trackCount: 0, totalPlays: null, heroCoverPath: null, year: null };
    }

    const plays = row.total_plays === null || row.total_plays === undefined ? null : Number(row.total_plays) || 0;
    const year = row.year === null || row.year === undefined ? null : Number(row.year) || null;

    return {
        trackCount: Number(row.track_count) || 0,
        totalPlays: plays,
        heroCoverPath: row.hero_cover_path ? String(row.hero_cover_path) : null,
        year,
    };
}

module.exports = {
    normalizeAlbumName,
    normalizeAlbumKey,
    normalizePublicId,
    ensureAlbum,
    getAlbumByPublicId,
    getAlbumArtistCard,
    listAlbumTracks,
    listAlbumsForSitemap,
    getAlbumStats,
};
