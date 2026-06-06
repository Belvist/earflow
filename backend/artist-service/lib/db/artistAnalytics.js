'use strict';

const { query } = require('./pool');

const ARTIST_SPLIT_REGEX = String.raw`\s*(?:;|,|&|\mfeat\.?\M|\mft\.?\M)\s*`;

function buildArtistMatchSql(columnSql, paramSql) {
  const normalize = (sql) => `lower(regexp_replace(btrim(${sql}), '[[:space:]]+', ' ', 'g'))`;
  return `EXISTS (
    SELECT 1
      FROM regexp_split_to_table(COALESCE(${columnSql}, ''), '${ARTIST_SPLIT_REGEX}') AS part
     WHERE ${normalize('part')} = ${normalize(paramSql)}
  )`;
}

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

function buildAccessWhere(alias) {
  return `(
           ${alias}.uploader_id = $2
        OR EXISTS (
             SELECT 1
               FROM artist_uploaders au
              WHERE au.user_id = ${alias}.uploader_id
                AND au.is_active = TRUE
           )
     ) AND `;
}

function safeInt(val, fallback) {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * @param {string} artistName
 * @param {{ days?: number }} options
 */
async function getTopTracks(artistName, options = {}) {
  const name = String(artistName || '').normalize('NFC').trim();
  if (!name) return [];

  const limit = Math.min(Math.max(safeInt(options.limit, 20), 1), 50);
  const libraryOnly = isLibraryOnlyMode();
  const accessWhere = libraryOnly ? buildAccessWhere('s') : '';
  const args = libraryOnly ? [name, LIBRARY_USER_ID, limit] : [name, limit];
  const limitParam = libraryOnly ? '$3' : '$2';

  const sql = `
    SELECT
      s.id,
      s.title,
      s.album,
      s.duration,
      s.cover_path,
      s.play_count,
      s.popularity,
      COALESCE(ui_agg.play_events, 0)::bigint AS stream_count,
      COALESCE(ui_agg.unique_listeners, 0)::bigint AS unique_listeners,
      COALESCE(like_agg.cnt, 0)::int AS likes,
      COALESCE(pl_agg.cnt, 0)::int AS playlist_adds
    FROM songs s
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::bigint AS play_events,
        COUNT(DISTINCT ui.user_id)::bigint AS unique_listeners
      FROM user_interactions ui
      WHERE ui.song_id = s.id
        AND ui.interaction_type = 'play'
    ) ui_agg ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS cnt
      FROM likes lk
      WHERE lk.song_id = s.id
    ) like_agg ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS cnt
      FROM playlist_tracks pt
      WHERE pt.song_id = s.id
    ) pl_agg ON TRUE
    WHERE ${accessWhere}${buildArtistMatchSql('s.artist', '$1')}
      AND s.is_available = TRUE
    ORDER BY ui_agg.play_events DESC, s.popularity DESC, s.play_count DESC
    LIMIT ${limitParam}`;

  const result = await query(sql, args);

  return (result.rows || []).map((r) => ({
    id: r.id,
    title: r.title || '',
    album: r.album || null,
    duration: safeInt(r.duration, 0),
    coverPath: r.cover_path || null,
    streamCount: safeInt(r.stream_count, 0),
    uniqueListeners: safeInt(r.unique_listeners, 0),
    likes: safeInt(r.likes, 0),
    playlistAdds: safeInt(r.playlist_adds, 0),
    playCount: safeInt(r.play_count, 0),
  }));
}

/**
 * @param {string} artistName
 * @param {{ days?: number }} options
 */
async function getDailyStreamTrend(artistName, options = {}) {
  const name = String(artistName || '').normalize('NFC').trim();
  if (!name) return [];

  const days = Math.min(Math.max(safeInt(options.days, 30), 1), 90);
  const libraryOnly = isLibraryOnlyMode();
  const accessWhere = libraryOnly ? buildAccessWhere('s') : '';
  const daysParam = libraryOnly ? '$3' : '$2';
  const args = libraryOnly ? [name, LIBRARY_USER_ID, days] : [name, days];

  const sql = `
    WITH date_series AS (
      SELECT generate_series(
        (CURRENT_DATE - (${daysParam} || ' days')::interval)::date,
        CURRENT_DATE,
        '1 day'::interval
      )::date AS day
    )
    SELECT
      ds.day,
      COALESCE(cnt.plays, 0)::bigint AS plays,
      COALESCE(cnt.unique_users, 0)::bigint AS unique_listeners
    FROM date_series ds
    LEFT JOIN (
      SELECT
        COALESCE(ui.event_time, ui.created_at)::date AS d,
        COUNT(*)::bigint AS plays,
        COUNT(DISTINCT ui.user_id)::bigint AS unique_users
      FROM user_interactions ui
      INNER JOIN songs s ON s.id = ui.song_id
      WHERE ui.interaction_type = 'play'
        AND ${accessWhere}${buildArtistMatchSql('s.artist', '$1')}
        AND s.is_available = TRUE
        AND COALESCE(ui.event_time, ui.created_at) >= (CURRENT_DATE - (${daysParam} || ' days')::interval)
      GROUP BY d
    ) cnt ON cnt.d = ds.day
    ORDER BY ds.day ASC`;

  const result = await query(sql, args);

  return (result.rows || []).map((r) => ({
    date: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day || '').slice(0, 10),
    plays: safeInt(r.plays, 0),
    uniqueListeners: safeInt(r.unique_listeners, 0),
  }));
}

/**
 * @param {string} artistName
 */
async function getListenerEngagement(artistName) {
  const name = String(artistName || '').normalize('NFC').trim();
  if (!name) return { avgDurationMs: 0, avgProgress: 0, completionRate: 0, skipRate: 0 };

  const libraryOnly = isLibraryOnlyMode();
  const accessWhere = libraryOnly ? buildAccessWhere('s') : '';
  const args = libraryOnly ? [name, LIBRARY_USER_ID] : [name];

  const sql = `
    SELECT
      COALESCE(AVG(ui.duration_ms) FILTER (WHERE ui.duration_ms > 0), 0)::bigint AS avg_duration_ms,
      COALESCE(AVG(ui.progress) FILTER (WHERE ui.progress IS NOT NULL AND ui.progress > 0), 0)::numeric(5,2) AS avg_progress,
      COALESCE(
        COUNT(*) FILTER (WHERE ui.interaction_type = 'complete')::numeric /
        NULLIF(COUNT(*) FILTER (WHERE ui.interaction_type IN ('play', 'complete')), 0),
        0
      )::numeric(5,4) AS completion_rate,
      COALESCE(
        COUNT(*) FILTER (WHERE ui.interaction_type = 'skip')::numeric /
        NULLIF(COUNT(*) FILTER (WHERE ui.interaction_type IN ('play', 'skip', 'complete')), 0),
        0
      )::numeric(5,4) AS skip_rate
    FROM user_interactions ui
    INNER JOIN songs s ON s.id = ui.song_id
    WHERE ${accessWhere}${buildArtistMatchSql('s.artist', '$1')}
      AND s.is_available = TRUE
      AND ui.interaction_type IN ('play', 'skip', 'complete')`;

  const result = await query(sql, args);
  const row = result.rows && result.rows[0];

  return {
    avgDurationMs: safeInt(row?.avg_duration_ms, 0),
    avgProgress: Number(parseFloat(row?.avg_progress || '0').toFixed(2)),
    completionRate: Number(parseFloat(row?.completion_rate || '0').toFixed(4)),
    skipRate: Number(parseFloat(row?.skip_rate || '0').toFixed(4)),
  };
}

/**
 * @param {string} artistName
 */
async function getSourceBreakdown(artistName) {
  const name = String(artistName || '').normalize('NFC').trim();
  if (!name) return [];

  const libraryOnly = isLibraryOnlyMode();
  const accessWhere = libraryOnly ? buildAccessWhere('s') : '';
  const args = libraryOnly ? [name, LIBRARY_USER_ID] : [name];

  const sql = `
    SELECT
      ui.interaction_type AS type,
      COUNT(*)::bigint AS count
    FROM user_interactions ui
    INNER JOIN songs s ON s.id = ui.song_id
    WHERE ${accessWhere}${buildArtistMatchSql('s.artist', '$1')}
      AND s.is_available = TRUE
    GROUP BY ui.interaction_type
    ORDER BY count DESC`;

  const result = await query(sql, args);

  return (result.rows || []).map((r) => ({
    type: String(r.type || 'unknown'),
    count: safeInt(r.count, 0),
  }));
}

/**
 * @param {string} artistName
 */
async function getFullAnalytics(artistName, options = {}) {
  const [topTracks, dailyTrend, engagement, sourceBreakdown] = await Promise.all([
    getTopTracks(artistName, { limit: options.topTracksLimit || 20 }),
    getDailyStreamTrend(artistName, { days: options.trendDays || 30 }),
    getListenerEngagement(artistName),
    getSourceBreakdown(artistName),
  ]);

  return {
    topTracks,
    dailyTrend,
    engagement,
    sourceBreakdown,
  };
}

module.exports = {
  getTopTracks,
  getDailyStreamTrend,
  getListenerEngagement,
  getSourceBreakdown,
  getFullAnalytics,
};
