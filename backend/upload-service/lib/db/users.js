const { query } = require('./pool');

async function getUserById(userId) {
    const id = Number.parseInt(String(userId || ''), 10);
    if (!Number.isFinite(id) || id <= 0) return null;

    const result = await query(
        'SELECT id, email, username, first_name, last_name, photo_url, password_hash, salt, email_encrypted, metadata, created_at, last_login FROM users WHERE id = $1',
        [id]
    );

    return result.rows && result.rows.length ? result.rows[0] : null;
}

async function updateUserPhotoUrl(userId, photoUrl) {
    const id = Number.parseInt(String(userId || ''), 10);
    if (!Number.isFinite(id) || id <= 0) {
        const e = new Error('Некорректный userId');
        e.status = 400;
        throw e;
    }

    const value = photoUrl !== undefined && photoUrl !== null ? String(photoUrl) : null;

    if (value && value.length > 2048) {
        const e = new Error('Некорректный photoUrl');
        e.status = 400;
        throw e;
    }

    const result = await query(
        `UPDATE users
            SET photo_url = COALESCE($1, photo_url)
          WHERE id = $2
          RETURNING id, username, photo_url`,
        [value, id]
    );

    return result.rows && result.rows.length ? result.rows[0] : null;
}

async function updateUsername(userId, username) {
    const id = Number.parseInt(String(userId || ''), 10);
    if (!Number.isFinite(id) || id <= 0) {
        const e = new Error('Некорректный userId');
        e.status = 400;
        throw e;
    }

    const value = username !== undefined && username !== null ? String(username) : null;

    const result = await query(
        `UPDATE users
            SET username = COALESCE($1, username),
                last_login = CURRENT_TIMESTAMP
          WHERE id = $2
          RETURNING id, email, username, first_name, last_name, photo_url, created_at, last_login`,
        [value, id]
    );

    return result.rows && result.rows.length ? result.rows[0] : null;
}

module.exports = {
    getUserById,
    updateUsername,
    updateUserPhotoUrl,
};
