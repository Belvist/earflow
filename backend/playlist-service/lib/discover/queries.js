const { getSongsSchemaCapabilities } = require('./schema');
const { getAllowedUploaderIds } = require('./access');

function buildAvailabilityClause(cap) {
  return cap.hasIsAvailable ? ' AND s.is_available = true' : '';
}

function buildAllowedUploadersWhere(userId, cap) {
  const ids = getAllowedUploaderIds(userId);
  const clause = `s.uploader_id = ANY($1::int[])${buildAvailabilityClause(cap)}`;
  return { ids, clause };
}

function selectSongFields() {
  return `s.id,
    s.uploader_id as user_id,
    s.title,
    s.artist,
    s.album,
    s.duration,
    s.genre,
    s.year,
    s.file_path,
    s.file_size,
    s.mime_type,
    s.cover_path,
    s.created_at,
    s.updated_at`;
}

function normalizeMood(mood) {
  const m = (mood || '').toString().trim().toLowerCase();
  if (!m) return null;
  if (m === 'workout') return 'workout';
  if (m === 'chill') return 'chill';
  if (m === 'focus') return 'focus';
  if (m === 'party') return 'party';
  if (m === 'happy') return 'happy';
  if (m === 'sad') return 'sad';
  if (m === 'sleep') return 'sleep';
  return null;
}

function getMoodScoreColumn(mood) {
  switch (mood) {
    case 'workout':
      return 'score_workout';
    case 'focus':
      return 'score_focus';
    case 'chill':
      return 'score_chill';
    case 'party':
      return 'score_party';
    case 'happy':
      return 'score_happy';
    case 'sad':
      return 'score_sad';
    case 'sleep':
      return 'score_sleep';
    default:
      return null;
  }
}

function getTempoNormSql() {
  return 'LEAST(1, GREATEST(0, (f.tempo - 60) / 140))';
}

function buildMoodSpec(mood) {
  const tempo = getTempoNormSql();
  const base = {
    requiredSql: `f.energy IS NOT NULL AND f.valence IS NOT NULL AND f.danceability IS NOT NULL AND f.speechiness IS NOT NULL AND f.tempo IS NOT NULL`,
  };

  switch (mood) {
    case 'workout':
      return {
        ...base,
        scoreSql: `-(1.6*power(f.energy - 0.86, 2) + 1.1*power(${tempo} - 0.78, 2) + 1.0*power(f.danceability - 0.62, 2) + 0.6*power(f.valence - 0.55, 2) + 0.3*power(f.speechiness - 0.15, 2))`,
      };
    case 'party':
      return {
        ...base,
        scoreSql: `-(1.4*power(f.danceability - 0.78, 2) + 1.2*power(f.energy - 0.82, 2) + 0.9*power(${tempo} - 0.72, 2) + 0.8*power(f.valence - 0.7, 2) + 0.4*power(f.speechiness - 0.2, 2))`,
      };
    case 'focus':
      return {
        ...base,
        scoreSql: `-(1.6*power(f.speechiness - 0.08, 2) + 1.1*power(f.energy - 0.55, 2) + 0.9*power(${tempo} - 0.45, 2) + 0.6*power(f.danceability - 0.45, 2) + 0.4*power(f.valence - 0.5, 2))`,
      };
    case 'chill':
      return {
        ...base,
        scoreSql: `-(1.5*power(f.energy - 0.35, 2) + 1.1*power(${tempo} - 0.35, 2) + 0.9*power(f.valence - 0.55, 2) + 0.6*power(f.danceability - 0.5, 2) + 0.4*power(f.speechiness - 0.12, 2))`,
      };
    case 'happy':
      return {
        ...base,
        scoreSql: `-(1.6*power(f.valence - 0.86, 2) + 1.2*power(f.energy - 0.7, 2) + 0.9*power(f.danceability - 0.62, 2) + 0.7*power(${tempo} - 0.62, 2) + 0.4*power(f.speechiness - 0.18, 2))`,
      };
    case 'sad':
      return {
        ...base,
        scoreSql: `-(1.7*power(f.valence - 0.18, 2) + 1.1*power(f.energy - 0.35, 2) + 0.7*power(${tempo} - 0.38, 2) + 0.6*power(f.danceability - 0.4, 2) + 0.4*power(f.speechiness - 0.16, 2))`,
      };
    case 'sleep':
      return {
        ...base,
        scoreSql: `-(1.8*power(f.energy - 0.2, 2) + 1.3*power(${tempo} - 0.22, 2) + 0.9*power(f.speechiness - 0.06, 2) + 0.6*power(f.valence - 0.4, 2) + 0.5*power(f.danceability - 0.25, 2))`,
      };
    default:
      return null;
  }
}

async function fetchPopularSongs(pool, { userId, limit, seed }) {
  const cap = await getSongsSchemaCapabilities(pool);
  const { ids, clause } = buildAllowedUploadersWhere(userId, cap);

  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 20, 1), 200);
  const candidateLimit = Math.min(200, Math.max(safeLimit * 5, safeLimit));
  const params = [ids, safeLimit, candidateLimit];

  const seedStr = (seed || '').toString();
  if (!cap.hasListens || !cap.listensHasListenedAt) {
    const seededOrder = seedStr
      ? (() => {
        params.push(seedStr);
        return `md5(s.id::text || $${params.length})`;
      })()
      : 'md5(s.id::text)';

    const sql = `
      WITH candidates AS (
        SELECT ${selectSongFields()}
          FROM songs s
         WHERE ${clause}
         ORDER BY s.id DESC
         LIMIT $3
      )
      SELECT *
        FROM candidates s
       ORDER BY ${seededOrder}
       LIMIT $2
    `;

    const result = await pool.query(sql, params);
    return result.rows || [];
  }

  const seededOrder = seedStr
    ? (() => {
      params.push(seedStr);
      return `md5(s.id::text || $${params.length})`;
    })()
    : 'md5(s.id::text)';

  const sql = `
    WITH plays AS (
      SELECT song_id, COUNT(*)::int AS plays_30d
        FROM listens
       WHERE listened_at > NOW() - INTERVAL '30 days'
       GROUP BY song_id
    ), ranked AS (
      SELECT ${selectSongFields()}, COALESCE(p.plays_30d, 0) AS plays_30d
        FROM songs s
        LEFT JOIN plays p ON p.song_id = s.id
       WHERE ${clause}
       ORDER BY plays_30d DESC, s.id DESC
       LIMIT $3
    )
    SELECT *
      FROM ranked s
     ORDER BY ${seededOrder}
     LIMIT $2
  `;

  const result = await pool.query(sql, params);
  return result.rows || [];
}

async function fetchMoodSongs(pool, { userId, mood, limit, seed }) {
  const cap = await getSongsSchemaCapabilities(pool);
  const normalized = normalizeMood(mood);
  if (!normalized) return [];

  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 30, 1), 100);
  const seedStr = (seed || '').toString();

  if (cap.hasSongMoodScores) {
    const scoreCol = getMoodScoreColumn(normalized);
    if (!scoreCol) return [];

    const { ids, clause } = buildAllowedUploadersWhere(userId, cap);
    const params = [ids, safeLimit];
    const userParamIdx = userId ? (params.push(String(userId)), params.length) : null;

    const dislikesJoin = (userParamIdx && cap.hasDislikes)
      ? `LEFT JOIN dislikes ud ON ud.song_id = s.id AND ud.user_id = $${userParamIdx}`
      : '';
    const dislikesWhere = (userParamIdx && cap.hasDislikes) ? ' AND ud.song_id IS NULL' : '';

    const hasRecent = Boolean(userParamIdx && cap.hasListens && cap.listensHasListenedAt);
    const cte = hasRecent
      ? `WITH recent_listens AS (
        SELECT song_id, MAX(listened_at) AS last_listen
          FROM listens
         WHERE user_id = $${userParamIdx}
           AND listened_at > NOW() - INTERVAL '60 days'
         GROUP BY song_id
      )`
      : '';

    const recentJoin = hasRecent ? 'LEFT JOIN recent_listens rl ON rl.song_id = s.id' : '';
    const recencyPenaltySql = hasRecent
      ? `(CASE
          WHEN rl.last_listen > NOW() - INTERVAL '6 hours' THEN 0.35
          WHEN rl.last_listen > NOW() - INTERVAL '24 hours' THEN 0.2
          WHEN rl.last_listen > NOW() - INTERVAL '3 days' THEN 0.1
          ELSE 0
        END)`
      : '0';

    const finalScoreSql = `(COALESCE(m.${scoreCol}, -1e9) - ${recencyPenaltySql})`;

    let orderBy = `${finalScoreSql} DESC, s.id DESC`;
    if (seedStr) {
      params.push(seedStr);
      orderBy = `${finalScoreSql} DESC, md5(s.id::text || $${params.length}), s.id DESC`;
    }

    const sql = `
      ${cte}
      SELECT ${selectSongFields()},
             ${finalScoreSql} AS mood_score
        FROM songs s
        JOIN song_mood_scores m ON m.song_id = s.id
        ${dislikesJoin}
        ${recentJoin}
       WHERE ${clause}
         ${dislikesWhere}
       ORDER BY ${orderBy}
       LIMIT $2
    `;

    const result = await pool.query(sql, params);
    return result.rows || [];
  }

  if (!cap.hasSongFeatures) return [];

  const required = ['tempo', 'energy', 'valence', 'danceability', 'speechiness'];
  for (const col of required) {
    if (!cap.songFeaturesCols || !cap.songFeaturesCols.has(col)) {
      return [];
    }
  }

  const spec = buildMoodSpec(normalized);
  if (!spec) return [];

  const { ids, clause } = buildAllowedUploadersWhere(userId, cap);
  const params = [ids];
  const userParamIdx = userId ? (params.push(String(userId)), params.length) : null;
  const limitParamIdx = (params.push(safeLimit), params.length);
  const dislikesJoin = (userParamIdx && cap.hasDislikes)
    ? `LEFT JOIN dislikes ud ON ud.song_id = s.id AND ud.user_id = $${userParamIdx}`
    : '';
  const dislikesWhere = (userParamIdx && cap.hasDislikes) ? ' AND ud.song_id IS NULL' : '';

  const hasRecent = Boolean(userParamIdx && cap.hasListens && cap.listensHasListenedAt);
  const cte = hasRecent
    ? `WITH recent_listens AS (
      SELECT song_id, MAX(listened_at) AS last_listen
        FROM listens
       WHERE user_id = $${userParamIdx}
         AND listened_at > NOW() - INTERVAL '60 days'
       GROUP BY song_id
    )`
    : '';

  const recentJoin = hasRecent ? 'LEFT JOIN recent_listens rl ON rl.song_id = s.id' : '';
  const recencyPenaltySql = hasRecent
    ? `(CASE
        WHEN rl.last_listen > NOW() - INTERVAL '6 hours' THEN 0.35
        WHEN rl.last_listen > NOW() - INTERVAL '24 hours' THEN 0.2
        WHEN rl.last_listen > NOW() - INTERVAL '3 days' THEN 0.1
        ELSE 0
      END)`
    : '0';

  const finalScoreSql = `(${spec.scoreSql} - ${recencyPenaltySql})`;

  let orderBy = `${finalScoreSql} DESC, s.id DESC`;
  if (seedStr) {
    params.push(seedStr);
    orderBy = `${finalScoreSql} DESC, md5(s.id::text || $${params.length}), s.id DESC`;
  }

  const sql = `
    ${cte}
    SELECT ${selectSongFields()},
           ${finalScoreSql} AS mood_score
      FROM songs s
      JOIN song_features f ON f.song_id = s.id
      ${dislikesJoin}
      ${recentJoin}
     WHERE ${clause}
       AND ${spec.requiredSql}
       ${dislikesWhere}
     ORDER BY ${orderBy}
     LIMIT $${limitParamIdx}
  `;

  const result = await pool.query(sql, params);
  return result.rows || [];
}

async function fetchNewSongs(pool, { userId, limit, seed }) {
  const cap = await getSongsSchemaCapabilities(pool);
  const { ids, clause } = buildAllowedUploadersWhere(userId, cap);

  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 20, 1), 200);
  const candidateLimit = Math.min(200, Math.max(safeLimit * 5, safeLimit));
  const params = [ids, safeLimit, candidateLimit];

  const seedStr = (seed || '').toString();
  const candidateOrder = cap.hasReleaseDate
    ? 's.release_date DESC NULLS LAST, s.created_at DESC, s.id DESC'
    : 's.created_at DESC, s.id DESC';

  const seededOrder = seedStr
    ? (() => {
      params.push(seedStr);
      return `md5(s.id::text || $${params.length})`;
    })()
    : 'md5(s.id::text)';

  const sql = `
    WITH candidates AS (
      SELECT ${selectSongFields()}
        FROM songs s
       WHERE ${clause}
       ORDER BY ${candidateOrder}
       LIMIT $3
    )
    SELECT *
      FROM candidates s
     ORDER BY ${seededOrder}
     LIMIT $2
  `;

  const result = await pool.query(sql, params);
  return result.rows || [];
}

async function fetchTopGenres(pool, { userId, limit }) {
  const cap = await getSongsSchemaCapabilities(pool);
  const { ids, clause } = buildAllowedUploadersWhere(userId, cap);

  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 8, 1), 20);

  if (cap.hasStatisticsCache) {
    const sql = `
      SELECT entity_value AS genre, SUM(track_count)::int AS track_count
        FROM statistics_cache
       WHERE entity_type = 'genre'
         AND uploader_id = ANY($1::int[])
       GROUP BY entity_value
       ORDER BY track_count DESC, genre ASC
       LIMIT $2
    `;

    const result = await pool.query(sql, [ids, safeLimit]);
    const rows = result.rows || [];
    if (rows.length > 0) {
      return rows;
    }
  }

  const genreExpr = cap.hasGenreNorm ? 's.genre_norm' : 'lower(trim(s.genre))';
  const nonEmptyCheck = cap.hasGenreNorm ? 's.genre_norm IS NOT NULL AND length(trim(s.genre_norm)) > 0' : 's.genre IS NOT NULL AND length(trim(s.genre)) > 0';

  const sql = `
    SELECT ${genreExpr} AS genre, COUNT(*)::int AS track_count
      FROM songs s
     WHERE ${clause}
       AND ${nonEmptyCheck}
     GROUP BY ${genreExpr}
     ORDER BY track_count DESC, genre ASC
     LIMIT $2
  `;

  const result = await pool.query(sql, [ids, safeLimit]);
  return result.rows || [];
}

async function fetchSongsByGenre(pool, { userId, genre, limit, seed }) {
  const cap = await getSongsSchemaCapabilities(pool);
  const { ids, clause } = buildAllowedUploadersWhere(userId, cap);

  const g = (genre || '').toString().trim().toLowerCase();
  if (!g) return [];

  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 20, 1), 50);
  const params = [ids, g, safeLimit];

  const seedStr = (seed || '').toString();
  if (!cap.hasListens || !cap.listensHasListenedAt) {
    let orderBy = 's.id DESC';
    if (seedStr) {
      params.push(seedStr);
      orderBy = `md5(s.id::text || $${params.length})`;
    }

    const genreWhere = cap.hasGenreNorm ? 's.genre_norm = $2' : 'lower(trim(s.genre)) = $2';

    const sql = `
    SELECT ${selectSongFields()}
      FROM songs s
     WHERE ${clause}
       AND ${genreWhere}
     ORDER BY ${orderBy}
     LIMIT $3
  `;

    const result = await pool.query(sql, params);
    return result.rows || [];
  }

  let orderBy = 'plays_30d DESC, s.id DESC';
  if (seedStr) {
    params.push(seedStr);
    orderBy = `plays_30d DESC, md5(s.id::text || $${params.length})`;
  }

  const genreWhere = cap.hasGenreNorm ? 's.genre_norm = $2' : 'lower(trim(s.genre)) = $2';

  const sql = `
    WITH plays AS (
      SELECT song_id, COUNT(*)::int AS plays_30d
        FROM listens
       WHERE listened_at > NOW() - INTERVAL '30 days'
       GROUP BY song_id
    )
    SELECT ${selectSongFields()}, COALESCE(p.plays_30d, 0) AS plays_30d
      FROM songs s
      LEFT JOIN plays p ON p.song_id = s.id
     WHERE ${clause}
       AND ${genreWhere}
     ORDER BY ${orderBy}
     LIMIT $3
  `;

  const result = await pool.query(sql, params);
  return result.rows || [];
}

async function fetchTopArtists(pool, { userId, limit }) {
  const cap = await getSongsSchemaCapabilities(pool);
  const { ids, clause } = buildAllowedUploadersWhere(userId, cap);

  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 8, 1), 20);

  if (cap.hasStatisticsCache) {
    const sql = `
      SELECT entity_value AS artist, SUM(track_count)::int AS track_count
        FROM statistics_cache
       WHERE entity_type = 'artist'
         AND uploader_id = ANY($1::int[])
       GROUP BY entity_value
       ORDER BY track_count DESC, artist ASC
       LIMIT $2
    `;

    const result = await pool.query(sql, [ids, safeLimit]);
    const rows = result.rows || [];
    if (rows.length > 0) {
      return rows;
    }
  }

  const artistExpr = cap.hasArtistNorm ? 's.artist_norm' : 'trim(s.artist)';
  const nonEmptyCheck = cap.hasArtistNorm ? 's.artist_norm IS NOT NULL AND length(trim(s.artist_norm)) > 0' : 's.artist IS NOT NULL AND length(trim(s.artist)) > 0';

  const sql = `
    SELECT ${artistExpr} AS artist, COUNT(*)::int AS track_count
      FROM songs s
     WHERE ${clause}
       AND ${nonEmptyCheck}
     GROUP BY ${artistExpr}
     ORDER BY track_count DESC, artist ASC
     LIMIT $2
  `;

  const result = await pool.query(sql, [ids, safeLimit]);
  return result.rows || [];
}

async function fetchSongsByArtist(pool, { userId, artist, limit, seed }) {
  const cap = await getSongsSchemaCapabilities(pool);
  const { ids, clause } = buildAllowedUploadersWhere(userId, cap);

  const a = (artist || '').toString().trim();
  if (!a) return [];

  const key = cap.hasArtistNorm ? a.toLowerCase() : a;

  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 20, 1), 50);
  const params = [ids, key, safeLimit];

  const seedStr = (seed || '').toString();
  if (!cap.hasListens || !cap.listensHasListenedAt) {
    let orderBy = 's.id DESC';
    if (seedStr) {
      params.push(seedStr);
      orderBy = `md5(s.id::text || $${params.length})`;
    }

    const artistWhere = cap.hasArtistNorm ? 's.artist_norm = $2' : 'trim(s.artist) = $2';

    const sql = `
    SELECT ${selectSongFields()}
      FROM songs s
     WHERE ${clause}
       AND ${artistWhere}
     ORDER BY ${orderBy}
     LIMIT $3
  `;

    const result = await pool.query(sql, params);
    return result.rows || [];
  }

  let orderBy = 'plays_30d DESC, s.id DESC';
  if (seedStr) {
    params.push(seedStr);
    orderBy = `plays_30d DESC, md5(s.id::text || $${params.length})`;
  }

  const artistWhere = cap.hasArtistNorm ? 's.artist_norm = $2' : 'trim(s.artist) = $2';

  const sql = `
    WITH plays AS (
      SELECT song_id, COUNT(*)::int AS plays_30d
        FROM listens
       WHERE listened_at > NOW() - INTERVAL '30 days'
       GROUP BY song_id
    )
    SELECT ${selectSongFields()}, COALESCE(p.plays_30d, 0) AS plays_30d
      FROM songs s
      LEFT JOIN plays p ON p.song_id = s.id
     WHERE ${clause}
       AND ${artistWhere}
     ORDER BY ${orderBy}
     LIMIT $3
  `;

  const result = await pool.query(sql, params);
  return result.rows || [];
}

async function fetchTopYears(pool, { userId, limit }) {
  const cap = await getSongsSchemaCapabilities(pool);
  const { ids, clause } = buildAllowedUploadersWhere(userId, cap);

  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 6, 1), 20);

  if (cap.hasStatisticsCache) {
    const sql = `
      SELECT entity_value::int AS year, SUM(track_count)::int AS track_count
        FROM statistics_cache
       WHERE entity_type = 'year'
         AND uploader_id = ANY($1::int[])
       GROUP BY entity_value
       ORDER BY track_count DESC, year DESC
       LIMIT $2
    `;

    const result = await pool.query(sql, [ids, safeLimit]);
    const rows = result.rows || [];
    if (rows.length > 0) {
      return rows;
    }
  }

  const sql = `
    SELECT s.year::int AS year, COUNT(*)::int AS track_count
      FROM songs s
     WHERE ${clause}
       AND s.year IS NOT NULL
       AND s.year > 0
     GROUP BY s.year
     ORDER BY track_count DESC, s.year DESC
     LIMIT $2
  `;

  const result = await pool.query(sql, [ids, safeLimit]);
  return result.rows || [];
}

async function fetchSongsByYear(pool, { userId, year, limit, seed }) {
  const cap = await getSongsSchemaCapabilities(pool);
  const { ids, clause } = buildAllowedUploadersWhere(userId, cap);

  const y = Number.parseInt(String(year), 10);
  if (!Number.isFinite(y) || y <= 0 || y > 3000) return [];

  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 20, 1), 50);
  const params = [ids, y, safeLimit];

  const seedStr = (seed || '').toString();
  if (!cap.hasListens || !cap.listensHasListenedAt) {
    let orderBy = 's.id DESC';
    if (seedStr) {
      params.push(seedStr);
      orderBy = `md5(s.id::text || $${params.length})`;
    }

    const sql = `
    SELECT ${selectSongFields()}
      FROM songs s
     WHERE ${clause}
       AND s.year = $2
     ORDER BY ${orderBy}
     LIMIT $3
  `;

    const result = await pool.query(sql, params);
    return result.rows || [];
  }

  let orderBy = 'plays_30d DESC, s.id DESC';
  if (seedStr) {
    params.push(seedStr);
    orderBy = `plays_30d DESC, md5(s.id::text || $${params.length})`;
  }

  const sql = `
    WITH plays AS (
      SELECT song_id, COUNT(*)::int AS plays_30d
        FROM listens
       WHERE listened_at > NOW() - INTERVAL '30 days'
       GROUP BY song_id
    )
    SELECT ${selectSongFields()}, COALESCE(p.plays_30d, 0) AS plays_30d
      FROM songs s
      LEFT JOIN plays p ON p.song_id = s.id
     WHERE ${clause}
       AND s.year = $2
     ORDER BY ${orderBy}
     LIMIT $3
  `;

  const result = await pool.query(sql, params);
  return result.rows || [];
}

async function fetchForYouSongs(pool, { userId, limit, seed }) {
  if (!userId) {
    return fetchPopularSongs(pool, { userId: null, limit, seed });
  }

  const cap = await getSongsSchemaCapabilities(pool);
  if (cap.hasUserDailyRecommendations) {
    const { ids } = buildAllowedUploadersWhere(userId, cap);
    const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 30, 1), 200);
    const params = [ids, String(userId), safeLimit];

    const seedStr = (seed || '').toString();
    let orderBy = 'r.rank ASC, s.id ASC';
    if (seedStr) {
      params.push(seedStr);
      orderBy = `r.rank ASC, md5(s.id::text || $${params.length}), s.id ASC`;
    }

    const sql = `
      SELECT ${selectSongFields()}, r.rank
        FROM user_daily_recommendations r
        JOIN songs s ON s.id = r.song_id
       WHERE r.user_id = $2
         AND s.uploader_id = ANY($1::int[])
         ${buildAvailabilityClause(cap)}
       ORDER BY ${orderBy}
       LIMIT $3
    `;

    const result = await pool.query(sql, params);
    const rows = result.rows || [];
    if (rows.length > 0) {
      return rows;
    }
  }

  if (!cap.hasListens || !cap.hasLikes || !cap.hasDislikes || !cap.listensHasListenedAt) {
    return fetchPopularSongs(pool, { userId, limit, seed });
  }
  const { ids, clause } = buildAllowedUploadersWhere(userId, cap);

  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 30, 1), 200);
  const seedStr = (seed || '').toString();

  const params = [ids, userId, safeLimit];

  let orderBy = 'relevance_score DESC, random()';
  if (seedStr) {
    params.push(seedStr);
    orderBy = `relevance_score DESC, md5(id::text || $${params.length})`;
  }

  const sql = `
    WITH
      recent_listens AS (
        SELECT DISTINCT song_id, MAX(listened_at) as last_listen
          FROM listens
         WHERE user_id = $2
           AND listened_at > NOW() - INTERVAL '14 days'
         GROUP BY song_id
      ),
      user_likes AS (
        SELECT DISTINCT song_id
          FROM likes
         WHERE user_id = $2
      ),
      user_dislikes AS (
        SELECT DISTINCT song_id
          FROM dislikes
         WHERE user_id = $2
      ),
      top_artists AS (
        SELECT s.artist, COUNT(*)::int as play_count
          FROM listens l
          JOIN songs s ON s.id = l.song_id
         WHERE l.user_id = $2
           AND l.listened_at > NOW() - INTERVAL '60 days'
         GROUP BY s.artist
         ORDER BY play_count DESC
         LIMIT 10
      ),
      top_albums AS (
        SELECT s.album, COUNT(*)::int as play_count
          FROM listens l
          JOIN songs s ON s.id = l.song_id
         WHERE l.user_id = $2
           AND l.listened_at > NOW() - INTERVAL '60 days'
         GROUP BY s.album
         ORDER BY play_count DESC
         LIMIT 10
      ),
      plays_30d AS (
        SELECT song_id, COUNT(*)::int AS plays_30d
          FROM listens
         WHERE listened_at > NOW() - INTERVAL '30 days'
         GROUP BY song_id
      ),
      scored AS (
        SELECT
          ${selectSongFields()},
          COALESCE(p.plays_30d, 0) AS plays_30d,
          (
            (CASE WHEN ul.song_id IS NOT NULL THEN 80 ELSE 0 END) +
            (CASE WHEN ta.artist IS NOT NULL THEN 25 ELSE 0 END) +
            (CASE WHEN tb.album IS NOT NULL THEN 15 ELSE 0 END) +
            (CASE WHEN rl.song_id IS NULL THEN 10 ELSE 0 END) +
            (CASE
              WHEN rl.last_listen > NOW() - INTERVAL '1 hour' THEN -120
              WHEN rl.last_listen > NOW() - INTERVAL '6 hours' THEN -60
              WHEN rl.last_listen > NOW() - INTERVAL '1 day' THEN -25
              ELSE 0
            END) +
            LEAST(COALESCE(p.plays_30d, 0), 80)
          ) AS relevance_score
          FROM songs s
          LEFT JOIN plays_30d p ON p.song_id = s.id
          LEFT JOIN user_likes ul ON ul.song_id = s.id
          LEFT JOIN user_dislikes ud ON ud.song_id = s.id
          LEFT JOIN top_artists ta ON ta.artist = s.artist
          LEFT JOIN top_albums tb ON tb.album = s.album
          LEFT JOIN recent_listens rl ON rl.song_id = s.id
         WHERE ${clause}
           AND ud.song_id IS NULL
      )
      SELECT *
        FROM scored
       ORDER BY ${orderBy}
       LIMIT $3
  `;

  const result = await pool.query(sql, params);
  return result.rows || [];
}

module.exports = {
  fetchPopularSongs,
  fetchNewSongs,
  fetchTopGenres,
  fetchSongsByGenre,
  fetchTopArtists,
  fetchSongsByArtist,
  fetchTopYears,
  fetchSongsByYear,
  fetchForYouSongs,
  fetchMoodSongs,
};
