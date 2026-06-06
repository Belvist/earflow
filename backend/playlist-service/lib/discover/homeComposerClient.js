function normalizeServiceUrl(raw) {
    const url = String(raw || '').trim();
    if (!url) return '';
    return url.replace(/\/+$/, '');
}

function getComposerUrl() {
    const explicit = normalizeServiceUrl(process.env.PLAYLIST_HOME_COMPOSER_URL);
    if (explicit) return explicit;
    const ranking = normalizeServiceUrl(process.env.RECO_RANKING_SERVICE_URL || 'http://ranking-service:8080');
    return ranking ? `${ranking}/home-playlists` : '';
}

function getTimeoutMs() {
    const parsed = Number.parseInt(String(process.env.PLAYLIST_HOME_COMPOSER_TIMEOUT_MS || ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 800;
    return Math.min(5000, Math.max(100, parsed));
}

function isValidComposerResponse(value) {
    return Boolean(
        value
        && typeof value === 'object'
        && typeof value.seed === 'string'
        && Array.isArray(value.rails)
    );
}

async function fetchHomeComposerRails({ userId, seed }) {
    const url = getComposerUrl();
    if (!url) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), getTimeoutMs());
    try {
        const uid = Number.parseInt(String(userId || ''), 10);
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({
                userId: Number.isFinite(uid) && uid > 0 ? uid : 0,
                seed: String(seed || '').slice(0, 128),
            }),
            signal: controller.signal,
        });
        if (!response.ok) return null;
        const data = await response.json();
        return isValidComposerResponse(data) ? data : null;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

module.exports = {
    fetchHomeComposerRails,
};
