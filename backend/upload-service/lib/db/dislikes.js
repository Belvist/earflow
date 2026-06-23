const { query } = require('./pool');
const { getSchemaCapabilities } = require('./schemaCapabilities');

function parsePositiveInt(value) {
    const n = parseInt(String(value), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

async function listDislikes(userId) {
    const uid = parsePositiveInt(userId);
    if (!uid) return [];

    const { hasEbapReadyFlag } = await getSchemaCapabilities();
    const ebapReadyField = hasEbapReadyFlag ? 's.has_ebap' : 'false as has_ebap';

    const result = await query(
        `SELECT s.id, s.title, s.artist, s.album, s.duration,
            s.genre, s.year, s.cover_path, ${ebapReadyField}, s.created_at, s.updated_at
       FROM dislikes d
       JOIN songs s ON s.id = d.song_id
      WHERE d.user_id = $1
      ORDER BY d.created_at DESC`,
        [uid]
    );

    return result.rows || [];
}

async function addDislike(userId, songId) {
    const uid = parsePositiveInt(userId);
    const sid = parsePositiveInt(songId);
    if (!uid || !sid) {
        const e = new Error('user_id and song_id required');
        e.status = 400;
        throw e;
    }

    await query(
        `INSERT INTO dislikes (user_id, song_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, song_id) DO NOTHING`,
        [uid, sid]
    );

    return { disliked: true };
}

async function removeDislike(userId, songId) {
    const uid = parsePositiveInt(userId);
    const sid = parsePositiveInt(songId);
    if (!uid || !sid) {
        const e = new Error('userId and songId required');
        e.status = 400;
        throw e;
    }

    await query('DELETE FROM dislikes WHERE user_id = $1 AND song_id = $2', [uid, sid]);
    return { disliked: false };
}

module.exports = {
    listDislikes,
    addDislike,
    removeDislike,
};
