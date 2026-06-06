import { uploadTrackWithMeta } from './trackUploadUsecase';

function safeText(v) {
    if (v === null || v === undefined) return '';
    return String(v);
}

function clampInt(v, min, max) {
    const n = Number.parseInt(String(v ?? ''), 10);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
}

function normalizeAlbumMeta(meta) {
    const m = meta && typeof meta === 'object' ? meta : {};
    const artist = safeText(m.artist).trim();
    const album = safeText(m.album).trim();
    const genre = safeText(m.genre).trim();
    const year = safeText(m.year).trim();
    const explicit = m.explicit === true;

    return { artist, album, genre, year, explicit };
}

function withAlbumDefaults(trackMeta, albumMeta) {
    const t = trackMeta && typeof trackMeta === 'object' ? trackMeta : {};
    const title = safeText(t.title).trim();
    const artist = safeText(t.artist).trim() || albumMeta.artist;
    const album = safeText(t.album).trim() || albumMeta.album;
    const genre = safeText(t.genre).trim() || albumMeta.genre;
    const year = safeText(t.year).trim() || albumMeta.year;

    const meta = {};
    if (artist) meta.artist = artist;
    if (title) meta.title = title;
    if (album) meta.album = album;
    if (genre) meta.genre = genre;
    if (year) meta.year = year;

    return meta;
}

async function runPool({ items, concurrency, isCancelled, worker, onItem }) {
    const limit = clampInt(concurrency, 1, 4);
    let index = 0;

    const results = new Array(items.length);

    const runOne = async () => {
        for (;;) {
            if (isCancelled()) return;
            const i = index;
            if (i >= items.length) return;
            index += 1;

            const item = items[i];
            const res = await worker(item, i);
            results[i] = res;
            onItem(res, i);
        }
    };

    const workers = [];
    for (let i = 0; i < limit; i += 1) {
        workers.push(runOne());
    }
    await Promise.all(workers);

    return results;
}

export async function uploadAlbumTracks({
    tracks,
    albumMeta,
    concurrency,
    isCancelled,
    onTrackUpdate,
}) {
    const list = Array.isArray(tracks) ? tracks : [];
    const meta = normalizeAlbumMeta(albumMeta);

    const safeCancel = typeof isCancelled === 'function' ? isCancelled : () => false;
    const safeOnUpdate = typeof onTrackUpdate === 'function' ? onTrackUpdate : () => {};

    const worker = async (t) => {
        const file = t && t.file ? t.file : null;
        if (!file) {
            return { ok: false, error: { type: 'no_file' } };
        }

        const merged = withAlbumDefaults(t.meta, meta);
        const res = await uploadTrackWithMeta({ file, meta: merged });

        return res.ok
            ? { ok: true, metaPatched: res.metaPatched === true, data: res.data }
            : { ok: false, error: res.error };
    };

    const summary = {
        total: list.length,
        ok: 0,
        failed: 0,
        cancelled: false,
    };

    const results = await runPool({
        items: list,
        concurrency,
        isCancelled: safeCancel,
        worker,
        onItem: (r, idx) => {
            if (r && r.ok) summary.ok += 1;
            else summary.failed += 1;
            safeOnUpdate(r, idx);
        },
    });

    summary.cancelled = safeCancel();
    return { ok: true, summary, results };
}
