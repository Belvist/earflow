function getAllowedUploaderIds(userId) {
    const rawLibraryId = process.env.LIBRARY_USER_ID;
    const parsedLibraryId = rawLibraryId != null && String(rawLibraryId).trim() !== ''
        ? Number.parseInt(String(rawLibraryId), 10)
        : 1;
    const libraryId = Number.isFinite(parsedLibraryId) && parsedLibraryId > 0 ? parsedLibraryId : 1;

    const ids = [libraryId];
    if (userId && Number.isFinite(userId) && userId > 0 && userId !== libraryId) {
        ids.push(userId);
    }
    return ids;
}

function coerceUserId(raw) {
    if (raw === undefined || raw === null) return null;
    const n = Number.parseInt(String(raw), 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
}

module.exports = {
    getAllowedUploaderIds,
    coerceUserId,
};
