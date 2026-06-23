const { query } = require('./pool');

function parsePositiveInt(value) {
    const n = parseInt(String(value || ''), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

async function getActiveArtistByUserId(userId) {
    const uid = parsePositiveInt(userId);
    if (!uid) return null;

    const result = await query(
        `SELECT user_id, artist_name
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
    getActiveArtistByUserId,
};
