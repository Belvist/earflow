export function readNowPlayingRevision(nowPlaying) {
    const revision = Number(nowPlaying?.stateRevision);
    return Number.isFinite(revision) && revision > 0 ? revision : 0;
}

export function readNowPlayingUpdatedAt(nowPlaying) {
    const updatedAt = Number(nowPlaying?.updatedAtMs);
    return Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : 0;
}

export function readActiveRevision(value) {
    const revision = Number(value);
    return Number.isFinite(revision) && revision > 0 ? Math.floor(revision) : 0;
}
