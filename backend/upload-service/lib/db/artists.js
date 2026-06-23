const { query } = require('./pool');
const { getSchemaCapabilities } = require('./schemaCapabilities');

const LIBRARY_USER_ID = (() => {
    const n = Number.parseInt(String(process.env.LIBRARY_USER_ID || '1'), 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
})();

function normalizeArtistQuery(value) {
    const raw = value === undefined || value === null ? '' : String(value);
    return raw.normalize('NFC').trim().slice(0, 120);
}

function parseLimit(value, fallback, max) {
    const n = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(n, max);
}

function parseOffset(value) {
    const n = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n) || n < 0) return 0;
    return n;
}

function parsePositiveInt(value) {
    const n = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

async function listArtists(params = {}) {
    const q = normalizeArtistQuery(params.q);
    const limit = parseLimit(params.limit, 50, 100);
    const offset = parseOffset(params.offset);

    const like = q ? `%${q}%` : null;

    const result = await query(
        `SELECT artist AS name, COUNT(*)::int AS track_count
       FROM songs
      WHERE uploader_id = $2
        AND artist IS NOT NULL
        AND btrim(artist) <> ''
        AND ($1::text IS NULL OR artist ILIKE $1)
      GROUP BY artist
      ORDER BY track_count DESC, name ASC
      LIMIT $3 OFFSET $4`,
        [like, LIBRARY_USER_ID, limit, offset]
    );

    return (result.rows || []).map((r) => ({
        name: r.name,
        trackCount: Number.isFinite(r.track_count) ? r.track_count : Number.parseInt(String(r.track_count || '0'), 10) || 0,
    }));
}

async function listArtistTracks(artist, params = {}) {
    const name = normalizeArtistQuery(artist);
    if (!name) return [];

    const limit = parseLimit(params.limit, 100, 200);
    const offset = parseOffset(params.offset);

    const ownerUserId = parsePositiveInt(params.ownerUserId);

    const {
        hasUserId,
        hasUploaderId,
        hasIsAvailable,
        hasEbapStatus,
        hasEbapReadyFlag,
        hasHlsStatus,
        hasHlsReadyFlag,
        hasPlayCount,
        hasPlaylistTracks,
    } = await getSchemaCapabilities();
    const availabilityField = hasIsAvailable ? 'is_available' : 'true as is_available';
    const ebapStatusField = hasEbapStatus ? 'ebap_status' : `'none'::varchar as ebap_status`;
    const ebapReadyField = hasEbapReadyFlag ? 'has_ebap' : 'false as has_ebap';
    const hlsStatusField = hasHlsStatus ? 'hls_status' : `'none'::varchar as hls_status`;
    const hlsReadyField = hasHlsReadyFlag ? 'has_hls' : 'false as has_hls';

    const playsField = hasPlayCount ? 'play_count' : '0::int as play_count';
    const playlistAddsField = hasPlaylistTracks
        ? '(SELECT COUNT(*)::int FROM playlist_tracks pt WHERE pt.song_id = songs.id) AS playlist_adds'
        : '0::int as playlist_adds';

    const resolveOwnerWhere = () => {
        if (!ownerUserId) return { where: '', params: [name, limit, offset] };
        if (hasUserId) return { where: ' AND songs.user_id = $4', params: [name, limit, offset, ownerUserId] };
        if (hasUploaderId) return { where: ' AND songs.uploader_id = $4', params: [name, limit, offset, ownerUserId] };
        return { where: '', params: [name, limit, offset] };
    };

    const { where: ownerWhere, params: queryParams } = resolveOwnerWhere();

    const result = await query(
        `SELECT id, title, artist, album, duration, genre, year, cover_path, ${playsField}, ${playlistAddsField},
                ${availabilityField}, ${ebapReadyField}, ${ebapStatusField}, ${hlsReadyField}, ${hlsStatusField},
                created_at, updated_at
       FROM songs
      WHERE lower(artist) = lower($1)${ownerWhere}
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
        queryParams
    );

    return result.rows || [];
}

module.exports = {
    listArtists,
    listArtistTracks,
};
