const { query } = require('./pool');

function parsePositiveInt(value) {
    const n = parseInt(String(value), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

async function createListen(userId, songId) {
    const uid = parsePositiveInt(userId);
    const sid = parsePositiveInt(songId);
    if (!uid || !sid) {
        const e = new Error('Обязательные поля: user_id, song_id');
        e.status = 400;
        throw e;
    }

    const result = await query(
        `INSERT INTO listens (user_id, song_id)
     VALUES ($1, $2)
     RETURNING id, user_id, song_id, listened_at`,
        [uid, sid]
    );

    return result.rows[0];
}

module.exports = {
    createListen,
};
