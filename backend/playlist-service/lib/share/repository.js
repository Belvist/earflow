const crypto = require('crypto');
const { getSongsSchemaCapabilities } = require('../discover/schema');

const LIBRARY_USER_ID = (() => {
    const n = parseInt(String(process.env.LIBRARY_USER_ID || '1'), 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
})();

function generateShareSlug() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let slug = '';
    for (let i = 0; i < 32; i++) {
        slug += chars[crypto.randomInt(chars.length)];
    }
    return slug;
}

async function findSharedPlaylistByFingerprint(pool, { userId, fingerprint }) {
    const result = await pool.query(
        `SELECT *
       FROM playlists
      WHERE user_id = $1
        AND is_public = true
        AND is_smart = true
        AND smart_rules->>'fingerprint' = $2
      ORDER BY updated_at DESC
      LIMIT 1`,
        [userId, fingerprint]
    );

    return result.rows[0] || null;
}

async function fetchShareableSongs(pool, { userId, songIds }) {
    const cap = await getSongsSchemaCapabilities(pool);
    const availability = cap.hasIsAvailable ? ' AND s.is_available = true' : '';

    const allowedUploaders = userId === LIBRARY_USER_ID ? [LIBRARY_USER_ID] : [LIBRARY_USER_ID, userId];

    const result = await pool.query(
        `SELECT s.id, s.cover_path
       FROM songs s
      WHERE s.id = ANY($1::int[])
        AND s.uploader_id = ANY($2::int[])
        ${availability}`,
        [songIds, allowedUploaders]
    );

    const byId = new Map(result.rows.map((r) => [Number(r.id), r]));
    const ordered = songIds.map((id) => byId.get(Number(id))).filter(Boolean);
    return { ordered, byId };
}

async function createSharedPlaylist(pool, { userId, title, description, songIds, fingerprint, coverPath }) {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        let playlist = null;

        // Best-effort uniqueness for slug
        for (let attempt = 1; attempt <= 10; attempt++) {
            const shareSlug = generateShareSlug();
            const smartRules = {
                kind: 'share_compiled',
                fingerprint,
                song_ids: songIds,
                created_at: new Date().toISOString(),
            };

            const res = await client.query(
                `INSERT INTO playlists (user_id, name, description, cover_path, is_public, share_slug, is_smart, smart_rules, track_count, updated_at)
         VALUES ($1, $2, $3, $4, true, $5, true, $6::jsonb, $7, CURRENT_TIMESTAMP)
         RETURNING *`,
                [
                    userId,
                    title,
                    description || null,
                    coverPath || null,
                    shareSlug,
                    JSON.stringify(smartRules),
                    songIds.length,
                ]
            ).catch(() => null);

            if (res && res.rows && res.rows[0]) {
                playlist = res.rows[0];
                break;
            }
        }

        if (!playlist) {
            throw new Error('Не удалось создать ссылку для шаринга');
        }

        // Bulk insert tracks with ordinality (stable order)
        await client.query(
            `INSERT INTO playlist_tracks (playlist_id, song_id, position, added_by)
       SELECT $1, t.song_id, t.ord::int, $2
         FROM unnest($3::int[]) WITH ORDINALITY AS t(song_id, ord)`,
            [playlist.id, userId, songIds]
        );

        await client.query('COMMIT');
        return playlist;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

module.exports = {
    findSharedPlaylistByFingerprint,
    fetchShareableSongs,
    createSharedPlaylist,
};
