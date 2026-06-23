/**
 * Прослушивания артиста за текущий календарный месяц по событиям платформы.
 * Не использует songs.play_count — это каталожные накопленные значения.
 *
 * Приоритет источников:
 * 1) user_interactions (interaction_type = 'play', время — COALESCE(event_time, created_at))
 * 2) listens (listened_at) — запасной вариант, если interactions недоступны
 */

const { query } = require('./pool');

const parsePositiveIntStrict = (value) => {
  const raw = value === undefined || value === null ? '' : String(value).trim();
  if (!/^\d+$/.test(raw)) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

const LIBRARY_USER_ID = (() => {
  const n = parsePositiveIntStrict(process.env.LIBRARY_USER_ID || '1');
  return n || 1;
})();

let listensCapabilitiesPromise = null;
let listensCapabilitiesExpiresAt = 0;

let interactionsCapabilitiesPromise = null;
let interactionsCapabilitiesExpiresAt = 0;

async function getListensCapabilities() {
  const now = Date.now();
  if (!listensCapabilitiesPromise || now >= listensCapabilitiesExpiresAt) {
    listensCapabilitiesPromise = (async () => {
      const result = await query(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'listens'`
      );
      const columns = new Set((result.rows || []).map((r) => r.column_name));
      listensCapabilitiesExpiresAt = Date.now() + 5 * 60 * 1000;
      return {
        hasListens: columns.size > 0,
        hasListenedAt: columns.has('listened_at'),
      };
    })().catch(() => {
      listensCapabilitiesPromise = null;
      listensCapabilitiesExpiresAt = 0;
      return { hasListens: false, hasListenedAt: false };
    });
  }
  return listensCapabilitiesPromise;
}

async function getUserInteractionsCapabilities() {
  const now = Date.now();
  if (!interactionsCapabilitiesPromise || now >= interactionsCapabilitiesExpiresAt) {
    interactionsCapabilitiesPromise = (async () => {
      const result = await query(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'user_interactions'`
      );
      const columns = new Set((result.rows || []).map((r) => r.column_name));
      interactionsCapabilitiesExpiresAt = Date.now() + 5 * 60 * 1000;
      return {
        hasTable: columns.size > 0,
        hasSongId: columns.has('song_id'),
        hasUserId: columns.has('user_id'),
        hasInteractionType: columns.has('interaction_type'),
        hasCreatedAt: columns.has('created_at'),
        hasEventTime: columns.has('event_time'),
      };
    }).catch(() => {
      interactionsCapabilitiesPromise = null;
      interactionsCapabilitiesExpiresAt = 0;
      return {
        hasTable: false,
        hasSongId: false,
        hasUserId: false,
        hasInteractionType: false,
        hasCreatedAt: false,
        hasEventTime: false,
      };
    });
  }
  return interactionsCapabilitiesPromise;
}

function buildLibraryAccessWhereSong(alias) {
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

/**
 * @param {string} name
 * @param {{ hasIsAvailable: boolean }} songsCap
 * @param {boolean} libraryOnly
 * @param {(columnSql: string, paramSql: string) => string} buildArtistMatchSql
 * @returns {Promise<number|null>}
 */
async function sumArtistMonthlyListens(name, songsCap, libraryOnly, buildArtistMatchSql) {
  const availabilityWhere = songsCap.hasIsAvailable ? ' AND s.is_available = TRUE' : '';
  const accessWhere = libraryOnly ? buildLibraryAccessWhereSong('s') : '';

  const ui = await getUserInteractionsCapabilities();
  if (
    ui.hasTable
    && ui.hasSongId
    && ui.hasInteractionType
    && (ui.hasCreatedAt || ui.hasEventTime)
  ) {
    const timeExpr = ui.hasEventTime && ui.hasCreatedAt
      ? 'COALESCE(ui.event_time, ui.created_at)'
      : ui.hasEventTime
        ? 'ui.event_time'
        : 'ui.created_at';

    const sql = libraryOnly
      ? `SELECT COUNT(*)::bigint AS n
           FROM user_interactions ui
           INNER JOIN songs s ON s.id = ui.song_id
          WHERE ${timeExpr} >= date_trunc('month', CURRENT_TIMESTAMP)
            AND ui.interaction_type = 'play'
            AND ${accessWhere}${buildArtistMatchSql('s.artist', '$1')}${availabilityWhere}`
      : `SELECT COUNT(*)::bigint AS n
           FROM user_interactions ui
           INNER JOIN songs s ON s.id = ui.song_id
          WHERE ${timeExpr} >= date_trunc('month', CURRENT_TIMESTAMP)
            AND ui.interaction_type = 'play'
            AND ${buildArtistMatchSql('s.artist', '$1')}${availabilityWhere}`;

    const args = libraryOnly ? [name, LIBRARY_USER_ID] : [name];

    try {
      const result = await query(sql, args);
      const row = result.rows && result.rows[0];
      const n = row && row.n !== undefined && row.n !== null ? Number(row.n) : 0;
      return Number.isFinite(n) ? n : 0;
    } catch (err) {
      console.error('[artist-service] sumArtistMonthlyListens (user_interactions) failed:', err && err.message ? err.message : err);
      /* fall through to listens */
    }
  }

  const lc = await getListensCapabilities();
  if (!lc.hasListens || !lc.hasListenedAt) {
    return null;
  }

  const sql = libraryOnly
    ? `SELECT COUNT(*)::bigint AS n
         FROM listens l
         INNER JOIN songs s ON s.id = l.song_id
        WHERE l.listened_at >= date_trunc('month', CURRENT_TIMESTAMP)
          AND ${accessWhere}${buildArtistMatchSql('s.artist', '$1')}${availabilityWhere}`
    : `SELECT COUNT(*)::bigint AS n
         FROM listens l
         INNER JOIN songs s ON s.id = l.song_id
        WHERE l.listened_at >= date_trunc('month', CURRENT_TIMESTAMP)
          AND ${buildArtistMatchSql('s.artist', '$1')}${availabilityWhere}`;

  const args = libraryOnly ? [name, LIBRARY_USER_ID] : [name];

  try {
    const result = await query(sql, args);
    const row = result.rows && result.rows[0];
    const n = row && row.n !== undefined && row.n !== null ? Number(row.n) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch (err) {
    console.error('[artist-service] sumArtistMonthlyListens (listens) failed:', err && err.message ? err.message : err);
    return null;
  }
}

/**
 * @param {string} name
 * @param {{ hasIsAvailable: boolean }} songsCap
 * @param {boolean} libraryOnly
 * @param {(columnSql: string, paramSql: string) => string} buildArtistMatchSql
 * @returns {Promise<number|null>}
 */
async function sumArtistAllTimeListens(name, songsCap, libraryOnly, buildArtistMatchSql) {
  const availabilityWhere = songsCap.hasIsAvailable ? ' AND s.is_available = TRUE' : '';
  const accessWhere = libraryOnly ? buildLibraryAccessWhereSong('s') : '';

  const ui = await getUserInteractionsCapabilities();
  if (
    ui.hasTable
    && ui.hasSongId
    && ui.hasInteractionType
  ) {
    const sql = libraryOnly
      ? `SELECT COUNT(*)::bigint AS n
           FROM user_interactions ui
           INNER JOIN songs s ON s.id = ui.song_id
          WHERE ui.interaction_type = 'play'
            AND ${accessWhere}${buildArtistMatchSql('s.artist', '$1')}${availabilityWhere}`
      : `SELECT COUNT(*)::bigint AS n
           FROM user_interactions ui
           INNER JOIN songs s ON s.id = ui.song_id
          WHERE ui.interaction_type = 'play'
            AND ${buildArtistMatchSql('s.artist', '$1')}${availabilityWhere}`;

    const args = libraryOnly ? [name, LIBRARY_USER_ID] : [name];

    try {
      const result = await query(sql, args);
      const row = result.rows && result.rows[0];
      const n = row && row.n !== undefined && row.n !== null ? Number(row.n) : 0;
      return Number.isFinite(n) ? n : 0;
    } catch (err) {
      console.error('[artist-service] sumArtistAllTimeListens (user_interactions) failed:', err && err.message ? err.message : err);
    }
  }

  const lc = await getListensCapabilities();
  if (!lc.hasListens) {
    return null;
  }

  const sql = libraryOnly
    ? `SELECT COUNT(*)::bigint AS n
         FROM listens l
         INNER JOIN songs s ON s.id = l.song_id
        WHERE ${accessWhere}${buildArtistMatchSql('s.artist', '$1')}${availabilityWhere}`
    : `SELECT COUNT(*)::bigint AS n
         FROM listens l
         INNER JOIN songs s ON s.id = l.song_id
        WHERE ${buildArtistMatchSql('s.artist', '$1')}${availabilityWhere}`;

  const args = libraryOnly ? [name, LIBRARY_USER_ID] : [name];

  try {
    const result = await query(sql, args);
    const row = result.rows && result.rows[0];
    const n = row && row.n !== undefined && row.n !== null ? Number(row.n) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch (err) {
    console.error('[artist-service] sumArtistAllTimeListens (listens) failed:', err && err.message ? err.message : err);
    return null;
  }
}

/**
 * @param {string} name
 * @param {{ hasIsAvailable: boolean }} songsCap
 * @param {boolean} libraryOnly
 * @param {(columnSql: string, paramSql: string) => string} buildArtistMatchSql
 * @returns {Promise<number|null>}
 */
async function countArtistUniqueListenersMonthly(name, songsCap, libraryOnly, buildArtistMatchSql) {
  const availabilityWhere = songsCap.hasIsAvailable ? ' AND s.is_available = TRUE' : '';
  const accessWhere = libraryOnly ? buildLibraryAccessWhereSong('s') : '';

  const ui = await getUserInteractionsCapabilities();
  if (
    ui.hasTable
    && ui.hasSongId
    && ui.hasInteractionType
    && ui.hasUserId
    && (ui.hasCreatedAt || ui.hasEventTime)
  ) {
    const timeExpr = ui.hasEventTime && ui.hasCreatedAt
      ? 'COALESCE(ui.event_time, ui.created_at)'
      : ui.hasEventTime
        ? 'ui.event_time'
        : 'ui.created_at';

    const sql = libraryOnly
      ? `SELECT COUNT(DISTINCT ui.user_id)::bigint AS n
           FROM user_interactions ui
           INNER JOIN songs s ON s.id = ui.song_id
          WHERE ${timeExpr} >= date_trunc('month', CURRENT_TIMESTAMP)
            AND ui.interaction_type = 'play'
            AND ui.user_id IS NOT NULL
            AND ${accessWhere}${buildArtistMatchSql('s.artist', '$1')}${availabilityWhere}`
      : `SELECT COUNT(DISTINCT ui.user_id)::bigint AS n
           FROM user_interactions ui
           INNER JOIN songs s ON s.id = ui.song_id
          WHERE ${timeExpr} >= date_trunc('month', CURRENT_TIMESTAMP)
            AND ui.interaction_type = 'play'
            AND ui.user_id IS NOT NULL
            AND ${buildArtistMatchSql('s.artist', '$1')}${availabilityWhere}`;

    const args = libraryOnly ? [name, LIBRARY_USER_ID] : [name];

    try {
      const result = await query(sql, args);
      const row = result.rows && result.rows[0];
      const n = row && row.n !== undefined && row.n !== null ? Number(row.n) : 0;
      return Number.isFinite(n) ? n : 0;
    } catch (err) {
      console.error('[artist-service] countArtistUniqueListenersMonthly (user_interactions) failed:', err && err.message ? err.message : err);
    }
  }

  const lc = await getListensCapabilities();
  if (!lc.hasListens || !lc.hasListenedAt) {
    return null;
  }

  const sql = libraryOnly
    ? `SELECT COUNT(DISTINCT l.user_id)::bigint AS n
         FROM listens l
         INNER JOIN songs s ON s.id = l.song_id
        WHERE l.listened_at >= date_trunc('month', CURRENT_TIMESTAMP)
          AND l.user_id IS NOT NULL
          AND ${accessWhere}${buildArtistMatchSql('s.artist', '$1')}${availabilityWhere}`
    : `SELECT COUNT(DISTINCT l.user_id)::bigint AS n
         FROM listens l
         INNER JOIN songs s ON s.id = l.song_id
        WHERE l.listened_at >= date_trunc('month', CURRENT_TIMESTAMP)
          AND l.user_id IS NOT NULL
          AND ${buildArtistMatchSql('s.artist', '$1')}${availabilityWhere}`;

  const args = libraryOnly ? [name, LIBRARY_USER_ID] : [name];

  try {
    const result = await query(sql, args);
    const row = result.rows && result.rows[0];
    const n = row && row.n !== undefined && row.n !== null ? Number(row.n) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch (err) {
    console.error('[artist-service] countArtistUniqueListenersMonthly (listens) failed:', err && err.message ? err.message : err);
    return null;
  }
}

/**
 * @param {string} name
 * @param {{ hasIsAvailable: boolean }} songsCap
 * @param {boolean} libraryOnly
 * @param {(columnSql: string, paramSql: string) => string} buildArtistMatchSql
 * @returns {Promise<number|null>}
 */
async function countArtistUniqueListenersAllTime(name, songsCap, libraryOnly, buildArtistMatchSql) {
  const availabilityWhere = songsCap.hasIsAvailable ? ' AND s.is_available = TRUE' : '';
  const accessWhere = libraryOnly ? buildLibraryAccessWhereSong('s') : '';

  const ui = await getUserInteractionsCapabilities();
  if (
    ui.hasTable
    && ui.hasSongId
    && ui.hasInteractionType
    && ui.hasUserId
  ) {
    const sql = libraryOnly
      ? `SELECT COUNT(DISTINCT ui.user_id)::bigint AS n
           FROM user_interactions ui
           INNER JOIN songs s ON s.id = ui.song_id
          WHERE ui.interaction_type = 'play'
            AND ui.user_id IS NOT NULL
            AND ${accessWhere}${buildArtistMatchSql('s.artist', '$1')}${availabilityWhere}`
      : `SELECT COUNT(DISTINCT ui.user_id)::bigint AS n
           FROM user_interactions ui
           INNER JOIN songs s ON s.id = ui.song_id
          WHERE ui.interaction_type = 'play'
            AND ui.user_id IS NOT NULL
            AND ${buildArtistMatchSql('s.artist', '$1')}${availabilityWhere}`;

    const args = libraryOnly ? [name, LIBRARY_USER_ID] : [name];

    try {
      const result = await query(sql, args);
      const row = result.rows && result.rows[0];
      const n = row && row.n !== undefined && row.n !== null ? Number(row.n) : 0;
      return Number.isFinite(n) ? n : 0;
    } catch (err) {
      console.error('[artist-service] countArtistUniqueListenersAllTime (user_interactions) failed:', err && err.message ? err.message : err);
    }
  }

  const lc = await getListensCapabilities();
  if (!lc.hasListens) {
    return null;
  }

  const sql = libraryOnly
    ? `SELECT COUNT(DISTINCT l.user_id)::bigint AS n
         FROM listens l
         INNER JOIN songs s ON s.id = l.song_id
        WHERE l.user_id IS NOT NULL
          AND ${accessWhere}${buildArtistMatchSql('s.artist', '$1')}${availabilityWhere}`
    : `SELECT COUNT(DISTINCT l.user_id)::bigint AS n
         FROM listens l
         INNER JOIN songs s ON s.id = l.song_id
        WHERE l.user_id IS NOT NULL
          AND ${buildArtistMatchSql('s.artist', '$1')}${availabilityWhere}`;

  const args = libraryOnly ? [name, LIBRARY_USER_ID] : [name];

  try {
    const result = await query(sql, args);
    const row = result.rows && result.rows[0];
    const n = row && row.n !== undefined && row.n !== null ? Number(row.n) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch (err) {
    console.error('[artist-service] countArtistUniqueListenersAllTime (listens) failed:', err && err.message ? err.message : err);
    return null;
  }
}

/**
 * @param {string} name
 * @param {{ hasIsAvailable: boolean }} songsCap
 * @param {boolean} libraryOnly
 * @param {(columnSql: string, paramSql: string) => string} buildArtistMatchSql
 * @returns {Promise<number>}
 */
async function countArtistLikes(name, songsCap, libraryOnly, buildArtistMatchSql) {
  const availabilityWhere = songsCap.hasIsAvailable ? ' AND s.is_available = TRUE' : '';
  const accessWhere = libraryOnly ? buildLibraryAccessWhereSong('s') : '';

  try {
    const result = await query(
      `SELECT COUNT(*)::int AS n
       FROM likes lk
       INNER JOIN songs s ON s.id = lk.song_id
      WHERE ${accessWhere}${buildArtistMatchSql('s.artist', '$1')}${availabilityWhere}`,
      libraryOnly ? [name, LIBRARY_USER_ID] : [name]
    );
    const row = result.rows && result.rows[0];
    const n = row && row.n !== undefined && row.n !== null ? Number(row.n) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch (err) {
    console.error('[artist-service] countArtistLikes failed:', err && err.message ? err.message : err);
    return 0;
  }
}

/**
 * @param {string} name
 * @param {{ hasIsAvailable: boolean }} songsCap
 * @param {boolean} libraryOnly
 * @param {(columnSql: string, paramSql: string) => string} buildArtistMatchSql
 * @returns {Promise<number>}
 */
async function countArtistDislikes(name, songsCap, libraryOnly, buildArtistMatchSql) {
  const availabilityWhere = songsCap.hasIsAvailable ? ' AND s.is_available = TRUE' : '';
  const accessWhere = libraryOnly ? buildLibraryAccessWhereSong('s') : '';

  try {
    const result = await query(
      `SELECT COUNT(*)::int AS n
       FROM dislikes dl
       INNER JOIN songs s ON s.id = dl.song_id
      WHERE ${accessWhere}${buildArtistMatchSql('s.artist', '$1')}${availabilityWhere}`,
      libraryOnly ? [name, LIBRARY_USER_ID] : [name]
    );
    const row = result.rows && result.rows[0];
    const n = row && row.n !== undefined && row.n !== null ? Number(row.n) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch (err) {
    console.error('[artist-service] countArtistDislikes failed:', err && err.message ? err.message : err);
    return 0;
  }
}

/**
 * @param {string} name
 * @param {{ hasIsAvailable: boolean }} songsCap
 * @param {boolean} libraryOnly
 * @param {(columnSql: string, paramSql: string) => string} buildArtistMatchSql
 * @returns {Promise<number>}
 */
async function countArtistPlaylistAdds(name, songsCap, libraryOnly, buildArtistMatchSql) {
  const availabilityWhere = songsCap.hasIsAvailable ? ' AND s.is_available = TRUE' : '';
  const accessWhere = libraryOnly ? buildLibraryAccessWhereSong('s') : '';

  try {
    const result = await query(
      `SELECT COUNT(*)::int AS n
       FROM playlist_tracks pt
       INNER JOIN songs s ON s.id = pt.song_id
      WHERE ${accessWhere}${buildArtistMatchSql('s.artist', '$1')}${availabilityWhere}`,
      libraryOnly ? [name, LIBRARY_USER_ID] : [name]
    );
    const row = result.rows && result.rows[0];
    const n = row && row.n !== undefined && row.n !== null ? Number(row.n) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch (err) {
    console.error('[artist-service] countArtistPlaylistAdds failed:', err && err.message ? err.message : err);
    return 0;
  }
}

module.exports = {
  sumArtistMonthlyListens,
  sumArtistAllTimeListens,
  countArtistUniqueListenersMonthly,
  countArtistUniqueListenersAllTime,
  countArtistLikes,
  countArtistDislikes,
  countArtistPlaylistAdds,
};
