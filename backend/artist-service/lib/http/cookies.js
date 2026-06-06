function getCookieValue(req, name) {
    const header = req && req.headers ? req.headers.cookie : null;
    if (!header) return null;
    const parts = String(header).split(';');
    for (const part of parts) {
        const trimmed = part.trim();
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        const k = trimmed.slice(0, eq).trim();
        if (k !== name) continue;
        return decodeURIComponent(trimmed.slice(eq + 1).trim());
    }
    return null;
}

module.exports = {
    getCookieValue,
};
