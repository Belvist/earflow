'use strict';

function parsePositiveInt(value) {
    const n = parseInt(String(value || ''), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

const LIBRARY_USER_ID = parsePositiveInt(process.env.LIBRARY_USER_ID || '1') || 1;

function getRequestUserId(req) {
    const raw = req && req.user ? (req.user.id ?? req.user.userId ?? req.user.user_id ?? req.user.sub) : null;
    return parsePositiveInt(raw);
}

function getRequestIsAdmin(req) {
    return !!(req && req.user && req.user.isAdmin === true);
}

function canAccessUserSongs({ requestUserId, targetUserId, requestIsAdmin = false }) {
    const reqId = parsePositiveInt(requestUserId);
    const targetId = parsePositiveInt(targetUserId);
    if (!reqId || !targetId) return false;
    return reqId === targetId || requestIsAdmin === true;
}

function canAccessSong({ requestUserId, requestIsAdmin = false, song, allowLibrary = true }) {
    const reqId = parsePositiveInt(requestUserId);
    if (!reqId || !song || typeof song !== 'object') return false;

    if (requestIsAdmin === true) return true;

    if (Object.prototype.hasOwnProperty.call(song, 'is_public')) {
        if (song.is_public === true) return true;
        if (song.is_public === false) {
            const ownerId = parsePositiveInt(song.user_id ?? song.userId ?? song.owner_id ?? song.ownerId);
            const uploaderId = parsePositiveInt(song.uploader_id ?? song.uploaderId ?? song.created_by ?? song.createdBy);
            return (ownerId && ownerId === reqId) || (uploaderId && uploaderId === reqId);
        }
    }

    const userId = parsePositiveInt(song.user_id ?? song.userId ?? song.owner_id ?? song.ownerId);
    const uploaderId = parsePositiveInt(song.uploader_id ?? song.uploaderId ?? song.created_by ?? song.createdBy);

    if (userId && userId === reqId) return true;
    if (uploaderId && uploaderId === reqId) return true;

    if (allowLibrary && (userId === LIBRARY_USER_ID || uploaderId === LIBRARY_USER_ID)) return true;

    return false;
}

function deny(res) {
    res.status(403).json({ error: 'Доступ запрещен' });
}

module.exports = {
    getRequestUserId,
    getRequestIsAdmin,
    canAccessUserSongs,
    canAccessSong,
    deny,
};
