const { query } = require('./pool');
const { getSchemaCapabilities } = require('./schemaCapabilities');

const LIBRARY_USER_ID = (() => {
    const n = parseInt(String(process.env.LIBRARY_USER_ID || '1'), 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
})();

function parsePositiveInt(value) {
    const n = parseInt(String(value), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeGenre(value) {
    if (value === undefined || value === null) return null;
    const normalized = String(value).normalize('NFC').trim().slice(0, 100);
    return normalized || null;
}

function normalizeYear(value) {
    if (value === undefined) return undefined;
    if (value === null || String(value).trim() === '') return null;
    const parsed = parseInt(String(value).trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 3000) {
        const e = new Error('Некорректный year');
        e.status = 400;
        throw e;
    }
    return parsed;
}

function normalizeFileHash(value) {
    if (value === undefined) return undefined;
    if (value === null || String(value).trim() === '') return null;
    const normalized = String(value).trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalized)) {
        const e = new Error('Некорректный file_hash');
        e.status = 400;
        throw e;
    }
    return normalized;
}

async function getSongById(id) {
    const songId = parsePositiveInt(id);
    if (!songId) return null;

    const { hasIsAvailable, hasEbapStatus, hasEbapReadyFlag } = await getSchemaCapabilities();
    const availabilityField = hasIsAvailable ? 'is_available' : 'true as is_available';
    const ebapStatusField = hasEbapStatus ? 'ebap_status' : `'none'::varchar as ebap_status`;
    const ebapReadyField = hasEbapReadyFlag ? 'has_ebap' : 'false as has_ebap';

    const result = await query(
        `SELECT id, uploader_id, title, artist, album, duration, genre, year, file_path,
            file_size, mime_type, cover_path, ${availabilityField}, ${ebapReadyField}, ${ebapStatusField}, created_at, updated_at
     FROM songs WHERE id = $1`,
        [songId]
    );

    if (!result.rows || !result.rows.length) return null;

    const row = result.rows[0];
    // Для обратной совместимости добавляем user_id
    return { ...row, user_id: row.uploader_id };
}

async function getSongsByUploader(userId, options = {}) {
    const uid = parsePositiveInt(userId);
    if (!uid) return [];

    const { hasIsAvailable, hasEbapStatus, hasEbapReadyFlag } = await getSchemaCapabilities();
    const includeUnavailable = String(options.includeUnavailable ?? 'true') !== 'false';

    const availabilityField = hasIsAvailable ? 'is_available' : 'true as is_available';
    const ebapStatusField = hasEbapStatus ? 'ebap_status' : `'none'::varchar as ebap_status`;
    const ebapReadyField = hasEbapReadyFlag ? 'has_ebap' : 'false as has_ebap';
    const availabilityWhere = (hasIsAvailable && !includeUnavailable) ? ' AND is_available = true' : '';

    const result = await query(
        `SELECT id, uploader_id, title, artist, album, duration, genre, year, file_path,
            file_size, mime_type, cover_path, ${availabilityField}, ${ebapReadyField}, ${ebapStatusField}, created_at, updated_at
     FROM songs WHERE uploader_id = $1${availabilityWhere}
     ORDER BY created_at DESC`,
        [uid]
    );

    return (result.rows || []).map(row => ({ ...row, user_id: row.uploader_id }));
}

async function listCatalogSongs(options = {}) {
    const includeUnavailable = String(options.includeUnavailable ?? 'true') !== 'false';

    const { hasIsAvailable, hasEbapStatus, hasEbapReadyFlag } = await getSchemaCapabilities();
    const availabilityField = hasIsAvailable ? 's.is_available' : 'true as is_available';
    const ebapStatusField = hasEbapStatus ? 's.ebap_status' : `'none'::varchar as ebap_status`;
    const ebapReadyField = hasEbapReadyFlag ? 's.has_ebap' : 'false as has_ebap';
    const availabilityWhere = (hasIsAvailable && !includeUnavailable) ? ' AND s.is_available = true' : '';

    const result = await query(
        `SELECT s.id, s.title, s.artist, s.album, s.duration, s.genre, s.year, s.cover_path,
            ${availabilityField}, ${ebapReadyField}, ${ebapStatusField}, s.created_at, s.updated_at
       FROM songs s
      WHERE (
            s.uploader_id = $1
         OR EXISTS (
              SELECT 1
                FROM artist_uploaders au
               WHERE au.user_id = s.uploader_id
                 AND au.is_active = TRUE
            )
      )${availabilityWhere}
      ORDER BY s.created_at DESC`,
        [LIBRARY_USER_ID]
    );

    return result.rows || [];
}

async function listSongsAdmin(options = {}) {
    const limit = Math.min(parseInt(String(options.limit ?? '200'), 10) || 200, 1000);
    const offset = Math.max(parseInt(String(options.offset ?? '0'), 10) || 0, 0);
    const includeUnavailable = String(options.includeUnavailable ?? 'true') !== 'false';

    const { hasFileHash, hasIsAvailable, hasEbapStatus, hasEbapReadyFlag } = await getSchemaCapabilities();

    const fields = [
        'id',
        'uploader_id',
        'title',
        'artist',
        'album',
        'duration',
        'genre',
        'year',
        'file_path',
        'file_size',
        'mime_type',
        'cover_path',
        (hasIsAvailable ? 'is_available' : 'true as is_available'),
        ...(hasFileHash ? ['file_hash'] : []),
        'created_at',
        'updated_at',
    ].join(', ');

    const where = (includeUnavailable || !hasIsAvailable) ? '' : 'WHERE is_available = true';

    const result = await query(
        `SELECT ${fields}
       FROM songs
       ${where}
       ORDER BY id ASC
       LIMIT $1 OFFSET $2`,
        [limit, offset]
    );

    const items = (result.rows || []).map(row => ({ ...row, user_id: row.uploader_id }));
    return { limit, offset, count: items.length, items };
}

async function getSongByHash(fileHash, userId) {
    const { hasFileHash, hasIsAvailable } = await getSchemaCapabilities();
    if (!hasFileHash) return null;

    const hash = (fileHash || '').toString().trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(hash)) return null;

    const params = [hash];
    let sql = `
    SELECT id, uploader_id, title, artist, album, duration, genre, year, file_path,
           file_size, mime_type, cover_path, ${(hasIsAvailable ? 'is_available' : 'true as is_available')}, file_hash, created_at, updated_at
    FROM songs
    WHERE file_hash = $1
  `;

    const uid = userId !== undefined && userId !== null && String(userId).trim() !== '' ? parsePositiveInt(userId) : null;
    if (uid) {
        params.push(uid);
        sql += ' AND uploader_id = $2';
    }

    sql += ' ORDER BY created_at DESC LIMIT 1';

    const result = await query(sql, params);
    if (!result.rows || !result.rows.length) return null;
    const row = result.rows[0];
    return { ...row, user_id: row.uploader_id };
}

async function lookupSongs({ title, artist, userId }) {
    const t = (title || '').toString();
    const a = (artist || '').toString();
    if (!t || !a) return [];

    const { hasIsAvailable } = await getSchemaCapabilities();
    const availabilityField = hasIsAvailable ? 'is_available' : 'true as is_available';
    const availabilityWhere = hasIsAvailable ? ' AND is_available = true' : '';

    const params = [t.toLowerCase(), a.toLowerCase()];
    let sql = `
    SELECT id, uploader_id, title, artist, album, duration, genre, year, file_path,
           file_size, mime_type, cover_path, ${availabilityField}, created_at, updated_at
    FROM songs
    WHERE LOWER(title) = $1 AND LOWER(artist) = $2${availabilityWhere}
  `;

    const uid = userId !== undefined && userId !== null && String(userId).trim() !== '' ? parsePositiveInt(userId) : null;
    if (uid) {
        sql += ' AND uploader_id = $3';
        params.push(uid);
    }

    sql += ' ORDER BY created_at DESC LIMIT 20';

    const result = await query(sql, params);
    return (result.rows || []).map(row => ({ ...row, user_id: row.uploader_id }));
}

async function createSong(payload) {
    const {
        user_id,
        title,
        artist,
        album,
        duration,
        genre,
        year,
        file_path,
        file_size,
        mime_type,
        cover_path,
        file_hash,
    } = payload || {};

    if (!user_id || !title || !file_path) {
        const e = new Error('Обязательные поля: user_id, title, file_path');
        e.status = 400;
        throw e;
    }

    const { hasFileHash, hasIsAvailable, hasEbapStatus, hasEbapReadyFlag, hasTranscodeStatus, hasWaveformStatus, hasMetadataParseStatus } = await getSchemaCapabilities();

    const insertColumns = [
        'uploader_id',
        'title',
        'artist',
        'album',
        'duration',
        'genre',
        'year',
        'file_path',
        'file_size',
        'mime_type',
        'cover_path',
    ];

    const insertValues = [
        user_id,
        title,
        artist,
        album,
        duration,
        normalizeGenre(genre),
        normalizeYear(year),
        file_path,
        file_size,
        mime_type,
        cover_path,
    ];

    if (hasEbapReadyFlag) {
        insertColumns.push('has_ebap');
        insertValues.push(false);
    }

    if (hasEbapStatus) {
        insertColumns.push('ebap_status');
        insertValues.push('none');
        insertColumns.push('ebap_error');
        insertValues.push(null);
    }

    if (hasFileHash) {
        insertColumns.push('file_hash');
        insertValues.push(normalizeFileHash(file_hash));
    }

    if (hasTranscodeStatus) {
        insertColumns.push('transcode_status');
        insertValues.push('pending');
    }

    if (hasWaveformStatus) {
        insertColumns.push('waveform_status');
        insertValues.push('pending');
    }

    if (hasMetadataParseStatus) {
        insertColumns.push('metadata_parse_status');
        insertValues.push('pending');
    }

    const placeholders = insertColumns.map((_, idx) => `$${idx + 1}`).join(', ');

    const returningFields = [
        'id',
        'uploader_id as user_id',
        'title',
        'artist',
        'album',
        'duration',
        'genre',
        'year',
        'file_path',
        'file_size',
        'mime_type',
        'cover_path',
        (hasIsAvailable ? 'is_available' : 'true as is_available'),
        (hasEbapReadyFlag ? 'has_ebap' : 'false as has_ebap'),
        (hasEbapStatus ? 'ebap_status' : `'none'::varchar as ebap_status`),
        ...(hasFileHash ? ['file_hash'] : []),
        'created_at',
        'updated_at',
    ].join(', ');

    const result = await query(
        `INSERT INTO songs (${insertColumns.join(', ')})
     VALUES (${placeholders})
     RETURNING ${returningFields}`,
        insertValues
    );

    const created = result.rows[0];
    if (created && created.id) {
        try {
            await query(`SELECT pg_notify('ebap_jobs', $1)`, [String(created.id)]);
        } catch {
        }
        if (hasTranscodeStatus) {
            try {
                await query(`SELECT pg_notify('transcode_jobs', $1)`, [String(created.id)]);
            } catch {
            }
        }
        if (hasMetadataParseStatus) {
            try {
                await query(`SELECT pg_notify('metadata_parse_jobs', $1)`, [String(created.id)]);
            } catch {
            }
        }
    }

    return created;
}

async function updateSong(id, patch) {
    const songId = parsePositiveInt(id);
    if (!songId) {
        const e = new Error('Недопустимый идентификатор трека');
        e.status = 400;
        throw e;
    }

    const { hasFileHash, hasIsAvailable } = await getSchemaCapabilities();

    const updates = [];
    const values = [];
    let paramCount = 1;

    const fields = patch && typeof patch === 'object' ? patch : {};

    if (fields.title !== undefined) { updates.push(`title = $${paramCount++}`); values.push(fields.title); }
    if (fields.artist !== undefined) { updates.push(`artist = $${paramCount++}`); values.push(fields.artist); }
    if (fields.album !== undefined) { updates.push(`album = $${paramCount++}`); values.push(fields.album); }
    if (fields.duration !== undefined) { updates.push(`duration = $${paramCount++}`); values.push(fields.duration); }
    if (fields.genre !== undefined) { updates.push(`genre = $${paramCount++}`); values.push(normalizeGenre(fields.genre)); }
    if (fields.year !== undefined) { updates.push(`year = $${paramCount++}`); values.push(normalizeYear(fields.year)); }
    if (fields.cover_path !== undefined) { updates.push(`cover_path = $${paramCount++}`); values.push(fields.cover_path); }
    if (fields.file_path !== undefined) { updates.push(`file_path = $${paramCount++}`); values.push(fields.file_path); }
    if (fields.file_size !== undefined) { updates.push(`file_size = $${paramCount++}`); values.push(fields.file_size); }
    if (fields.mime_type !== undefined) { updates.push(`mime_type = $${paramCount++}`); values.push(fields.mime_type); }

    if (fields.is_available !== undefined && hasIsAvailable) {
        updates.push(`is_available = $${paramCount++}`);
        values.push(Boolean(fields.is_available));
    }

    if (fields.file_hash !== undefined && hasFileHash) {
        updates.push(`file_hash = $${paramCount++}`);
        values.push(normalizeFileHash(fields.file_hash));
    }

    if (updates.length === 0) {
        const e = new Error('Нет данных для обновления');
        e.status = 400;
        throw e;
    }

    values.push(songId);

    const returningFields = [
        'id',
        'uploader_id as user_id',
        'title',
        'artist',
        'album',
        'duration',
        'genre',
        'year',
        'file_path',
        'file_size',
        'mime_type',
        'cover_path',
        (hasIsAvailable ? 'is_available' : 'true as is_available'),
        ...(hasFileHash ? ['file_hash'] : []),
        'created_at',
        'updated_at',
    ].join(', ');

    const result = await query(
        `UPDATE songs SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
     WHERE id = $${paramCount}
     RETURNING ${returningFields}`,
        values
    );

    return result.rows && result.rows.length ? result.rows[0] : null;
}

async function deleteSong(id) {
    const songId = parsePositiveInt(id);
    if (!songId) return null;

    const result = await query('DELETE FROM songs WHERE id = $1 RETURNING id, file_path', [songId]);
    return result.rows && result.rows.length ? result.rows[0] : null;
}

async function getUserUploadStats(userId, dateIso) {
    const uid = parsePositiveInt(userId);
    if (!uid) {
        const e = new Error('Некорректный userId');
        e.status = 400;
        throw e;
    }

    const date = (dateIso || '').toString().trim();
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) {
        const e = new Error('Некорректная дата');
        e.status = 400;
        throw e;
    }

    const dailyRes = await query(
        `SELECT COUNT(*)::int AS "dailyCount"
       FROM songs
      WHERE uploader_id = $1
        AND created_at::date = $2::date`,
        [uid, date]
    );

    const totalRes = await query(
        `SELECT COALESCE(SUM(file_size), 0)::bigint AS "totalStorage"
       FROM songs
      WHERE uploader_id = $1`,
        [uid]
    );

    return {
        dailyCount: dailyRes.rows && dailyRes.rows[0] ? dailyRes.rows[0].dailyCount : 0,
        totalStorage: totalRes.rows && totalRes.rows[0] ? Number(totalRes.rows[0].totalStorage) : 0,
    };
}

module.exports = {
    getSongById,
    getSongsByUploader,
    listCatalogSongs,
    getSongByHash,
    lookupSongs,
    listSongsAdmin,
    createSong,
    updateSong,
    deleteSong,
    getUserUploadStats,
};
