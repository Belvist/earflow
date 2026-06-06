import { useMemo } from 'react';

function safeText(v) {
    return (v ?? '').toString().trim();
}

function getYear(track) {
    const y = track && (track.year ?? track.release_year ?? track.releaseYear);
    const n = parseInt(String(y ?? ''), 10);
    return Number.isFinite(n) ? n : null;
}

function getCreatedAt(track) {
    return safeText(track && (track.created_at ?? track.createdAt));
}

function getAlbumKey(track) {
    const album = safeText(track && (track.album ?? track.release));
    if (!album) return '';
    return album;
}

function computeReleaseSortValue(releaseTracks) {
    let latest = '';
    let latestYear = 0;
    for (const t of releaseTracks) {
        const ca = getCreatedAt(t);
        if (ca && ca > latest) latest = ca;
        const y = getYear(t);
        if (y && y > latestYear) latestYear = y;
    }
    return { latestCreatedAt: latest, latestYear };
}

function pickAlbumCover(releaseTracks) {
    for (const t of releaseTracks) {
        const cover = t && (t.cover_path || t.coverPath || t.cover);
        if (cover) return cover;
    }
    return null;
}

export default function useArtistDiscography(tracks) {
    return useMemo(() => {
        const safeTracks = Array.isArray(tracks) ? tracks : [];
        const byAlbum = new Map();
        const singles = [];

        for (const track of safeTracks) {
            if (!track || typeof track !== 'object') continue;
            const albumKey = getAlbumKey(track);
            if (!albumKey) {
                singles.push(track);
                continue;
            }
            const bucket = byAlbum.get(albumKey);
            if (bucket) {
                bucket.push(track);
            } else {
                byAlbum.set(albumKey, [track]);
            }
        }

        const albums = [];
        const epsOrSingles = [];

        for (const [albumName, releaseTracks] of byAlbum.entries()) {
            const sort = computeReleaseSortValue(releaseTracks);
            const cover = pickAlbumCover(releaseTracks);
            const isAlbum = releaseTracks.length >= 4;
            const entry = {
                key: `album:${albumName}`,
                kind: isAlbum ? 'album' : 'ep',
                name: albumName,
                tracks: releaseTracks.slice().sort((a, b) => {
                    const ad = getCreatedAt(a);
                    const bd = getCreatedAt(b);
                    if (ad && bd) return ad.localeCompare(bd);
                    return (Number(a.id) || 0) - (Number(b.id) || 0);
                }),
                trackCount: releaseTracks.length,
                year: sort.latestYear || null,
                latestCreatedAt: sort.latestCreatedAt,
                coverPath: cover,
            };
            if (isAlbum) albums.push(entry);
            else epsOrSingles.push(entry);
        }

        if (singles.length > 0) {
            singles.forEach((single, idx) => {
                const title = safeText(single.title) || 'Single';
                const year = getYear(single);
                const cover = single.cover_path || single.coverPath || single.cover || null;
                const idKey = single.id != null ? String(single.id) : `t${idx}:${title}`;
                epsOrSingles.push({
                    key: `single:${idKey}`,
                    kind: 'single',
                    name: title,
                    tracks: [single],
                    trackCount: 1,
                    year,
                    latestCreatedAt: getCreatedAt(single),
                    coverPath: cover,
                });
            });
        }

        const byLatestDesc = (a, b) => {
            if (a.latestCreatedAt && b.latestCreatedAt) {
                return b.latestCreatedAt.localeCompare(a.latestCreatedAt);
            }
            const ay = a.year || 0;
            const by = b.year || 0;
            return by - ay;
        };

        albums.sort(byLatestDesc);
        epsOrSingles.sort(byLatestDesc);

        const all = [...albums, ...epsOrSingles];

        return {
            all,
            albums,
            singlesAndEps: epsOrSingles,
            hasAlbums: albums.length > 0,
            hasSingles: epsOrSingles.length > 0,
        };
    }, [tracks]);
}
