'use strict';

const { query } = require('./pool');

function parsePositiveInt(value) {
    const n = parseInt(String(value || ''), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

async function getOwnedArtistByUserId(userId) {
    const uid = parsePositiveInt(userId);
    if (!uid) return null;

    const result = await query(
        `SELECT a.id AS artist_id, a.public_id AS artist_public_id, a.name AS artist_name
       FROM artist_ownerships o
       JOIN artists a ON a.id = o.artist_id
      WHERE o.user_id = $1
        AND o.status = 'active'
        AND o.revoked_at IS NULL
      ORDER BY o.created_at DESC
      LIMIT 1`,
        [uid]
    );

    const row = result.rows && result.rows.length ? result.rows[0] : null;
    if (!row) return null;

    const name = (row.artist_name || '').toString().normalize('NFC').trim().slice(0, 255);
    const id = parsePositiveInt(row.artist_id);
    return id && name ? { userId: uid, artistId: id, artistName: name, artistPublicId: row.artist_public_id || null } : null;
}

module.exports = {
    getOwnedArtistByUserId,
};
