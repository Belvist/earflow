const { computeDiscoverSeed, hashToInt64 } = require('./seed');
const { getClient: getRedisClient } = require('../redis');
const crypto = require('node:crypto');
const { fetchHomeComposerRails } = require('./homeComposerClient');
const {
    fetchPopularSongs,
    fetchNewSongs,
    fetchTopGenres,
    fetchSongsByGenre,
    fetchTopArtists,
    fetchSongsByArtist,
    fetchTopYears,
    fetchSongsByYear,
    fetchForYouSongs,
    fetchMoodSongs,
} = require('./queries');
const { buildPlaylist, buildRail, buildGenreTitle } = require('./assemble');

function safeJsonParse(raw) {
    try {
        if (!raw) return null;
        return JSON.parse(String(raw));
    } catch {
        return null;
    }
}

function isValidDiscoverResponse(value) {
    if (!value || typeof value !== 'object') return false;
    if (typeof value.seed !== 'string') return false;
    if (!Array.isArray(value.rails)) return false;
    return true;
}

function computeDiscoverCacheTtlSeconds() {
    const overrideRaw = process.env.DISCOVER_CACHE_TTL_SECONDS;
    const override = overrideRaw != null && String(overrideRaw).trim() !== ''
        ? Number.parseInt(String(overrideRaw), 10)
        : null;
    if (Number.isFinite(override) && override > 0) {
        return Math.min(24 * 60 * 60, Math.max(60, override));
    }

    const rawHours = process.env.DISCOVER_SEED_BUCKET_HOURS;
    const parsed = rawHours != null && String(rawHours).trim() !== ''
        ? Number.parseInt(String(rawHours), 10)
        : 6;
    const hours = Number.isFinite(parsed) && parsed > 0 && parsed <= 24 ? parsed : 6;
    return Math.min(24 * 60 * 60, Math.max(10 * 60, hours * 60 * 60));
}

function isLegacyDiscoverFallbackEnabled() {
    const raw = String(process.env.PLAYLIST_DISCOVER_LEGACY_FALLBACK || '').trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tryAcquireDiscoverLock(redis, lockKey, ttlMs) {
    if (!redis) return { acquired: false, token: null };
    const token = crypto.randomBytes(16).toString('hex');
    try {
        const ok = await redis.set(lockKey, token, { NX: true, PX: ttlMs });
        return { acquired: ok === 'OK', token };
    } catch {
        return { acquired: false, token: null };
    }
}

async function releaseDiscoverLock(redis, lockKey, token) {
    if (!redis || !token) return;
    try {
        await redis.eval(
            'if redis.call("get",KEYS[1])==ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end',
            { keys: [lockKey], arguments: [token] }
        );
    } catch {
    }
}

async function waitForDiscoverCache(discoverSeed, maxWaitMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < maxWaitMs) {
        const cached = await readDiscoverCache(discoverSeed);
        if (cached) return cached;
        await sleep(150 + Math.floor(Math.random() * 150));
    }
    return null;
}

async function readDiscoverCache(discoverSeed) {
    const redis = await getRedisClient();
    if (!redis) return null;
    const key = `playlist-service:discover:v5:${discoverSeed}`;
    try {
        const raw = await redis.get(key);
        const parsed = safeJsonParse(raw);
        return isValidDiscoverResponse(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

async function writeDiscoverCache(discoverSeed, value) {
    const redis = await getRedisClient();
    if (!redis) return;
    const key = `playlist-service:discover:v5:${discoverSeed}`;
    try {
        await redis.set(key, JSON.stringify(value), { EX: computeDiscoverCacheTtlSeconds() });
    } catch {
    }
}

function chunkArray(items, chunkSize) {
    const safe = Array.isArray(items) ? items.filter(Boolean) : [];
    const size = Math.max(Number.parseInt(chunkSize, 10) || 0, 1);
    const chunks = [];
    for (let i = 0; i < safe.length; i += size) {
        chunks.push(safe.slice(i, i + size));
    }
    return chunks;
}

function deduplicateTracks(tracks, usedIds) {
    if (!usedIds || usedIds.size === 0) return tracks;
    return (Array.isArray(tracks) ? tracks : []).filter((t) => {
        const id = t?.id != null ? Number(t.id) : Number.NaN;
        return Number.isFinite(id) && !usedIds.has(id);
    });
}

function collectTrackIds(playlists, usedIds) {
    for (const pl of Array.isArray(playlists) ? playlists : []) {
        const tracks = Array.isArray(pl?.tracks) ? pl.tracks : [];
        for (const t of tracks) {
            const id = t?.id != null ? Number(t.id) : Number.NaN;
            if (Number.isFinite(id)) usedIds.add(id);
        }
    }
}

function safeIdPart(value) {
    const s = (value || '').toString().trim().toLowerCase();
    if (!s) return 'unknown';
    const normalized = s
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '');
    const out = normalized || 'unknown';
    return out.length > 48 ? out.slice(0, 48) : out;
}

function enforceArtistDiversity(tracks, maxPerArtist = 3) {
    if (!Array.isArray(tracks) || tracks.length === 0) return tracks;
    const byArtist = new Map();
    const overflow = [];
    for (const t of tracks) {
        const key = (t?.artist || '').toString().trim().toLowerCase();
        if (!key) { (byArtist.get('') || (byArtist.set('', []), byArtist.get(''))).push(t); continue; }
        if (!byArtist.has(key)) byArtist.set(key, []);
        const arr = byArtist.get(key);
        if (arr.length < maxPerArtist) {
            arr.push(t);
        } else {
            overflow.push(t);
        }
    }

    const buckets = [...byArtist.values()].filter((b) => b.length > 0);
    buckets.sort((a, b) => b.length - a.length);
    const result = [];
    let changed = true;
    while (changed) {
        changed = false;
        for (const bucket of buckets) {
            if (bucket.length > 0) {
                result.push(bucket.shift());
                changed = true;
            }
        }
    }
    return result.concat(overflow);
}

function buildChunkedPlaylists({
    discoverSeed,
    discoverKey,
    railType,
    baseId,
    baseTitle,
    description,
    tracks,
    chunkSize = 25,
    maxPlaylists = 2,
    minTracksPerPlaylist = 8,
    featuredFirst = false,
    titles,
}) {
    const diversified = enforceArtistDiversity(Array.isArray(tracks) ? tracks.filter(Boolean) : [], 3);
    const safeTracks = diversified;
    if (safeTracks.length < minTracksPerPlaylist) return [];

    const chunks = chunkArray(safeTracks, chunkSize)
        .slice(0, Math.max(1, Number.parseInt(maxPlaylists, 10) || 1))
        .filter((c) => Array.isArray(c) && c.length >= minTracksPerPlaylist);

    if (chunks.length === 0) return [];
    if (chunks.length === 1) {
        return [buildPlaylist({
            id: `${baseId}_${discoverKey}`,
            type: railType,
            title: baseTitle,
            description,
            tracks: chunks[0],
            isFeatured: featuredFirst,
        })];
    }

    const safeTitles = Array.isArray(titles) ? titles.filter(Boolean) : [];
    return chunks.map((chunk, idx) => {
        const fallbackTitle = idx === 0 ? baseTitle : `${baseTitle} • ${idx + 1}`;
        return buildPlaylist({
            id: `${baseId}_${discoverKey}_${idx + 1}`,
            type: railType,
            title: safeTitles[idx] || fallbackTitle,
            description,
            tracks: chunk,
            isFeatured: featuredFirst && idx === 0,
        });
    });
}

async function buildDiscoverRails(pool, { userId, seed }) {
    const discoverSeed = computeDiscoverSeed({ seed, userId });
    const discoverKey = hashToInt64(discoverSeed).toString(36);
    const userIdInt = Number.parseInt(String(userId || ''), 10);
    const personalized = Number.isFinite(userIdInt) && userIdInt > 0;

    const cached = personalized ? null : await readDiscoverCache(discoverSeed);
    if (cached) {
        return cached;
    }

    const redis = await getRedisClient();
    const lockKey = `playlist-service:discover:v5:lock:${discoverSeed}`;
    const lock = await tryAcquireDiscoverLock(redis, lockKey, 25_000);
    if (!lock.acquired && !personalized) {
        const waited = await waitForDiscoverCache(discoverSeed, 6_000);
        if (waited) return waited;
    }

    try {
        const cachedAfterLock = personalized ? null : await readDiscoverCache(discoverSeed);
        if (cachedAfterLock) {
            return cachedAfterLock;
        }

        const composed = await fetchHomeComposerRails({ userId, seed });
        if (composed) {
            if (!personalized) {
                await writeDiscoverCache(discoverSeed, composed);
            }
            return composed;
        }

        if (!isLegacyDiscoverFallbackEnabled()) {
            return { seed: discoverSeed, rails: [] };
        }

        const [popularSongs, newSongs, forYouSongs, topGenres, topArtists, topYears] = await Promise.all([
            fetchPopularSongs(pool, { userId, limit: 160, seed: discoverSeed }),
            fetchNewSongs(pool, { userId, limit: 160, seed: discoverSeed }),
            fetchForYouSongs(pool, { userId, limit: 160, seed: discoverSeed }),
            fetchTopGenres(pool, { userId, limit: 10 }),
            fetchTopArtists(pool, { userId, limit: 10 }),
            fetchTopYears(pool, { userId, limit: 8 }),
        ]);

        const rails = [];
        const usedTrackIds = new Set();

        // "Для вас" - персональные миксы
        if (forYouSongs.length > 0) {
            const playlists = buildChunkedPlaylists({
                discoverSeed,
                discoverKey,
                railType: 'for_you',
                baseId: 'for_you',
                baseTitle: 'Микс для вас',
                description: 'Персональная подборка',
                tracks: forYouSongs,
                chunkSize: 12,
                maxPlaylists: 8,
                minTracksPerPlaylist: 5,
                featuredFirst: true,
                titles: ['Микс для вас', 'Ещё для вас', 'Новые открытия', 'Специально для вас', 'В вашем вкусе', 'Новые грани', 'Случайные находки', 'Попробуйте это'],
            });

            if (playlists.length > 0) {
                collectTrackIds(playlists, usedTrackIds);
                rails.push(buildRail({
                    id: 'for_you',
                    title: 'Для вас',
                    playlists,
                }));
            }
        }

        // "Популярное" - топ треки
        const dedupPopular = deduplicateTracks(popularSongs, usedTrackIds);
        if (dedupPopular.length > 0) {
            const playlists = buildChunkedPlaylists({
                discoverSeed,
                discoverKey,
                railType: 'popular',
                baseId: 'popular',
                baseTitle: 'Топ треков',
                description: 'Популярное за 30 дней',
                tracks: dedupPopular,
                chunkSize: 12,
                maxPlaylists: 8,
                minTracksPerPlaylist: 5,
                titles: ['Топ треков', 'Хиты недели', 'Набирает обороты', 'Популярное сейчас', 'В тренде', 'Выбор слушателей', 'Горячие треки', 'Сейчас слушают'],
            });

            if (playlists.length > 0) {
                collectTrackIds(playlists, usedTrackIds);
                rails.push(buildRail({
                    id: 'popular',
                    title: 'Популярное',
                    playlists,
                }));
            }
        }

        // "Новинки" - свежие релизы
        const dedupNew = deduplicateTracks(newSongs, usedTrackIds);
        if (dedupNew.length > 0) {
            const playlists = buildChunkedPlaylists({
                discoverSeed,
                discoverKey,
                railType: 'new',
                baseId: 'new',
                baseTitle: 'Свежие релизы',
                description: 'Недавно добавленные треки',
                tracks: dedupNew,
                chunkSize: 12,
                maxPlaylists: 8,
                minTracksPerPlaylist: 5,
                titles: ['Свежие релизы', 'Новинки недели', 'Только что добавлено', 'Свежая музыка', 'Новые треки', 'Совсем недавно', 'Премьеры', 'Свежие находки'],
            });

            if (playlists.length > 0) {
                collectTrackIds(playlists, usedTrackIds);
                rails.push(buildRail({
                    id: 'new',
                    title: 'Новинки',
                    playlists,
                }));
            }
        }

        // "По жанрам" - плейлисты по жанрам (до 10 плейлистов, минимум 3 трека)
        if (Array.isArray(topGenres) && topGenres.length > 0) {
            const playlists = await Promise.all(topGenres.map(async (g) => {
                const genre = g.genre;
                const songs = await fetchSongsByGenre(pool, { userId, genre, limit: 20, seed: `${discoverSeed}:g:${genre}` });
                const dedupSongs = deduplicateTracks(songs, usedTrackIds);
                if (!dedupSongs || dedupSongs.length < 3) return null;
                return buildPlaylist({
                    id: `genre-${safeIdPart(genre)}_${discoverKey}`,
                    type: 'genre',
                    title: buildGenreTitle(genre),
                    description: `${dedupSongs.length} треков`,
                    tracks: dedupSongs,
                });
            }));

            const filtered = playlists.filter(Boolean);
            if (filtered.length > 0) {
                collectTrackIds(filtered, usedTrackIds);
                rails.push(buildRail({
                    id: 'genres',
                    title: 'По жанрам',
                    playlists: filtered,
                }));
            }
        }

        // "По артистам" - плейлисты по исполнителям (до 10 плейлистов, минимум 3 трека)
        if (Array.isArray(topArtists) && topArtists.length > 0) {
            const playlists = await Promise.all(topArtists.map(async (a) => {
                const artist = a.artist;
                const songs = await fetchSongsByArtist(pool, { userId, artist, limit: 20, seed: `${discoverSeed}:a:${artist}` });
                const dedupSongs = deduplicateTracks(songs, usedTrackIds);
                if (!dedupSongs || dedupSongs.length < 3) return null;
                return buildPlaylist({
                    id: `artist-${safeIdPart(artist)}_${discoverKey}`,
                    type: 'artist',
                    title: `Это ${artist}`,
                    description: `${dedupSongs.length} треков`,
                    tracks: dedupSongs,
                });
            }));

            const filtered = playlists.filter(Boolean);
            if (filtered.length > 0) {
                collectTrackIds(filtered, usedTrackIds);
                rails.push(buildRail({
                    id: 'artists',
                    title: 'По артистам',
                    playlists: filtered,
                }));
            }
        }

        // "По годам" - плейлисты по годам (до 8 плейлистов, минимум 3 трека)
        if (Array.isArray(topYears) && topYears.length > 0) {
            const playlists = await Promise.all(topYears.map(async (y) => {
                const year = y.year;
                const songs = await fetchSongsByYear(pool, { userId, year, limit: 20, seed: `${discoverSeed}:y:${year}` });
                const dedupSongs = deduplicateTracks(songs, usedTrackIds);
                if (!dedupSongs || dedupSongs.length < 3) return null;
                return buildPlaylist({
                    id: `year_${year}_${discoverKey}`,
                    type: 'year',
                    title: `${year}`,
                    description: `${dedupSongs.length} треков`,
                    tracks: dedupSongs,
                });
            }));

            const filtered = playlists.filter(Boolean);
            if (filtered.length > 0) {
                collectTrackIds(filtered, usedTrackIds);
                rails.push(buildRail({
                    id: 'years',
                    title: 'По годам',
                    playlists: filtered,
                }));
            }
        }

        const moods = [
            { key: 'workout', title: 'Заряд энергии', minTracks: 3 },
            { key: 'party', title: 'Танцпол', minTracks: 3 },
            { key: 'chill', title: 'Чилл', minTracks: 3 },
            { key: 'sad', title: 'Грустно', minTracks: 3 },
            { key: 'happy', title: 'На позитиве', minTracks: 3 },
            { key: 'focus', title: 'Фокус', minTracks: 3 },
        ];

        const moodResults = await Promise.all(moods.map(async (spec) => {
            const songs = await fetchMoodSongs(pool, {
                userId,
                mood: spec.key,
                limit: 20,
                seed: `${discoverSeed}:m:${spec.key}`,
            });
            const dedupSongs = deduplicateTracks(songs, usedTrackIds);
            if (!dedupSongs || dedupSongs.length < spec.minTracks) return null;
            return buildPlaylist({
                id: `mood_${spec.key}_${discoverKey}`,
                type: 'mood',
                title: spec.title,
                description: `${dedupSongs.length} треков`,
                tracks: dedupSongs,
            });
        }));

        const moodPlaylists = moodResults.filter(Boolean);

        if (moodPlaylists.length > 0) {
            rails.push(buildRail({
                id: 'moods',
                title: 'По настроению',
                playlists: moodPlaylists,
            }));
        }

        const result = {
            seed: discoverSeed,
            rails,
        };

        if (!personalized) {
            await writeDiscoverCache(discoverSeed, result);
        }
        return result;
    } finally {
        if (lock.acquired) {
            await releaseDiscoverLock(redis, lockKey, lock.token);
        }
    }
}

module.exports = {
    buildDiscoverRails,
};
