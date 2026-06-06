'use strict';

function normalizeLine(value, maxLen) {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const s = String(value).normalize('NFC').trim().replace(/\s+/g, ' ');
    if (!s) return null;
    return s.slice(0, maxLen);
}

function normalizeTitle(value) {
    return normalizeLine(value, 200);
}

function normalizeArtist(value) {
    return normalizeLine(value, 200);
}

function normalizeAlbum(value) {
    return normalizeLine(value, 200);
}

function deriveTitleFromFilename(filename) {
    const base = String(filename || '').replace(/\.[^.]+$/, '');
    const s = base.normalize('NFC').trim().replace(/\s+/g, ' ');
    return s ? s.slice(0, 200) : 'Untitled';
}

module.exports = {
    normalizeTitle,
    normalizeArtist,
    normalizeAlbum,
    deriveTitleFromFilename,
};
