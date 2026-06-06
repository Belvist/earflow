'use strict';

function getCookieValue(req, cookieName) {
    const header = req.headers && typeof req.headers.cookie === 'string' ? req.headers.cookie : '';
    if (!header) return null;

    const parts = header.split(';');
    for (const part of parts) {
        const idx = part.indexOf('=');
        if (idx <= 0) continue;
        const key = part.slice(0, idx).trim();
        if (key !== cookieName) continue;
        return part.slice(idx + 1).trim();
    }
    return null;
}

module.exports = {
    getCookieValue,
};
