const { query } = require('./pool');
const { sumArtistMonthlyListens, sumArtistAllTimeListens, countArtistUniqueListenersMonthly, countArtistUniqueListenersAllTime, countArtistLikes, countArtistDislikes, countArtistPlaylistAdds } = require('./artistPlatformMonthlyPlays');

function parsePositiveIntStrict(value) {
  const raw = value === undefined || value === null ? '' : String(value).trim();
  if (!/^\d+$/.test(raw)) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

const LIBRARY_USER_ID = (() => {
  const n = parsePositiveIntStrict(process.env.LIBRARY_USER_ID || '1');
  return n || 1;
})();

function isLibraryOnlyMode() {
  const raw = String(process.env.ARTIST_SERVICE_LIBRARY_ONLY || '').trim().toLowerCase();
  if (!raw) return false;
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function normalizeArtistQuery(value) {
  const raw = value === undefined || value === null ? '' : String(value);
  return raw.normalize('NFC').trim().slice(0, 120);
}

const ARTIST_SPLIT_REGEX = String.raw`\s*(?:;|,|&|\mfeat\.?\M|\mft\.?\M)\s*`;

function buildArtistMatchSql(columnSql, paramSql) {
  const normalize = (sql) => `lower(regexp_replace(btrim(${sql}), '[[:space:]]+', ' ', 'g'))`;
  return `EXISTS (
    SELECT 1
      FROM regexp_split_to_table(COALESCE(${columnSql}, ''), '${ARTIST_SPLIT_REGEX}') AS part
     WHERE ${normalize('part')} = ${normalize(paramSql)}
  )`;
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

let songsCapabilitiesPromise = null;
let songsCapabilitiesExpiresAt = 0;

async function getSongsCapabilities() {
  const now = Date.now();
  if (!songsCapabilitiesPromise || now >= songsCapabilitiesExpiresAt) {
    songsCapabilitiesPromise = (async () => {
      const result = await query(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'songs'`
      );
      const columns = new Set((result.rows || []).map((r) => r.column_name));
      songsCapabilitiesExpiresAt = Date.now() + 5 * 60 * 1000;
      return {
        hasIsAvailable: columns.has('is_available'),
        hasPlayCount: columns.has('play_count'),
        hasPopularity: columns.has('popularity'),
      };
    })().catch(() => {
      songsCapabilitiesPromise = null;
      songsCapabilitiesExpiresAt = 0;
      return {
        hasIsAvailable: false,
        hasPlayCount: false,
        hasPopularity: false,
      };
    });
  }
  return songsCapabilitiesPromise;
}

function parseYear(value) {
  const n = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n < 1900 || n > 2100) return null;
  return n;
}

function normalizeSort(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'popular' || v === 'popularity') return 'popular';
  if (v === 'new' || v === 'recent' || v === 'latest') return 'new';
  return null;
}

async function listArtists(params = {}) {
  const q = normalizeArtistQuery(params.q);
  const limit = parseLimit(params.limit, 50, 100);
  const offset = parseOffset(params.offset);

  const like = q ? `%${q}%` : null;

  const libraryOnly = isLibraryOnlyMode();
  const accessWhere = libraryOnly
    ? `WHERE (
                s.uploader_id = $2
             OR EXISTS (
                  SELECT 1
                    FROM artist_uploaders au
                   WHERE au.user_id = s.uploader_id
                     AND au.is_active = TRUE
                )
          )`
    : '';

  const args = libraryOnly
    ? [like, LIBRARY_USER_ID, limit, offset]
    : [like, limit, offset];

  const sql = libraryOnly
    ? `SELECT t.name, COUNT(*)::int AS track_count
       FROM (
         SELECT btrim(regexp_split_to_table(s.artist, '${ARTIST_SPLIT_REGEX}')) AS name
           FROM songs s
          ${accessWhere}
            AND s.artist IS NOT NULL
            AND btrim(s.artist) <> ''
       ) t
      WHERE t.name <> ''
        AND ($1::text IS NULL OR t.name ILIKE $1)
      GROUP BY t.name
      ORDER BY track_count DESC, name ASC
      LIMIT $3 OFFSET $4`
    : `SELECT t.name, COUNT(*)::int AS track_count
       FROM (
         SELECT btrim(regexp_split_to_table(s.artist, '${ARTIST_SPLIT_REGEX}')) AS name
           FROM songs s
          WHERE s.artist IS NOT NULL
            AND btrim(s.artist) <> ''
       ) t
      WHERE t.name <> ''
        AND ($1::text IS NULL OR t.name ILIKE $1)
      GROUP BY t.name
      ORDER BY track_count DESC, name ASC
      LIMIT $2 OFFSET $3`;

  const result = await query(sql, args);

  return (result.rows || []).map((r) => ({
    name: r.name,
    trackCount: Number.isFinite(r.track_count) ? r.track_count : parseInt(String(r.track_count || '0'), 10) || 0,
    coverPath: r.cover_path ? String(r.cover_path) : null,
  }));
}

async function listPopularArtistsFallback(params = {}) {
  const limit = parseLimit(params.limit, 20, 100);
  const offset = parseOffset(params.offset);

  const libraryOnly = isLibraryOnlyMode();
  const accessWhere = libraryOnly
    ? `WHERE (
                s.uploader_id = $1
             OR EXISTS (
                  SELECT 1
                    FROM artist_uploaders au
                   WHERE au.user_id = s.uploader_id
                     AND au.is_active = TRUE
                )
          )`
    : '';

  const args = libraryOnly ? [LIBRARY_USER_ID, limit, offset] : [limit, offset];

  const sql = libraryOnly
    ? `WITH artist_rows AS (
         SELECT btrim(regexp_split_to_table(s.artist, '${ARTIST_SPLIT_REGEX}')) AS name,
                s.cover_path,
                s.created_at
           FROM songs s
          ${accessWhere}
            AND s.artist IS NOT NULL
            AND btrim(s.artist) <> ''
       ),
       counts AS (
         SELECT name, COUNT(*)::int AS track_count
           FROM artist_rows
          WHERE name <> ''
          GROUP BY name
       ),
       covers AS (
         SELECT DISTINCT ON (name) name, cover_path
           FROM artist_rows
          WHERE name <> ''
            AND cover_path IS NOT NULL
            AND btrim(cover_path) <> ''
          ORDER BY name, created_at DESC
       )
       SELECT c.name, c.track_count, v.cover_path
         FROM counts c
         LEFT JOIN covers v ON v.name = c.name
        ORDER BY c.track_count DESC, c.name ASC
        LIMIT $2 OFFSET $3`
    : `WITH artist_rows AS (
         SELECT btrim(regexp_split_to_table(s.artist, '${ARTIST_SPLIT_REGEX}')) AS name,
                s.cover_path,
                s.created_at
           FROM songs s
          WHERE s.artist IS NOT NULL
            AND btrim(s.artist) <> ''
       ),
       counts AS (
         SELECT name, COUNT(*)::int AS track_count
           FROM artist_rows
          WHERE name <> ''
          GROUP BY name
       ),
       covers AS (
         SELECT DISTINCT ON (name) name, cover_path
           FROM artist_rows
          WHERE name <> ''
            AND cover_path IS NOT NULL
            AND btrim(cover_path) <> ''
          ORDER BY name, created_at DESC
       )
       SELECT c.name, c.track_count, v.cover_path
         FROM counts c
         LEFT JOIN covers v ON v.name = c.name
        ORDER BY c.track_count DESC, c.name ASC
        LIMIT $1 OFFSET $2`;

  const result = await query(sql, args);

  return (result.rows || []).map((r) => ({
    name: r.name,
    trackCount: Number.isFinite(r.track_count) ? r.track_count : parseInt(String(r.track_count || '0'), 10) || 0,
    coverPath: r.cover_path ? String(r.cover_path) : null,
  }));
}

async function listArtistTracks(artist, params = {}) {
  const name = normalizeArtistQuery(artist);
  if (!name) return [];

  const limit = parseLimit(params.limit, 100, 200);
  const offset = parseOffset(params.offset);

  const cap = await getSongsCapabilities();
  const sort = normalizeSort(params.sort) || 'new';
  const year = parseYear(params.year);

  const availabilityWhere = cap.hasIsAvailable ? ' AND s.is_available = TRUE' : '';

  const yearWhere = year ? ' AND s.year = $5' : '';
  const playCountSql = cap.hasPlayCount ? 's.play_count' : '0::int as play_count';
  const popularitySql = cap.hasPopularity ? 's.popularity' : '0::int as popularity';

  const orderBy = (() => {
    if (sort === 'popular') {
      if (cap.hasPopularity && cap.hasPlayCount) return 's.popularity DESC, s.play_count DESC, s.created_at DESC';
      if (cap.hasPopularity) return 's.popularity DESC, s.created_at DESC';
      if (cap.hasPlayCount) return 's.play_count DESC, s.created_at DESC';
    }
    return 's.created_at DESC';
  })();

  const libraryOnly = isLibraryOnlyMode();
  const accessWhere = libraryOnly
    ? `(
            s.uploader_id = $2
         OR EXISTS (
              SELECT 1
                FROM artist_uploaders au
               WHERE au.user_id = s.uploader_id
                 AND au.is_active = TRUE
            )
      ) AND `
    : '';

  const sql = libraryOnly
    ? `SELECT s.id, s.public_id, s.title, s.artist, s.album, s.duration, s.genre, s.year, s.cover_path, s.has_ebap, ${playCountSql}, ${popularitySql}, s.created_at, s.updated_at
       FROM songs s
      WHERE ${accessWhere}${buildArtistMatchSql('s.artist', '$1')}${availabilityWhere}
      ${yearWhere}
      ORDER BY ${orderBy}
      LIMIT $3 OFFSET $4`
    : `SELECT s.id, s.public_id, s.title, s.artist, s.album, s.duration, s.genre, s.year, s.cover_path, s.has_ebap, ${playCountSql}, ${popularitySql}, s.created_at, s.updated_at
       FROM songs s
      WHERE ${buildArtistMatchSql('s.artist', '$1')}${availabilityWhere}
      ${yearWhere}
      ORDER BY ${orderBy}
      LIMIT $2 OFFSET $3`;

  const args = libraryOnly
    ? (year ? [name, LIBRARY_USER_ID, limit, offset, year] : [name, LIBRARY_USER_ID, limit, offset])
    : (year ? [name, limit, offset, year] : [name, limit, offset]);

  const result = await query(sql, args);

  return result.rows || [];
}

async function getArtistMeta(artist) {
  const name = normalizeArtistQuery(artist);
  if (!name) {
    return {
      artist: null,
      trackCount: 0,
      albumCount: 0,
      totalPlays: null,
      heroCoverPath: null,
      topTrack: null,
    };
  }

  const cap = await getSongsCapabilities();
  const availabilityWhere = cap.hasIsAvailable ? ' AND s.is_available = TRUE' : '';
  const topOrderBy = (() => {
    if (cap.hasPopularity && cap.hasPlayCount) return 's2.popularity DESC, s2.play_count DESC, s2.created_at DESC';
    if (cap.hasPopularity) return 's2.popularity DESC, s2.created_at DESC';
    if (cap.hasPlayCount) return 's2.play_count DESC, s2.created_at DESC';
    return 's2.created_at DESC';
  })();

  const libraryOnly = isLibraryOnlyMode();
  const accessWhere = libraryOnly
    ? `(
           s.uploader_id = $2
        OR EXISTS (
             SELECT 1
               FROM artist_uploaders au
              WHERE au.user_id = s.uploader_id
                AND au.is_active = TRUE
           )
     ) AND `
    : '';

  const sql = libraryOnly
    ? `SELECT
        COUNT(*)::int AS track_count,
        COUNT(DISTINCT NULLIF(btrim(s.album), ''))::int AS album_count,
        (
          SELECT s2.cover_path
            FROM songs s2
           WHERE ${accessWhere}${buildArtistMatchSql('s2.artist', '$1')}${availabilityWhere}
             AND s2.cover_path IS NOT NULL
             AND btrim(s2.cover_path) <> ''
           ORDER BY ${topOrderBy}
           LIMIT 1
        ) AS hero_cover_path,
        (
          SELECT s2.id
            FROM songs s2
           WHERE ${accessWhere}${buildArtistMatchSql('s2.artist', '$1')}${availabilityWhere}
           ORDER BY ${topOrderBy}
           LIMIT 1
        ) AS top_track_id,
        (
          SELECT s2.title
            FROM songs s2
           WHERE ${accessWhere}${buildArtistMatchSql('s2.artist', '$1')}${availabilityWhere}
           ORDER BY ${topOrderBy}
           LIMIT 1
        ) AS top_track_title
      FROM songs s
     WHERE ${accessWhere}${buildArtistMatchSql('s.artist', '$1')}${availabilityWhere}`
    : `SELECT
        COUNT(*)::int AS track_count,
        COUNT(DISTINCT NULLIF(btrim(s.album), ''))::int AS album_count,
        (
          SELECT s2.cover_path
            FROM songs s2
           WHERE ${buildArtistMatchSql('s2.artist', '$1')}${availabilityWhere}
             AND s2.cover_path IS NOT NULL
             AND btrim(s2.cover_path) <> ''
           ORDER BY ${topOrderBy}
           LIMIT 1
        ) AS hero_cover_path,
        (
          SELECT s2.id
            FROM songs s2
           WHERE ${buildArtistMatchSql('s2.artist', '$1')}${availabilityWhere}
           ORDER BY ${topOrderBy}
           LIMIT 1
        ) AS top_track_id,
        (
          SELECT s2.title
            FROM songs s2
           WHERE ${buildArtistMatchSql('s2.artist', '$1')}${availabilityWhere}
           ORDER BY ${topOrderBy}
           LIMIT 1
        ) AS top_track_title
      FROM songs s
     WHERE ${buildArtistMatchSql('s.artist', '$1')}${availabilityWhere}`;

  const args = libraryOnly ? [name, LIBRARY_USER_ID] : [name];
  const result = await query(sql, args);

  const row = result.rows && result.rows.length ? result.rows[0] : null;
  if (!row) {
    return {
      artist: name,
      trackCount: 0,
      albumCount: 0,
      totalPlays: null,
      heroCoverPath: null,
      topTrack: null,
    };
  }

  const topTrackId = row.top_track_id ? parseInt(String(row.top_track_id), 10) : null;
  const topTrackTitle = row.top_track_title ? String(row.top_track_title) : null;

  const monthlyPlays = await sumArtistMonthlyListens(name, cap, libraryOnly, buildArtistMatchSql);
  const totalPlaysAllTime = await sumArtistAllTimeListens(name, cap, libraryOnly, buildArtistMatchSql);
  const uniqueListenersMonthly = await countArtistUniqueListenersMonthly(name, cap, libraryOnly, buildArtistMatchSql);
  const uniqueListenersAllTime = await countArtistUniqueListenersAllTime(name, cap, libraryOnly, buildArtistMatchSql);
  const likesCount = await countArtistLikes(name, cap, libraryOnly, buildArtistMatchSql);
  const dislikesCount = await countArtistDislikes(name, cap, libraryOnly, buildArtistMatchSql);
  const playlistAdds = await countArtistPlaylistAdds(name, cap, libraryOnly, buildArtistMatchSql);

  return {
    artist: name,
    trackCount: Number(row.track_count) || 0,
    albumCount: Number(row.album_count) || 0,
    monthlyPlays: monthlyPlays === null || monthlyPlays === undefined ? null : Number(monthlyPlays) || 0,
    totalPlaysAllTime: totalPlaysAllTime === null || totalPlaysAllTime === undefined ? null : Number(totalPlaysAllTime) || 0,
    totalPlays: totalPlaysAllTime === null || totalPlaysAllTime === undefined ? null : Number(totalPlaysAllTime) || 0,
    uniqueListenersMonthly: uniqueListenersMonthly === null || uniqueListenersMonthly === undefined ? null : Number(uniqueListenersMonthly) || 0,
    uniqueListenersAllTime: uniqueListenersAllTime === null || uniqueListenersAllTime === undefined ? null : Number(uniqueListenersAllTime) || 0,
    likesCount,
    dislikesCount,
    playlistAdds,
    heroCoverPath: row.hero_cover_path ? String(row.hero_cover_path) : null,
    topTrack: topTrackId ? { id: topTrackId, title: topTrackTitle } : null,
  };
}

async function getArtistTrackCountAny(artist) {
  const name = normalizeArtistQuery(artist);
  if (!name) return 0;

  const libraryOnly = isLibraryOnlyMode();
  const accessWhere = libraryOnly
    ? `(
           s.uploader_id = $2
        OR EXISTS (
             SELECT 1
               FROM artist_uploaders au
              WHERE au.user_id = s.uploader_id
                AND au.is_active = TRUE
           )
     ) AND `
    : '';

  const sql = libraryOnly
    ? `SELECT COUNT(*)::int AS track_count
         FROM songs s
        WHERE ${accessWhere}${buildArtistMatchSql('s.artist', '$1')}`
    : `SELECT COUNT(*)::int AS track_count
         FROM songs s
        WHERE ${buildArtistMatchSql('s.artist', '$1')}`;

  const args = libraryOnly ? [name, LIBRARY_USER_ID] : [name];
  const result = await query(sql, args);
  const row = result.rows && result.rows.length ? result.rows[0] : null;
  const n = row && row.track_count !== undefined && row.track_count !== null ? Number(row.track_count) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function getArtistByUserId(userId) {
  const uid = parseInt(String(userId || ''), 10);
  if (!Number.isFinite(uid) || uid <= 0) return null;

  const result = await query(
    `SELECT artist_name
       FROM artist_uploaders
      WHERE user_id = $1
        AND is_active = TRUE
      LIMIT 1`,
    [uid]
  );

  const row = result.rows && result.rows.length ? result.rows[0] : null;
  if (!row) return null;

  const name = (row.artist_name || '').toString().normalize('NFC').trim().slice(0, 255);
  return name ? { userId: uid, artistName: name } : null;
}

module.exports = {
  listArtists,
  listPopularArtistsFallback,
  listArtistTracks,
  getArtistMeta,
  getArtistTrackCountAny,
  getArtistByUserId,
};
