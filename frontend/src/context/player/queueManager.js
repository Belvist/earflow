import { useCallback, useEffect, useMemo, useRef } from 'react';
import { QUEUE_SOURCES } from './constants';
import { validateTrack } from './security';

/**
 * Manages the playback queue, shuffle state, and source switching.
 */
export const useQueueManager = (state, { songs, formatSongsForPlayer, recommendations }) => {
    const {
        currentTrackIndex,
        setCurrentTrackIndex,
        syncQueueSnapshot,
        queueTracks,
        queueSource,
        setQueueSource,
        setQueueName,
        customQueue,
        setCustomQueue,
        setCustomQueueMeta,
        likedTracks,
        dislikedIds,
        setShuffleEnabled,
        setShuffleOrder,
        setIsPlaying,
    } = state;

    const lastPositionBySourceRef = useRef(new Map());
    const lastSnapshotSourceRef = useRef(queueSource);

    const isAppendOnlyQueueUpdate = useCallback((previousTracks, nextTracks) => {
        if (!Array.isArray(previousTracks) || !Array.isArray(nextTracks)) return false;
        if (previousTracks.length === 0) return true;
        if (nextTracks.length < previousTracks.length) return false;

        for (let i = 0; i < previousTracks.length; i += 1) {
            const prevId = previousTracks[i]?.id != null ? String(previousTracks[i].id) : '';
            const nextId = nextTracks[i]?.id != null ? String(nextTracks[i].id) : '';
            if (!prevId || prevId !== nextId) return false;
        }

        return true;
    }, []);

    const haveSameTrackIds = useCallback((leftTracks, rightTracks) => {
        const left = Array.isArray(leftTracks) ? leftTracks : [];
        const right = Array.isArray(rightTracks) ? rightTracks : [];
        if (left.length !== right.length) return false;
        for (let i = 0; i < left.length; i += 1) {
            const leftId = left[i]?.id != null ? String(left[i].id) : '';
            const rightId = right[i]?.id != null ? String(right[i].id) : '';
            if (leftId !== rightId) return false;
        }
        return true;
    }, []);

    const libraryTracks = useMemo(
        () => formatSongsForPlayer(songs || []).map(validateTrack).filter(Boolean),
        [songs, formatSongsForPlayer]
    );

    const recommendationTracks = useMemo(
        () => {
            const all = formatSongsForPlayer(recommendations?.tracks || []).map(validateTrack).filter(Boolean);
            if (!dislikedIds || dislikedIds.size === 0) return all;
            return all.filter((t) => {
                const tid = t?.id != null ? Number.parseInt(String(t.id), 10) : Number.NaN;
                return !(Number.isFinite(tid) && dislikedIds.has(tid));
            });
        },
        [recommendations?.tracks, formatSongsForPlayer, dislikedIds]
    );

    const likedQueueTracks = useMemo(
        () => (Array.isArray(likedTracks) ? likedTracks : []).map(validateTrack).filter(Boolean),
        [likedTracks]
    );

    const customQueueTracks = useMemo(
        () => (Array.isArray(customQueue) ? customQueue : []).map(validateTrack).filter(Boolean),
        [customQueue]
    );

    const effectiveTracks = useMemo(() => {
        switch (queueSource) {
            case QUEUE_SOURCES.AUTO:
                return recommendationTracks;
            case QUEUE_SOURCES.LIBRARY:
                return libraryTracks;
            case QUEUE_SOURCES.LIKED:
                return likedQueueTracks;
            case QUEUE_SOURCES.CUSTOM:
                return customQueueTracks.length > 0 ? customQueueTracks : libraryTracks;
            default:
                return libraryTracks;
        }
    }, [queueSource, recommendationTracks, libraryTracks, likedQueueTracks, customQueueTracks]);

    const candidateTracks = effectiveTracks;
    const candidateIdsKey = useMemo(() => {
        if (!Array.isArray(candidateTracks) || candidateTracks.length === 0) return '';
        return candidateTracks.map((t) => (t && t.id != null ? String(t.id) : '')).filter(Boolean).join(',');
    }, [candidateTracks]);

    const effectiveSnapshotTracks = useMemo(() => {
        const snap = Array.isArray(queueTracks) ? queueTracks : [];
        if (snap.length > 0) return snap;
        return candidateTracks;
    }, [candidateTracks, queueTracks]);

    const currentTrack = useMemo(
        () => effectiveSnapshotTracks[currentTrackIndex] || null,
        [effectiveSnapshotTracks, currentTrackIndex]
    );

    useEffect(() => {
        const source = queueSource;
        const idxRaw = Number(currentTrackIndex);
        const idx = Number.isFinite(idxRaw) ? Math.max(0, Math.floor(idxRaw)) : 0;
        const trackId = currentTrack && currentTrack.id != null ? String(currentTrack.id) : '';
        if (!source || !trackId) return;
        lastPositionBySourceRef.current.set(source, { trackId, index: idx });
    }, [queueSource, currentTrackIndex, currentTrack]);

    useEffect(() => {
        if (typeof syncQueueSnapshot !== 'function') return;
        const next = Array.isArray(candidateTracks) ? candidateTracks : [];
        const hasNext = next.length > 0;
        const hasExisting = Array.isArray(queueTracks) && queueTracks.length > 0;
        if (!hasNext && hasExisting) return;

        const previousSource = lastSnapshotSourceRef.current;
        const sourceChanged = previousSource !== queueSource;
        lastSnapshotSourceRef.current = queueSource;

        if (
            queueSource === QUEUE_SOURCES.AUTO
            && hasExisting
            && hasNext
            && !sourceChanged
            && !isAppendOnlyQueueUpdate(queueTracks, next)
        ) {
            const idxRaw = Number(currentTrackIndex);
            const currentIdx = Number.isFinite(idxRaw)
                ? Math.max(0, Math.min(Math.floor(idxRaw), queueTracks.length - 1))
                : 0;
            const preserved = queueTracks.slice(0, currentIdx + 1);
            const preservedIds = new Set(
                preserved
                    .map((track) => (track?.id != null ? String(track.id) : ''))
                    .filter(Boolean)
            );
            const nextTail = next.filter((track) => {
                const id = track?.id != null ? String(track.id) : '';
                return id && !preservedIds.has(id);
            });
            const merged = [...preserved, ...nextTail];
            if (!haveSameTrackIds(queueTracks, merged)) {
                syncQueueSnapshot(merged);
            }
            return;
        }

        if (haveSameTrackIds(queueTracks, next)) return;
        syncQueueSnapshot(next);
    }, [candidateIdsKey, candidateTracks, currentTrackIndex, queueSource, queueTracks, syncQueueSnapshot, isAppendOnlyQueueUpdate, haveSameTrackIds]);

    const generateShuffleOrder = useCallback((length, currentIdx = 0) => {
        const indices = Array.from({ length }, (_, i) => i);
        for (let i = indices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [indices[i], indices[j]] = [indices[j], indices[i]];
        }
        if (currentIdx >= 0 && currentIdx < length) {
            const currentPos = indices.indexOf(currentIdx);
            if (currentPos !== 0) {
                [indices[0], indices[currentPos]] = [indices[currentPos], indices[0]];
            }
        }
        return indices;
    }, []);

    const toggleShuffle = useCallback(() => {
        setShuffleEnabled((prev) => {
            const newValue = !prev;
            if (newValue && effectiveTracks.length > 0) {
                setShuffleOrder(generateShuffleOrder(effectiveTracks.length, currentTrackIndex));
            } else {
                setShuffleOrder([]);
            }
            return newValue;
        });
    }, [effectiveTracks.length, currentTrackIndex, generateShuffleOrder, setShuffleEnabled, setShuffleOrder]);

    const autoSwitchRefreshInFlightRef = useRef(false);
    const lastAutoSwitchRefreshAtRef = useRef(0);

    const switchToRecommendationsQueue = useCallback(async () => {
        const refreshRecommendations = recommendations?.refreshRecommendations;
        const hasRecoTracks = Array.isArray(recommendations?.tracks) && recommendations.tracks.length > 0;
        const now = Date.now();
        const remembered = lastPositionBySourceRef.current.get(QUEUE_SOURCES.AUTO) || null;
        const shouldRefreshOnReturn =
            queueSource !== QUEUE_SOURCES.AUTO
            && hasRecoTracks
            && typeof refreshRecommendations === 'function'
            && recommendations?.loading !== true
            && !autoSwitchRefreshInFlightRef.current
            && now - lastAutoSwitchRefreshAtRef.current >= 15000;

        const shouldRefresh =
            typeof refreshRecommendations === 'function'
            && recommendations?.loading !== true
            && (!hasRecoTracks || shouldRefreshOnReturn);

        const resolveRecommendationTracks = (tracks) => {
            return formatSongsForPlayer(tracks || [])
                .map(validateTrack)
                .filter(Boolean);
        };

        let nextRecommendationTracks = recommendationTracks;

        if (shouldRefresh) {
            try {
                autoSwitchRefreshInFlightRef.current = true;
                lastAutoSwitchRefreshAtRef.current = now;
                const refreshedTracks = await refreshRecommendations(false);
                if (Array.isArray(refreshedTracks) && refreshedTracks.length > 0) {
                    nextRecommendationTracks = resolveRecommendationTracks(refreshedTracks);
                }
            } catch {
            } finally {
                autoSwitchRefreshInFlightRef.current = false;
            }
        }

        if (nextRecommendationTracks.length <= 0) {
            return;
        }

        setQueueSource(QUEUE_SOURCES.AUTO);
        setQueueName('Recommendations');
        setCustomQueue([]);
        setCustomQueueMeta(null);

        if (queueSource === QUEUE_SOURCES.AUTO) {
            return;
        }

        const currentId = currentTrack && currentTrack.id != null ? String(currentTrack.id) : '';
        if (queueSource !== QUEUE_SOURCES.AUTO && nextRecommendationTracks.length > 0) {
            const firstDifferent = nextRecommendationTracks.findIndex((t) => String(t?.id ?? '') !== currentId);
            setCurrentTrackIndex(firstDifferent >= 0 ? firstDifferent : 0);
            return;
        }

        if (currentId) {
            const idx = nextRecommendationTracks.findIndex((t) => String(t?.id ?? '') === currentId);
            if (idx >= 0) {
                setCurrentTrackIndex(idx);
                return;
            }
        }

        const rememberedTrackId = remembered && typeof remembered.trackId === 'string' ? remembered.trackId : '';
        if (rememberedTrackId) {
            const idx = nextRecommendationTracks.findIndex((t) => String(t?.id ?? '') === rememberedTrackId);
            if (idx >= 0) {
                setCurrentTrackIndex(idx);
                return;
            }
        }

        const rememberedIndexRaw = remembered && remembered.index != null ? Number(remembered.index) : Number.NaN;
        if (Number.isFinite(rememberedIndexRaw) && nextRecommendationTracks.length > 0) {
            const idx = Math.max(0, Math.min(Math.floor(rememberedIndexRaw), nextRecommendationTracks.length - 1));
            setCurrentTrackIndex(idx);
            return;
        }

        try {
            const lastTrackId = typeof localStorage !== 'undefined' ? localStorage.getItem('lastTrackId') : null;
            if (lastTrackId) {
                const idx = nextRecommendationTracks.findIndex((t) => String(t?.id ?? '') === String(lastTrackId));
                if (idx >= 0) {
                    setCurrentTrackIndex(idx);
                    return;
                }
            }
        } catch {
        }

        const safeIdx = Math.max(0, Math.min(currentTrackIndex, Math.max(0, nextRecommendationTracks.length - 1)));
        setCurrentTrackIndex(safeIdx);
    }, [currentTrack, currentTrackIndex, formatSongsForPlayer, queueSource, recommendationTracks, recommendations, setCurrentTrackIndex, setCustomQueue, setCustomQueueMeta, setQueueName, setQueueSource]);

    const switchToLibraryQueue = useCallback(() => {
        setQueueSource(QUEUE_SOURCES.LIBRARY);
        setQueueName('My Tracks');
        setCustomQueue([]);
        setCustomQueueMeta(null);
        if (queueSource === QUEUE_SOURCES.LIBRARY) {
            return;
        }

        const currentId = currentTrack?.id != null ? String(currentTrack.id) : '';
        if (currentId) {
            const idx = libraryTracks.findIndex((t) => String(t?.id ?? '') === currentId);
            if (idx >= 0) {
                setCurrentTrackIndex(idx);
                return;
            }
        }

        try {
            const lastTrackId = typeof localStorage !== 'undefined' ? localStorage.getItem('lastTrackId') : null;
            if (lastTrackId) {
                const idx = libraryTracks.findIndex((t) => String(t?.id ?? '') === String(lastTrackId));
                if (idx >= 0) {
                    setCurrentTrackIndex(idx);
                    return;
                }
            }
        } catch {
        }

        setCurrentTrackIndex(0);
    }, [currentTrack, libraryTracks, queueSource, setQueueSource, setQueueName, setCustomQueue, setCustomQueueMeta, setCurrentTrackIndex]);

    const switchToLikedQueue = useCallback(() => {
        setQueueSource(QUEUE_SOURCES.LIKED);
        setQueueName('Liked');
        setCustomQueue([]);
        setCustomQueueMeta(null);
        if (queueSource === QUEUE_SOURCES.LIKED) {
            return;
        }

        const currentId = currentTrack?.id != null ? String(currentTrack.id) : '';
        if (currentId) {
            const idx = likedQueueTracks.findIndex((t) => String(t?.id ?? '') === currentId);
            if (idx >= 0) {
                setCurrentTrackIndex(idx);
                return;
            }
        }

        try {
            const lastTrackId = typeof localStorage !== 'undefined' ? localStorage.getItem('lastTrackId') : null;
            if (lastTrackId) {
                const idx = likedQueueTracks.findIndex((t) => String(t?.id ?? '') === String(lastTrackId));
                if (idx >= 0) {
                    setCurrentTrackIndex(idx);
                    return;
                }
            }
        } catch {
        }

        setCurrentTrackIndex(0);
    }, [currentTrack, likedQueueTracks, queueSource, setQueueSource, setQueueName, setCustomQueue, setCustomQueueMeta, setCurrentTrackIndex]);

    const playPlaylist = useCallback((playlistTracks, playlistName, meta = null) => {
        if (!playlistTracks?.length) return;
        const formatted = formatSongsForPlayer(playlistTracks);
        if (!formatted.length) return;
        setCustomQueue(formatted);
        const playlistId = meta && meta.playlistId != null ? String(meta.playlistId) : null;
        setCustomQueueMeta(playlistId ? { type: 'playlist', playlistId } : null);
        setQueueSource(QUEUE_SOURCES.CUSTOM);
        setQueueName(playlistName || 'Playlist');
        setCurrentTrackIndex(0);
        setIsPlaying(true);
    }, [formatSongsForPlayer, setCustomQueue, setCustomQueueMeta, setQueueSource, setQueueName, setCurrentTrackIndex, setIsPlaying]);

    return {
        libraryTracks,
        recommendationTracks,
        likedQueueTracks,
        effectiveTracks: effectiveSnapshotTracks,
        currentTrack,
        toggleShuffle,
        switchToRecommendationsQueue,
        switchToLibraryQueue,
        switchToLikedQueue,
        playPlaylist,
    };
};
