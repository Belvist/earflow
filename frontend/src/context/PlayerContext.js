import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import useSongs from '../hooks/useSongs';
import { useRecommendations } from '../hooks/useRecommendations';
import apiClient from '../api/client';

import { usePlaybackConnectorBridge } from '../playback/usePlaybackConnectorBridge';
import { DEFAULT_PROTOCOL_POLICY } from '../playback/ProtocolPolicy';
import { usePlayerStore } from '../hooks/usePlayerStore';

import { usePlayerState as usePlayerInternalState } from './player/playerState';
import { useAudioEngine } from './player/audioEngine';
import { useQueueManager } from './player/queueManager';
import { useFeedbackManager } from './player/feedbackManager';
import { usePartyManager } from './player/partyManager';
import { usePartyPlaybackBridge } from './player/usePartyPlaybackBridge';
import { useHlsPrefetch } from './player/useHlsPrefetch';
import { useDirectPrefetch } from './player/useDirectPrefetch';
import { usePlayerTelemetry } from './player/usePlayerTelemetry';
import { useMediaSession, applyMediaSessionMetadataEager, markExternalMediaSessionSeekAtNow } from './player/mediaSession';
import { useMediaSessionSync } from './player/useMediaSessionSync';
import { useIosProcessedSinkRemoteSync } from './player/useIosProcessedSinkRemoteSync';
import { useMultiTabGuard } from './player/useMultiTabGuard';
import { subscribePlaylistChanged } from '../utils/playlistLiveUpdate';
import { formatTime, resolveTrackDurationSeconds } from './player/playbackRateUtils';
import { validateTrack } from './player/security';
import { redirectToAuth, buildReturnToFromCurrentLocation } from '../utils/authRedirect';

import { PlayerCore } from '../player-core/PlayerCore';
import { PlayerStore } from '../player-core/PlayerStore';
import { QueueManager } from '../player-core/QueueManager';
import { loadInitFromLocalStorage, persistField } from '../player-core/PlayerStorePersistence';
import { PlayerTimeTracker } from '../player-core/PlayerTimeTracker';
import { TrackPrefetcher } from '../player-core/TrackPrefetcher';
import { useQueueAutoRefill } from './player/useQueueAutoRefill';
import { useDisplayTrackDuringTransition } from './player/useDisplayTrackDuringTransition';
import { lyricsCache } from '../services/lyricsCache';
import { PlaybackConnector } from '../playback/PlaybackConnector';
import { LOCAL_OUTPUT_STATES, normalizeLocalOutputState } from '../playback/localOutputState';
import { isIosSafari } from '../utils/platform';

/**
 * Контексты экспортируются для использования в playground / тестах,
 * чтобы можно было предоставить fake values без полного PlayerProvider
 * (который тащит за собой audio engine, recommendations, queue manager и т.д.).
 * В production - не используются напрямую, только через usePlayer*() hooks.
 */
export const PlayerStateContext = createContext();
export const PlayerProgressContext = createContext();
export const PlayerDispatchContext = createContext();
export const PlayerStoreContext = createContext(null);

export const usePlayerState = () => {
  const context = useContext(PlayerStateContext);
  if (!context) {
    throw new Error('usePlayerState must be used within PlayerProvider');
  }
  return context;
};

export const usePlayerProgress = () => {
  const context = useContext(PlayerProgressContext);
  if (!context) {
    throw new Error('usePlayerProgress must be used within PlayerProvider');
  }
  return context;
};

export const usePlayerDispatch = () => {
  const context = useContext(PlayerDispatchContext);
  if (!context) {
    throw new Error('usePlayerDispatch must be used within PlayerProvider');
  }
  return context;
};

/**
 * @returns {object}
 */
export const usePlayerStoreContext = () => useContext(PlayerStoreContext);

export const usePlayer = () => {
  const state = usePlayerState();
  const progress = usePlayerProgress();
  const dispatch = usePlayerDispatch();
  return useMemo(() => ({ ...state, ...progress, ...dispatch }), [state, progress, dispatch]);
};

/**
 * @param {object} props
 * @returns {JSX.Element}
 */
export const PlayerProvider = ({
  children,
  isAuthenticated,
  user,
  autoLoadLibrary = true,
  autoLoadRecommendations = true,
  autoLoadFeedback = true,
  onAuthDegraded,
}) => {
  const { songs, formatSongsForPlayer, loadSongs } = useSongs(Boolean(isAuthenticated && autoLoadLibrary));

  const state = usePlayerInternalState(user);
  const {
    setEqGains,
    setEqEnabled,
    setVolume,
    setPlaybackRate: setPlaybackRateState,
    setPreservePitch: setPreservePitchState,
    currentTimeRef,
  } = state;
  const audioRef = state.audioRef;
  const userWantsPlaybackRef = state.userWantsPlaybackRef;
  const setIsPlaying = state.setIsPlaying;
  const [localOutputState, setLocalOutputStateRaw] = useState(LOCAL_OUTPUT_STATES.IDLE);
  const setLocalOutputState = useCallback((next) => {
    setLocalOutputStateRaw((prev) => normalizeLocalOutputState(next, prev));
  }, []);
  const localOutputStateRef = useRef(localOutputState);
  useEffect(() => {
    localOutputStateRef.current = localOutputState;
  }, [localOutputState]);
  const shouldSyncConnectorIsPlaying = useCallback(() => {
    const outputState = String(localOutputStateRef.current || LOCAL_OUTPUT_STATES.ACTIVE).toUpperCase();
    return outputState === LOCAL_OUTPUT_STATES.ACTIVE || outputState === LOCAL_OUTPUT_STATES.BUFFERING;
  }, []);
  const currentTrackIndex = state.currentTrackIndex;
  const setCurrentTrackIndex = state.setCurrentTrackIndex;
  const repeatMode = state.repeatMode;
  // Ref mirror of repeatMode so PlayerCore can always read the latest value
  // via closure without forcing buildPlayerCoreDeps() to re-run on every
  // repeat-mode click (which would cascade into PlayerCore.setDeps and
  // risk tearing down audio-element event listeners / restarting playback).
  const repeatModeRef = useRef(repeatMode);
  useEffect(() => { repeatModeRef.current = repeatMode; }, [repeatMode]);
  const setQueueSource = state.setQueueSource;
  const setQueueName = state.setQueueName;
  const setCustomQueue = state.setCustomQueue;
  const setCustomQueueMeta = state.setCustomQueueMeta;
  const syncQueueSnapshot = state.syncQueueSnapshot;
  const recommendations = useRecommendations(isAuthenticated ? state.userId : null, {
    autoInitialize: Boolean(autoLoadRecommendations),
    onAuthDegraded,
  });

  const applyLikedTracks = useCallback((liked) => {
    const tracks = Array.isArray(liked) ? liked : [];
    state.setLikedTracks(tracks);
    state.setLikedIds(new Set(tracks.map((t) => {
      const tid = t?.id != null ? Number.parseInt(String(t.id), 10) : Number.NaN;
      return Number.isFinite(tid) && tid > 0 ? tid : null;
    }).filter(Boolean)));
  }, [state.setLikedTracks, state.setLikedIds]);

  useEffect(() => {
    if (!autoLoadFeedback || !isAuthenticated || !state.userId) return;
    let cancelled = false;
    const ctrl = new AbortController();
    apiClient.getLikes({ signal: ctrl.signal })
      .then((liked) => {
        if (cancelled) return;
        applyLikedTracks(liked);
      })
      .catch(() => { });
    apiClient.getDislikes({ signal: ctrl.signal })
      .then((disliked) => {
        if (cancelled) return;
        const list = Array.isArray(disliked) ? disliked : [];
        state.setDislikedIds(new Set(list.map((t) => {
          const tid = t?.id != null ? Number.parseInt(String(t.id), 10) : Number.NaN;
          return Number.isFinite(tid) && tid > 0 ? tid : null;
        }).filter(Boolean)));
      })
      .catch(() => { });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [autoLoadFeedback, isAuthenticated, state.userId, applyLikedTracks]); // eslint-disable-line react-hooks/exhaustive-deps

  const audioEngine = useAudioEngine(state, state.userSettings);
  const restoreAudioVolumeRef = useRef(null);
  restoreAudioVolumeRef.current = audioEngine.restoreAudioVolume;
  const applyEqSettingsRef = useRef(null);
  applyEqSettingsRef.current = audioEngine.applyEqSettings;
  const queueManager = useQueueManager(state, { songs, formatSongsForPlayer, recommendations });

  useEffect(() => {
    const qm = queueManagerRef.current;
    if (!qm) return;
    qm.setDeps({
      store: playerStoreRef.current,
      setCurrentTrackIndex,
      setQueueSource,
      setQueueName,
      setCustomQueue,
      setCustomQueueMeta,
      syncQueueSnapshot,
      setShuffleEnabled: state.setShuffleEnabled,
      setShuffleOrder: state.setShuffleOrder,
      setIsPlaying,
    });
  }, [setCurrentTrackIndex, setQueueSource, setQueueName, setCustomQueue, setCustomQueueMeta, syncQueueSnapshot, state.setShuffleEnabled, state.setShuffleOrder, setIsPlaying]);

  useEffect(() => {
    const qm = queueManagerRef.current;
    if (!qm) return;
    qm.setLibraryTracks(queueManager.libraryTracks);
    qm.setRecommendationTracks(queueManager.recommendationTracks);
    qm.setLikedTracks(queueManager.likedQueueTracks);
    qm.setSnapshotTracks(queueManager.effectiveTracks);
  }, [queueManager.libraryTracks, queueManager.recommendationTracks, queueManager.likedQueueTracks, queueManager.effectiveTracks]);

  const ensureAudioActivated = useCallback(() => {
    try {
      if (state.userGestureEverRef) {
        state.userGestureEverRef.current = true;
      }
    } catch {
    }
    try {
      audioEngine.ensureAudioContext(true);
    } catch {
    }
    try {
      audioEngine.rebuildGraph();
    } catch {
    }
  }, [audioEngine, state.userGestureEverRef]);

  const playbackConnectorRef = useRef(null);
  const resumeHintRef = useRef(null);
  const playerStoreRef = useRef(null);
  if (!playerStoreRef.current) playerStoreRef.current = new PlayerStore(loadInitFromLocalStorage());
  const storeSnapshot = usePlayerStore(playerStoreRef.current);

  const queueManagerRef = useRef(null);
  if (!queueManagerRef.current) {
    queueManagerRef.current = new QueueManager({
      store: playerStoreRef.current,
      setCurrentTrackIndex,
      setQueueSource,
      setQueueName,
      setCustomQueue,
      setCustomQueueMeta,
      syncQueueSnapshot,
      setShuffleEnabled: state.setShuffleEnabled,
      setShuffleOrder: state.setShuffleOrder,
      setIsPlaying,
    });
  }
  const playerTimeTrackerRef = useRef(null);
  if (!playerTimeTrackerRef.current) playerTimeTrackerRef.current = new PlayerTimeTracker();
  const prefetcherRef = useRef(null);
  if (!prefetcherRef.current) {
    prefetcherRef.current = new TrackPrefetcher({
      getCoverUrl: (track) => { try { return apiClient.getCoverUrl(track) || ''; } catch { return ''; } },
      requestLyrics: (sid) => { try { lyricsCache.request(sid); } catch { } },
    });
  }

  const [audioElementKey, setAudioElementKey] = useState(0);
  const lastHardResetAtRef = useRef(0);

  const hardResetAudioPipeline = useCallback(async (reason = 'unknown') => {
    void reason;
    if (!isIosSafari()) return;
    if (typeof window === 'undefined') return;

    const bg = typeof document !== 'undefined' && document.hidden;

    if (bg && !userWantsPlaybackRef?.current) return;

    const hasActivation =
      !!state.userGestureEverRef?.current ||
      (typeof navigator !== 'undefined' && (navigator.userActivation?.hasBeenActive || navigator.userActivation?.isActive));
    if (!hasActivation) return;

    const now = Date.now();
    const last = Number(lastHardResetAtRef.current || 0);
    const cooldownMs = bg ? 10_000 : 3000;
    if (now - last < cooldownMs) return;
    lastHardResetAtRef.current = now;

    const prevAudio = audioRef?.current || null;

    const c = playbackConnectorRef.current;
    playbackConnectorRef.current = null;
    if (c) {
      try {
        await c.stop({ clearTrack: true });
      } catch {
      }
    }

    if (prevAudio) {
      try { prevAudio.pause(); } catch { }
      try { prevAudio.removeAttribute('src'); } catch { }
      try { prevAudio.load(); } catch { }
    }

    setAudioElementKey((k) => (Number.isFinite(Number(k)) ? Number(k) + 1 : 1));

    await new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        const cur = audioRef?.current || null;
        if (cur && cur !== prevAudio) {
          resolve();
          return;
        }
        if (Date.now() - start > 1500) {
          resolve();
          return;
        }
        const useFallback = bg || typeof window.requestAnimationFrame !== 'function';
        if (useFallback) {
          window.setTimeout(tick, 50);
        } else {
          try {
            window.requestAnimationFrame(tick);
          } catch {
            window.setTimeout(tick, 16);
          }
        }
      };
      tick();
    });

    try {
      audioEngine.ensureAudioContext(false);
    } catch {
    }
    try {
      audioEngine.rebuildGraph();
    } catch {
    }
  }, [audioEngine, audioRef]);

  const getOrCreateConnector = useCallback(() => {
    if (playbackConnectorRef.current) return playbackConnectorRef.current;

    const audio = audioRef?.current;
    if (!audio) return null;

    try {
      playbackConnectorRef.current = new PlaybackConnector({
        apiClient,
        audio,
        getDestinationNode: () => undefined,
      });
    } catch {
      playbackConnectorRef.current = null;
    }

    return playbackConnectorRef.current;
  }, [audioRef]);

  const buildPlayerCoreDeps = useCallback(() => ({
    queue: {
      getTracks: () => queueManager.effectiveTracks || [],
      getIndex: () => currentTrackIndex,
      setIndex: (idx) => setCurrentTrackIndex(idx),
      getRepeatMode: () => repeatModeRef.current,
    },
    settings: {
      getAutoplayEnabled: () => state.userSettings?.autoplay_enabled !== false,
    },
    queueControl: {
      setQueueSource: (src) => setQueueSource(src),
      setQueueName: (name) => setQueueName(name),
      setCustomQueue: (tracks) => setCustomQueue(Array.isArray(tracks) ? tracks : []),
      setCustomQueueMeta: (meta) => setCustomQueueMeta(meta ?? null),
      syncQueueSnapshot: (tracks) => syncQueueSnapshot(Array.isArray(tracks) ? tracks : []),
    },
    intent: {
      getWanted: () => !!userWantsPlaybackRef?.current,
      setWanted: (wanted) => {
        if (userWantsPlaybackRef) {
          userWantsPlaybackRef.current = !!wanted;
        }
        setIsPlaying(!!wanted);
      },
      setSeeking: (seeking) => {
        const v = !!seeking;
        if (state.isSeekingRef) {
          state.isSeekingRef.current = v;
        }
        state.setIsSeeking(v);
      },
    },
    audio: {
      ensureAudioContext: (requiresGesture) => audioEngine.ensureAudioContext(!!requiresGesture),
      rebuildGraph: () => audioEngine.rebuildGraph(),
      primeFadeFromSilence: audioEngine.primeFadeFromSilence,
      fadeIn: audioEngine.fadeIn,
      fadeOut: audioEngine.fadeOut,
      setSwitchingUntil: (untilMs) => {
        const ref = state.switchingUntilRef;
        if (ref) ref.current = (typeof untilMs === 'number' && untilMs > 0) ? untilMs : 0;
      },
      applyMetadataEager: (track) => {
        try { applyMediaSessionMetadataEager(track, state.queueName || ''); } catch { }
      },
    },
    playback: {
      getActiveTrackId: () => {
        const c = getOrCreateConnector();
        const sid = c?.getActiveTrackId?.();
        if (sid) return String(sid);
        return c?.getTrack()?.id ? String(c.getTrack().id) : null;
      },
      getProtocol: () => {
        const c = getOrCreateConnector();
        const p = c?.getProtocol?.();
        return p || null;
      },
      play: async (track, options) => {
        const c = getOrCreateConnector();
        if (!c) throw new Error('NO_CONNECTOR');
        const startAtSecondsRaw = options && typeof options === 'object' ? options.startAtSeconds : undefined;
        const startAtSecondsNum = Number(startAtSecondsRaw);
        const startAtSecondsExplicit = Number.isFinite(startAtSecondsNum) && startAtSecondsNum > 0 ? startAtSecondsNum : null;

        const hint = resumeHintRef.current;
        const hintTrackId = hint && typeof hint.trackId === 'string' ? hint.trackId : '';
        const hintPosNum = hint && typeof hint.positionSeconds === 'number' ? hint.positionSeconds : Number.NaN;
        const hintPos = Number.isFinite(hintPosNum) && hintPosNum > 0 ? hintPosNum : null;
        const trackId = track?.id != null ? String(track.id) : '';
        const startAtSeconds = startAtSecondsExplicit != null
          ? startAtSecondsExplicit
          : (hintTrackId && hintPos != null && trackId && hintTrackId === trackId ? hintPos : null);

        if (trackId && hintTrackId === trackId) {
          resumeHintRef.current = null;
        }

        await c.play(track, startAtSeconds != null ? { startAtSeconds } : undefined);
      },
      resume: async () => {
        const c = getOrCreateConnector();
        if (!c) throw new Error('NO_CONNECTOR');
        await c.resume();
      },
      pause: async () => {
        const c = getOrCreateConnector();
        if (!c) throw new Error('NO_CONNECTOR');
        await c.pause();
      },
      seek: async (seconds) => {
        const c = getOrCreateConnector();
        if (!c) throw new Error('NO_CONNECTOR');
        await c.seek(seconds);
      },
      hardReset: async (reason) => {
        await hardResetAudioPipeline(String(reason || 'unknown').slice(0, 64));
      },
    },
    catalog: {
      fetchTrackById: async (id, signal) => {
        const safeId = id ? String(id) : '';
        if (!safeId) return null;
        let fetched;
        try {
          fetched = await apiClient.request(`/api/songs/${encodeURIComponent(safeId)}`, { signal });
        } catch {
          return null;
        }
        const validated = validateTrack(fetched);
        return validated || null;
      },
    },
    auth: {
      isAuthenticated: () => !!isAuthenticated,
    },
    store: playerStoreRef.current,
    onQueueExhausted: async () => {
      if (state.queueSource !== 'custom') return null;
      const tracks = queueManager.effectiveTracks || [];
      const idx = currentTrackIndex;
      const current = tracks[idx] || tracks[tracks.length - 1];
      const artist = current?.artist;
      if (!artist) return null;
      const excludeIds = tracks.map((t) => t?.id).filter(Boolean).join(',');
      const userId = user?.id ?? null;
      try {
        const radio = await apiClient.getArtistRadio(artist, {
          limit: 30,
          userId,
          exclude: excludeIds,
        });
        if (!Array.isArray(radio) || radio.length === 0) return null;
        const baseName = (state.queueName || artist).replace(/\s+Radio$/i, '');
        return { tracks: radio, queueName: `${baseName} Radio` };
      } catch {
        return null;
      }
    },
    prefetchSessionsFor: (trackIds) => {
      apiClient.prefetchDirectSessions(trackIds).catch(() => undefined);
    },
  }), [
    audioEngine,
    getOrCreateConnector,
    hardResetAudioPipeline,
    isAuthenticated,
    queueManager.effectiveTracks,
    currentTrackIndex,
    state.userSettings,
    setCurrentTrackIndex,
    setIsPlaying,
    userWantsPlaybackRef,
    setQueueSource,
    setQueueName,
    setCustomQueue,
    setCustomQueueMeta,
    syncQueueSnapshot,
    state.queueName,
    state.queueSource,
    state.switchingUntilRef,
    user,
  ]);

  const playerCoreRef = useRef(null);
  if (!playerCoreRef.current) {
    playerCoreRef.current = new PlayerCore(buildPlayerCoreDeps());
  }

  const resumeAppliedRef = useRef(false);
  useEffect(() => {
    if (resumeAppliedRef.current) return;
    if (typeof window === 'undefined') return;
    if (typeof localStorage === 'undefined') return;
    const tracks = queueManager?.effectiveTracks;
    if (!Array.isArray(tracks) || tracks.length === 0) return;

    const rawTrackId = (() => {
      try {
        return localStorage.getItem('lastTrackId');
      } catch {
        return null;
      }
    })();
    const trackId = rawTrackId ? String(rawTrackId) : '';

    const rawIdx = (() => {
      try {
        return localStorage.getItem('lastTrackIndex');
      } catch {
        return null;
      }
    })();
    const idxNum = rawIdx ? Number.parseInt(rawIdx, 10) : Number.NaN;
    const idx = Number.isFinite(idxNum) ? Math.max(0, Math.floor(idxNum)) : 0;

    let nextIndex = 0;
    if (trackId) {
      const found = tracks.findIndex((t) => String(t?.id ?? '') === trackId);
      if (found >= 0) nextIndex = found;
      else nextIndex = Math.min(idx, Math.max(0, tracks.length - 1));
    } else {
      nextIndex = Math.min(idx, Math.max(0, tracks.length - 1));
    }

    const rawPos = (() => {
      try {
        return localStorage.getItem('lastPositionSeconds');
      } catch {
        return null;
      }
    })();
    const posNum = rawPos ? Number.parseFloat(rawPos) : Number.NaN;
    const pos = Number.isFinite(posNum) && posNum >= 0 ? posNum : 0;

    try {
      state.setCurrentTrackIndex(nextIndex);
    } catch {
    }
    try {
      state.setIsPlaying(false);
      if (state.userWantsPlaybackRef) {
        state.userWantsPlaybackRef.current = false;
      }
    } catch {
    }

    if (pos > 0) {
      if (state.currentTimeRef) state.currentTimeRef.current = pos;

      const t = tracks[nextIndex];
      const tid = t && t.id != null ? String(t.id) : '';
      if (tid) {
        resumeHintRef.current = { trackId: tid, positionSeconds: pos };
      }
    }

    resumeAppliedRef.current = true;
  }, [queueManager?.effectiveTracks, state]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (typeof localStorage === 'undefined') return;

    const writePosition = () => {
      try {
        const t = Number(state.currentTimeRef?.current ?? state.currentTime ?? 0);
        if (!Number.isFinite(t) || t < 0) return;
        localStorage.setItem('lastPositionSeconds', String(Math.floor(t * 1000) / 1000));
      } catch {
      }
    };

    let tId = 0;
    if (state.isPlaying) {
      tId = window.setInterval(writePosition, 3000);
    }

    const onPageHide = () => {
      writePosition();
    };
    try {
      window.addEventListener('pagehide', onPageHide);
    } catch {
    }

    return () => {
      if (tId) {
        try { window.clearInterval(tId); } catch { }
      }
      try {
        window.removeEventListener('pagehide', onPageHide);
      } catch {
      }
    };
  }, [state.currentTimeRef, state.isPlaying]);

  const { currentTrack, activeTrackId } = useDisplayTrackDuringTransition({
    rawCurrentTrack: queueManager.currentTrack,
    switchingUntilRef: state.switchingUntilRef,
    userWantsPlaybackRef: state.userWantsPlaybackRef,
    fsmState: storeSnapshot?.fsmState,
    isBuffering: storeSnapshot?.isBuffering,
  });
  const runtimeState = useMemo(() => ({
    ...state,
    currentTrack,
    activeTrackId,
    isAuthenticated,
  }), [state, currentTrack, activeTrackId, isAuthenticated]);

  const feedbackManager = useFeedbackManager(runtimeState, { recommendations });

  const recordManualSkip = useCallback((reason = 'manual') => {
    try {
      if (!currentTrack?.id) return;
      const wantsPlayback = state.userWantsPlaybackRef?.current === true || state.isPlaying === true;
      if (!wantsPlayback) return;
      feedbackManager.recordSkipFeedback?.(currentTrack, { reason });
    } catch {
    }
  }, [currentTrack, feedbackManager, state.isPlaying, state.userWantsPlaybackRef]);

  const requireAuthFor = useCallback((reason) => {
    if (isAuthenticated) return true;
    redirectToAuth({ reason: String(reason || 'auth_required').slice(0, 64), returnTo: buildReturnToFromCurrentLocation(), replace: true });
    return false;
  }, [isAuthenticated]);

  const cycleRepeatMode = useCallback(() => {
    state.setRepeatMode((prev) => {
      if (prev === 'off') return 'all';
      if (prev === 'all') return 'one';
      return 'off';
    });
  }, [state.setRepeatMode]);

  const cyclePlaybackRate = useCallback(() => {
    const rates = [1, 1.25, 1.5, 2, 0.5, 0.75];
    const idx = rates.indexOf(state.playbackRate);
    setPlaybackRateState(rates[(idx + 1) % rates.length]);
  }, [state.playbackRate, setPlaybackRateState]);

  const beginSeek = useCallback(() => {
    if (state.seekCooldownUntilRef && Date.now() < (state.seekCooldownUntilRef.current || 0)) return;
    if (state.userGestureEverRef) state.userGestureEverRef.current = true;
    audioEngine.ensureAudioContext(true);
    audioEngine.rebuildGraph();
    if (state.isSeekingRef) state.isSeekingRef.current = true;
    state.setIsSeeking(true);
  }, [audioEngine, state.seekCooldownUntilRef, state.userGestureEverRef, state.isSeekingRef, state.setIsSeeking]);

  const updateSeek = useCallback((percent) => {
    const clamped = Math.max(0, Math.min(100, percent));
    const dur = state.audioRef?.current?.duration || 0;
    if (dur && isFinite(dur) && state.currentTimeRef) {
      state.currentTimeRef.current = (clamped / 100) * dur;
    }
  }, [state.audioRef, state.currentTimeRef]);

  const toggleLikeCurrent = useCallback(async () => {
    if (!requireAuthFor('like')) return;
    const track = currentTrack;
    if (!track?.id) return;
    const tid = Number.parseInt(String(track.id), 10);
    if (!Number.isFinite(tid) || tid <= 0) return;
    const isLiked = state.likedIds.has(tid);
    const wasDisliked = state.dislikedIds.has(tid);

    const likedTrackEntry = {
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.durationSeconds || track.duration,
      genre: track.genre,
      year: track.year,
      cover_path: track.cover_path,
    };

    if (isLiked) {
      state.setLikedIds((prev) => { const next = new Set(prev); next.delete(tid); return next; });
      state.setLikedTracks?.((prev) => (Array.isArray(prev) ? prev.filter((t) => String(t?.id) !== String(tid)) : []));
      try {
        await apiClient.unlikeSong(tid);
      } catch {
        state.setLikedIds((prev) => new Set(prev).add(tid));
        state.setLikedTracks?.((prev) => {
          const base = Array.isArray(prev) ? prev : [];
          if (base.some((t) => String(t?.id) === String(track.id))) return base;
          return [likedTrackEntry, ...base];
        });
      }
      return;
    }

    if (wasDisliked) {
      state.setDislikedIds((prev) => { const next = new Set(prev); next.delete(tid); return next; });
    }
    state.setLikedIds((prev) => new Set(prev).add(tid));
    state.setLikedTracks?.((prev) => {
      const base = Array.isArray(prev) ? prev : [];
      if (base.some((t) => String(t?.id) === String(track.id))) return base;
      return [likedTrackEntry, ...base];
    });

    try {
      if (wasDisliked) {
        await apiClient.undislikeSong(tid);
      }
      await apiClient.likeSong(tid);
      feedbackManager.recordFeedback?.('like');
    } catch {
      state.setLikedIds((prev) => { const next = new Set(prev); next.delete(tid); return next; });
      state.setLikedTracks?.((prev) => (Array.isArray(prev) ? prev.filter((t) => String(t?.id) !== String(tid)) : []));
      if (wasDisliked) {
        state.setDislikedIds((prev) => new Set(prev).add(tid));
      }
    }
  }, [requireAuthFor, currentTrack, state.likedIds, state.dislikedIds, state.setLikedIds, state.setDislikedIds, state.setLikedTracks, feedbackManager]);

  const toggleDislikeCurrent = useCallback(async () => {
    if (!requireAuthFor('dislike')) return;
    const track = currentTrack;
    if (!track?.id) return;
    const dtid = Number.parseInt(String(track.id), 10);
    if (!Number.isFinite(dtid) || dtid <= 0) return;
    const isDisliked = state.dislikedIds.has(dtid);
    const wasLiked = state.likedIds.has(dtid);
    try {
      if (isDisliked) {
        await apiClient.undislikeSong(dtid);
        state.setDislikedIds((prev) => { const next = new Set(prev); next.delete(dtid); return next; });
        return;
      }
      if (wasLiked) {
        state.setLikedTracks?.((prev) => (Array.isArray(prev) ? prev.filter((t) => String(t?.id) !== String(dtid)) : []));
        state.setLikedIds((prev) => { const next = new Set(prev); next.delete(dtid); return next; });
        apiClient.unlikeSong(dtid).catch(() => undefined);
      }
      state.setDislikedIds((prev) => new Set(prev).add(dtid));
      feedbackManager.recordFeedback?.('dislike');
      playerCoreRef.current?.next().catch(() => undefined);
      apiClient.dislikeSong(dtid).catch(() => {
        state.setDislikedIds((prev) => { const next = new Set(prev); next.delete(dtid); return next; });
      });
    } catch { }
  }, [requireAuthFor, currentTrack, state.dislikedIds, state.likedIds, state.setDislikedIds, state.setLikedIds, state.setLikedTracks, feedbackManager]);

  const lastRecoRefreshAtRef = useRef(0);
  const recoRefreshInFlightRef = useRef(false);

  const switchToRecommendationsQueueCore = useCallback(async () => {
    const qm = queueManagerRef.current;
    if (!qm) return;

    const refreshFn = recommendations?.refreshRecommendations;
    const hasReco = Array.isArray(recommendations?.tracks) && recommendations.tracks.length > 0;
    const currentSource = state.queueSource;
    const now = Date.now();

    const shouldRefresh =
      typeof refreshFn === 'function'
      && recommendations?.loading !== true
      && !recoRefreshInFlightRef.current
      && (!hasReco || (currentSource !== 'auto' && now - lastRecoRefreshAtRef.current >= 15000));

    let freshTracks;
    if (shouldRefresh) {
      try {
        recoRefreshInFlightRef.current = true;
        lastRecoRefreshAtRef.current = now;
        const result = await refreshFn(false);
        if (Array.isArray(result) && result.length > 0) {
          freshTracks = formatSongsForPlayer(result).map(validateTrack).filter(Boolean);
        }
      } catch {
      } finally {
        recoRefreshInFlightRef.current = false;
      }
    }

    qm.switchToRecommendations(freshTracks, { startFresh: state.queueSource !== 'auto' });
  }, [recommendations, state.queueSource, formatSongsForPlayer]);

  const switchToLibraryQueueCore = useCallback(() => {
    queueManagerRef.current?.switchToLibrary();
  }, []);

  const switchToLikedQueueCore = useCallback(() => {
    queueManagerRef.current?.switchToLiked();
  }, []);

  const refreshLikedQueue = useCallback(() => {
    if (!isAuthenticated || !state.userId) return Promise.resolve();
    return apiClient.getLikes()
      .then((liked) => {
        applyLikedTracks(liked);
        if (state.queueSource === 'liked') {
          switchToLikedQueueCore();
        }
      })
      .catch(() => undefined);
  }, [isAuthenticated, state.userId, state.queueSource, applyLikedTracks, switchToLikedQueueCore]);

  const toggleShuffleCore = useCallback(() => {
    queueManagerRef.current?.toggleShuffle();
  }, []);

  const resolvePlaybackDurationSec = useCallback(() => {
    const audioDur = Number(state.duration);
    if (Number.isFinite(audioDur) && audioDur > 0) return audioDur;
    return resolveTrackDurationSeconds(currentTrack);
  }, [state.duration, currentTrack]);

  const patchStorePlaybackTime = useCallback((timeSec, durationSec) => {
    const store = playerStoreRef.current;
    if (!store) return;
    const snap = store.getSnapshot();
    const patch = {};
    const t = Number(timeSec);
    if (Number.isFinite(t) && t >= 0 && t !== snap.currentTime) {
      patch.currentTime = t;
    }
    const d = Number(durationSec);
    if (Number.isFinite(d) && d > 0 && Math.abs(d - snap.duration) > 0.1) {
      patch.duration = d;
    }
    if (Object.keys(patch).length > 0) {
      store.patch(patch);
    }
  }, []);

  const seekToPositionCore = useCallback((positionMs) => {
    const s = Number(positionMs) / 1000;
    if (!Number.isFinite(s) || s < 0) return;
    const dur = resolvePlaybackDurationSec();
    if (state.isSeekingRef) state.isSeekingRef.current = true;
    if (state.currentTimeRef) state.currentTimeRef.current = s;
    if (Number.isFinite(dur) && dur > 0) {
      playerTimeTrackerRef.current?.writeExternalProgress(s, dur);
      patchStorePlaybackTime(s, dur);
    }
    playerCoreRef.current?.seek(s).catch(() => undefined);
  }, [state.currentTimeRef, state.isSeekingRef, resolvePlaybackDurationSec, patchStorePlaybackTime]);

  const seekToSecondsCore = useCallback((seconds) => {
    const s = Number(seconds);
    if (!Number.isFinite(s) || s < 0) return;
    const dur = resolvePlaybackDurationSec();
    if (state.isSeekingRef) state.isSeekingRef.current = true;
    if (state.currentTimeRef) state.currentTimeRef.current = s;
    if (Number.isFinite(dur) && dur > 0) {
      playerTimeTrackerRef.current?.writeExternalProgress(s, dur);
      patchStorePlaybackTime(s, dur);
    }
    playerCoreRef.current?.seek(s).catch(() => undefined);
  }, [state.currentTimeRef, state.isSeekingRef, resolvePlaybackDurationSec, patchStorePlaybackTime]);

  const commitSeekCore = useCallback((percent) => {
    const dur = resolvePlaybackDurationSec();
    const p = Number(percent);
    if (!Number.isFinite(dur) || dur <= 0) return;
    if (!Number.isFinite(p)) return;

    const clamped = Math.max(0, Math.min(100, p));
    const targetSeconds = Math.max(0, Math.min(dur, (clamped / 100) * dur));

    if (state.isSeekingRef) state.isSeekingRef.current = true;
    if (state.currentTimeRef) state.currentTimeRef.current = targetSeconds;
    playerTimeTrackerRef.current?.writeExternalProgress(targetSeconds, dur);
    patchStorePlaybackTime(targetSeconds, dur);

    playerCoreRef.current?.seek(targetSeconds).catch(() => undefined);
    markExternalMediaSessionSeekAtNow();
  }, [playerCoreRef, state.currentTimeRef, state.isSeekingRef, resolvePlaybackDurationSec, patchStorePlaybackTime]);

  const seekToPercentCore = useCallback((percent) => {
    commitSeekCore(percent);
  }, [commitSeekCore]);

  const updateSeekCore = useCallback((percent) => {
    const dur = resolvePlaybackDurationSec();
    if (dur <= 0) return;
    const clamped = Math.max(0, Math.min(100, Number(percent)));
    const t = (clamped / 100) * dur;
    if (state.currentTimeRef) state.currentTimeRef.current = t;
    playerTimeTrackerRef.current?.writeExternalProgress(t, dur);
    patchStorePlaybackTime(t, dur);
  }, [state.currentTimeRef, resolvePlaybackDurationSec, patchStorePlaybackTime]);

  const handleProgressClickCore = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const raw = ((e.clientX - rect.left) / rect.width) * 100;
    commitSeekCore(raw);
  }, [commitSeekCore]);

  const selectTrack = useCallback(async (track) => {
    const nextId = track?.id != null ? String(track.id) : '';
    const currentId = currentTrack?.id != null ? String(currentTrack.id) : '';
    if (nextId && currentId && nextId !== currentId) {
      recordManualSkip('select');
    }

    const handled = await playerCoreRef.current
      .selectTrack(track)
      .catch(() => false);

    if (handled) return;

    const id = track?.id;
    if (id == null) return;
    await playerCoreRef.current.playTrackById(id, true).catch(() => undefined);
  }, [currentTrack, recordManualSkip]);

  const playFromListCore = useCallback(async (rawSongs, startSongId, playlistName = '') => {
    if (!rawSongs?.length) return;
    const formatted = formatSongsForPlayer(rawSongs)
      .map(validateTrack)
      .filter((t, i, s) => t?.id && s.findIndex(x => x.id === t.id) === i);

    if (!formatted.length) return;

    const targetId = startSongId != null ? String(startSongId) : String(formatted[0]?.id ?? '');
    const currentId = currentTrack?.id != null ? String(currentTrack.id) : '';
    if (targetId && currentId && targetId !== currentId) {
      recordManualSkip('play_from_list');
    }

    await playerCoreRef.current
      .playFromList(formatted, startSongId, playlistName || 'Playlist')
      .catch(() => undefined);
  }, [currentTrack, formatSongsForPlayer, recordManualSkip]);

  const playTrackByIdCore = useCallback(async (songId, autoPlay = true) => {
    const targetId = songId != null ? String(songId) : '';
    const currentId = currentTrack?.id != null ? String(currentTrack.id) : '';
    if (autoPlay && targetId && currentId && targetId !== currentId) {
      recordManualSkip('play_track_by_id');
    }

    return await playerCoreRef.current
      .playTrackById(songId, autoPlay)
      .catch(() => false);
  }, [currentTrack, recordManualSkip]);

  const applyRemotePlaybackCore = useCallback(async (snapshot = {}, options = {}) => {
    const trackId = snapshot?.trackId != null ? String(snapshot.trackId).trim() : '';
    if (!trackId) return false;

    const posRaw = Number(snapshot.positionSec);
    const hasPos = Number.isFinite(posRaw) && posRaw >= 0;
    const pos = hasPos ? posRaw : 0;
    const shouldPlay = snapshot.isPlaying !== false;
    const silent = options && options.silent === true;
    const queueSource = typeof snapshot.queueSource === 'string' ? snapshot.queueSource : '';

    try {
      if (queueSource === 'auto') {
        queueManagerRef.current?.switchToRecommendations(undefined, { startFresh: false });
      } else if (queueSource === 'library') {
        queueManagerRef.current?.switchToLibrary();
      } else if (queueSource === 'liked') {
        queueManagerRef.current?.switchToLiked();
      }
    } catch { }

    const ok = await playerCoreRef.current
      .playTrackById(trackId, false)
      .catch(() => false);
    if (!ok) return false;

    if (hasPos) {
      if (state.currentTimeRef) state.currentTimeRef.current = pos;
      resumeHintRef.current = { trackId, positionSeconds: pos };
      const dur = Number(state.duration);
      if (Number.isFinite(dur) && dur > 0) {
        playerTimeTrackerRef.current?.writeExternalProgress(pos, dur);
      }
      if (!silent) {
        await playerCoreRef.current?.seek(pos).catch(() => undefined);
      }
    }

    if (silent) return true;

    if (shouldPlay) {
      await playerCoreRef.current?.play().catch(() => undefined);
    } else {
      await playerCoreRef.current?.pause().catch(() => undefined);
    }
    return true;
  }, [state.currentTimeRef, state.duration]);

  const playPlaylistCore = useCallback(async (playlistTracks, playlistName) => {
    if (!playlistTracks?.length) return;
    const formatted = formatSongsForPlayer(playlistTracks)
      .map(validateTrack)
      .filter((t, i, s) => t?.id && s.findIndex(x => x.id === t.id) === i);

    if (!formatted.length) return;

    const targetId = formatted[0]?.id != null ? String(formatted[0].id) : '';
    const currentId = currentTrack?.id != null ? String(currentTrack.id) : '';
    if (targetId && currentId && targetId !== currentId) {
      recordManualSkip('play_playlist');
    }

    await playerCoreRef.current
      .playPlaylist(formatted, playlistName || 'Playlist')
      .catch(() => undefined);
  }, [currentTrack, formatSongsForPlayer, recordManualSkip]);

  useMultiTabGuard({
    enabled: true,
    isPlaying: state.isPlaying,
    pausePlayback: () => playerCoreRef.current.pause().catch(() => undefined),
    userWantsPlaybackRef: state.userWantsPlaybackRef,
  });

  const partyManager = usePartyManager(runtimeState, {
    playTrackById: (id, auto) => playTrackByIdCore(id, auto)
  });

  const handleConnectorEnded = useCallback((endedTrackId) => {
    try {
      const qtid = queueManager.currentTrack?.id != null ? String(queueManager.currentTrack.id) : '';
      const etid = endedTrackId != null ? String(endedTrackId) : '';
      if (queueManager.currentTrack?.id && (!etid || !qtid || etid === qtid)) {
        feedbackManager.recordFeedback?.('complete', queueManager.currentTrack);
      }
    } catch {
    }

    playerCoreRef.current?.handleEnded(endedTrackId != null ? String(endedTrackId) : null).catch(() => undefined);
  }, [feedbackManager, queueManager.currentTrack]);

  const handleConnectorPlaying = useCallback((trackId) => {
    try {
      feedbackManager.handlePlayFeedback?.(trackId);
    } catch {
    }
  }, [feedbackManager]);

  const handleConnectorSeeked = useCallback(() => {
    playerCoreRef.current?.notifySeekComplete();
  }, []);

  usePlaybackConnectorBridge({
    apiClient,
    audioRef: state.audioRef,
    connectorRef: playbackConnectorRef,
    getDestinationNode: () => undefined,

    setPlaybackEngine: state.setPlaybackEngine,
    setIsPlaying: state.setIsPlaying,
    setIsBuffering: state.setIsBuffering,
    setLocalOutputState,
    setDuration: state.setDuration,
    markPlaybackError: state.markPlaybackError,

    rebuildGraph: audioEngine.rebuildGraph,
    restoreAudioVolume: audioEngine.restoreAudioVolume,
    currentTimeRef: state.currentTimeRef,
    store: playerStoreRef.current,
    trackLoudnessRef: state.trackLoudnessRef,
    getQualityPreference: () => state.userSettings?.audio_quality || 'auto',
    onPlaying: handleConnectorPlaying,
    onEnded: handleConnectorEnded,
    onSeeked: handleConnectorSeeked,
    shouldSyncConnectorIsPlaying,
    onFatalError: (code) => {
      const safe = typeof code === 'string' ? code : '';
      if (!isIosSafari()) return;
      if (!userWantsPlaybackRef?.current) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      if (!safe) return;
      if (!/HLS_|PLAYBACK_|ABORT|NOT_SUPPORTED/i.test(safe)) return;
      hardResetAudioPipeline(`connector_${safe}`)
        .then(() => playerCoreRef.current?.play().catch(() => undefined))
        .catch(() => undefined);
    },
  });

  useEffect(() => {
    if (!isIosSafari()) return;
    if (typeof document === 'undefined') return;

    if (playbackConnectorRef.current) return;

    let lastHiddenAt = 0;
    let pending = 0;

    const onVisibility = () => {
      if (document.hidden) {
        lastHiddenAt = Date.now();
        if (pending) {
          window.clearTimeout(pending);
          pending = 0;
        }
        return;
      }

      const hiddenFor = lastHiddenAt ? Math.max(0, Date.now() - lastHiddenAt) : 0;
      lastHiddenAt = 0;
      if (hiddenFor < 1200) return;
      if (!userWantsPlaybackRef?.current) return;

      const a = audioRef?.current;
      if (!a) return;

      const t0 = Number(a.currentTime);
      pending = window.setTimeout(() => {
        pending = 0;
        if (!userWantsPlaybackRef?.current) return;
        const a2 = audioRef?.current;
        if (!a2) return;
        const t1 = Number(a2.currentTime);
        if (Number.isFinite(t0) && Number.isFinite(t1) && t1 <= t0 + 0.01) {
          playerCoreRef.current?.play().catch(() => undefined);
        }
      }, 650);
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (pending) {
        window.clearTimeout(pending);
        pending = 0;
      }
    };
  }, [audioRef, hardResetAudioPipeline, userWantsPlaybackRef]);

  useEffect(() => {
    const audio = audioRef?.current;
    if (!audio) return;
    if (typeof window === 'undefined') return;

    const switchingRef = state.switchingUntilRef;
    const seekingRef = state.isSeekingRef;

    let pendingTimerId = 0;
    let lastAttemptAtMs = 0;
    const resumeDebounceMs = 300;
    const resumeCooldownMs = 1500;

    const isSwitching = () => {
      const until = Number(switchingRef?.current || 0);
      return Number.isFinite(until) && Date.now() < until;
    };

    const clearPending = () => {
      if (!pendingTimerId) return;
      try { window.clearTimeout(pendingTimerId); } catch { }
      pendingTimerId = 0;
    };

    const onSystemPause = () => {
      if (!userWantsPlaybackRef?.current) return;
      let ended = false;
      let seeking = false;
      try { ended = audio.ended === true; } catch { }
      try { seeking = audio.seeking === true; } catch { }
      if (ended || seeking) return;
      if (seekingRef?.current === true) return;
      if (isSwitching()) return;

      const now = Date.now();
      if (now - lastAttemptAtMs < resumeCooldownMs) return;

      clearPending();
      pendingTimerId = window.setTimeout(() => {
        pendingTimerId = 0;
        if (!userWantsPlaybackRef?.current) return;
        const a = audioRef?.current;
        if (!a) return;
        let stillPaused = false;
        try { stillPaused = a.paused === true; } catch { }
        if (!stillPaused) return;
        if (isSwitching()) return;

        lastAttemptAtMs = Date.now();
        playerCoreRef.current?.play().catch(() => undefined);
      }, resumeDebounceMs);
    };

    audio.addEventListener('pause', onSystemPause);

    return () => {
      try { audio.removeEventListener('pause', onSystemPause); } catch { }
      clearPending();
    };
  }, [audioRef, audioElementKey, userWantsPlaybackRef, state.switchingUntilRef, state.isSeekingRef]);

  useEffect(() => {
    const c = playbackConnectorRef.current;
    if (!c) return;
    c.setVolume(state.volume);
    // When WebAudio is active, audio.volume must stay at 1 to avoid volume²;
    // the gain is controlled by mainGain in the WebAudio graph.
    restoreAudioVolumeRef.current?.();
    // Sync mainGain.gain.value with the new volume immediately.
    applyEqSettingsRef.current?.();
  }, [playbackConnectorRef, state.volume]);

  // Reactively apply EQ band gains and mainGain whenever eqEnabled / eqGains /
  // volume / playbackEngine change.  applyEqSettings captures all those values
  // in its useCallback deps, so its identity changes exactly when a re-apply
  // is needed — the effect fires, updates filter.gain.value and mainGain.gain
  // without tearing down and rebuilding the whole WebAudio graph.
  const { applyEqSettings } = audioEngine;
  useEffect(() => {
    applyEqSettings();
  }, [applyEqSettings]);

  useEffect(() => {
    const c = playbackConnectorRef.current;
    if (!c || typeof c.setPolicy !== 'function') return;
    c.setPolicy(DEFAULT_PROTOCOL_POLICY);
  }, [playbackConnectorRef]);

  useEffect(() => {
    const c = playbackConnectorRef.current;
    if (!c) return;
    c.setPlaybackRate(state.playbackRate);
  }, [playbackConnectorRef, state.playbackRate]);

  useEffect(() => {
    const audio = state.audioRef?.current;
    if (!audio) return;
    const rate = Number(state.playbackRate);
    if (Number.isFinite(rate) && rate > 0) {
      try { audio.playbackRate = rate; } catch { }
    }
    const preserve = state.preservePitch !== false;
    try { audio.preservesPitch = preserve; } catch { }
    try { audio['mozPreservesPitch'] = preserve; } catch { }
    try { audio['webkitPreservesPitch'] = preserve; } catch { }
  }, [state.playbackRate, state.preservePitch, state.audioRef, audioElementKey]);

  const playlistQueueRef = useRef({
    queueSource: null,
    playlistId: null,
    customQueue: [],
    currentTrackIndex: 0,
    currentTrackId: null,
  });
  useEffect(() => {
    playlistQueueRef.current = {
      queueSource: state.queueSource,
      playlistId: state.customQueueMeta && typeof state.customQueueMeta === 'object' ? state.customQueueMeta.playlistId : null,
      customQueue: Array.isArray(state.customQueue) ? state.customQueue : [],
      currentTrackIndex: Number.isFinite(Number(currentTrackIndex)) ? Math.max(0, Math.floor(Number(currentTrackIndex))) : 0,
      currentTrackId: currentTrack && currentTrack.id != null ? String(currentTrack.id) : null,
    };
  }, [state.queueSource, state.customQueueMeta, state.customQueue, currentTrack, currentTrackIndex]);

  useEffect(() => {
    const unsubscribe = subscribePlaylistChanged((evt) => {
      const ref = playlistQueueRef.current;
      if (!ref || ref.queueSource !== 'custom') return;
      if (!ref.playlistId || String(evt?.playlistId || '') !== String(ref.playlistId)) return;
      const base = Array.isArray(ref.customQueue) ? ref.customQueue : [];
      if (base.length === 0) return;
      const eventType = typeof evt?.type === 'string' ? evt.type : '';
      const nextIds = Array.isArray(evt?.nextIds) ? evt.nextIds.map(String) : null;
      const removedIdRaw = evt?.removedTrackId ?? evt?.trackId;
      const removedId = removedIdRaw != null ? String(removedIdRaw) : '';
      let nextQueue = base;
      if (eventType === 'reorder' && nextIds && nextIds.length > 0) {
        const byId = new Map(base.map((t) => [t && t.id != null ? String(t.id) : '', t]));
        nextQueue = nextIds.map((id) => byId.get(String(id)) || null).filter(Boolean);
      } else if ((eventType === 'remove' && removedId) || (evt?.delta === -1 && removedId)) {
        nextQueue = base.filter((t) => String(t?.id ?? '') !== removedId);
      }
      if (!Array.isArray(nextQueue) || (nextQueue.length === base.length && nextQueue.every((t, i) => String(t?.id ?? '') === String(base[i]?.id ?? '')))) return;
      state.setCustomQueue(nextQueue);
      const currentId = ref.currentTrackId;
      if (currentId) {
        const idx = nextQueue.findIndex((t) => String(t?.id ?? '') === currentId);
        if (idx >= 0) { setCurrentTrackIndex(idx); return; }
      }
      const fallbackIndex = Number.isFinite(Number(ref.currentTrackIndex)) ? Math.max(0, Math.floor(Number(ref.currentTrackIndex))) : 0;
      if (nextQueue.length > 0) setCurrentTrackIndex(Math.min(fallbackIndex, nextQueue.length - 1));
    });
    return unsubscribe;
  }, [state.setCustomQueue, setCurrentTrackIndex]);

  useHlsPrefetch({
    apiClient,
    isAuthenticated,
    playbackEngine: state.playbackEngine,
    currentTimeRef: state.currentTimeRef,
    duration: state.duration,
    effectiveTracks: queueManager.effectiveTracks,
    currentTrackIndex,
    repeatMode,
    isSeekingRef: state.isSeekingRef,
    switchingUntilRef: state.switchingUntilRef,
  });

  useDirectPrefetch({
    apiClient,
    isAuthenticated,
    usePlaybackConnector: true,
    playbackEngine: state.playbackEngine,
    currentTimeRef: state.currentTimeRef,
    duration: state.duration,
    effectiveTracks: queueManager.effectiveTracks,
    currentTrackIndex,
    repeatMode,
    isSeekingRef: state.isSeekingRef,
    switchingUntilRef: state.switchingUntilRef,
    connectorRef: playbackConnectorRef,
  });

  usePlayerTelemetry({
    enabled: false,
    apiClient,
    playerStatus: state.playerStatus,
    lastErrorCode: state.lastErrorCode,
    activeTrackId,
    playbackEngine: state.playbackEngine,
  });

  useEffect(() => {
    const core = playerCoreRef.current;
    if (!core) return;
    core.setDeps(buildPlayerCoreDeps());
  }, [buildPlayerCoreDeps]);

  useEffect(() => {
    const audio = state.audioRef?.current;
    const tracker = playerTimeTrackerRef.current;
    if (!audio || !tracker) return;

    tracker.attach(
      audio,
      state.currentTimeRef || { current: 0 },
      (currentTime, duration) => {
        if (duration > 0) {
          try { state.setDuration(duration); } catch { }
        }
        const store = playerStoreRef.current;
        if (store) {
          const snap = store.getSnapshot();
          const patch = {};
          const flooredTime = Math.floor(currentTime);
          if (flooredTime !== Math.floor(snap.currentTime)) {
            patch.currentTime = currentTime;
          }
          if (Math.abs(duration - snap.duration) > 0.1) {
            patch.duration = duration;
          }
          if (patch.currentTime !== undefined || patch.duration !== undefined) {
            store.patch(patch);
          }
        }
      },
      state.isSeekingRef,
    );

    return () => {
      tracker.detach();
    };
  }, [audioElementKey, state.currentTimeRef, state.setDuration]);

  const handleSyncResume = useCallback(async () => {
    const audio = state.audioRef?.current;
    if (audio && audio.paused) {
      await audio.play().catch(() => { });
    }
    ensureAudioActivated();
    await playerCoreRef.current?.play().catch(() => undefined);
  }, [ensureAudioActivated, state.audioRef]);

  const projectPlaybackUiState = useCallback((isPlaying) => {
    const next = !!isPlaying;
    try { playerStoreRef.current?.patch({ isPlaying: next }); } catch { }
  }, []);

  const suspendLocalOutput = useCallback(async (reason = 'suspended') => {
    const nextOutputState = String(reason || '').toLowerCase() === 'revoked'
      ? LOCAL_OUTPUT_STATES.REVOKED
      : LOCAL_OUTPUT_STATES.SUSPENDED;
    setLocalOutputState(nextOutputState);
    if (state.userWantsPlaybackRef) {
      state.userWantsPlaybackRef.current = false;
    }
    const audio = state.audioRef?.current;
    if (audio) {
      try { audio.pause(); } catch { }
    }
    const connector = playbackConnectorRef.current;
    if (connector && typeof connector.suspendOutput === 'function') {
      await connector.suspendOutput().catch(() => undefined);
      return;
    }
  }, [setLocalOutputState, state.audioRef, state.userWantsPlaybackRef]);

  // ── Party: single WS connection for the whole app ──
  const [activePartyId, setActivePartyId] = useState(null);

  const partyPlayerProxy = useMemo(() => ({
    isPlaying: storeSnapshot.isPlaying,
    isBuffering: storeSnapshot.isBuffering,
    durationRaw: state.duration,
    getCurrentPositionMs: () => Math.floor((state.currentTimeRef?.current || 0) * 1000),
    seekToPercent: seekToPercentCore,
    pausePlayback: () => playerCoreRef.current?.pause().catch(() => undefined),
    resumePlayback: handleSyncResume,
    intent: {
      getWanted: () => !!state.userWantsPlaybackRef?.current,
    },
  }), [storeSnapshot.isPlaying, storeSnapshot.isBuffering, state.duration, state.currentTimeRef, state.userWantsPlaybackRef, seekToPercentCore, handleSyncResume]);

  const playTrackFromPartyCore = useCallback(async (track, autoPlay = true) => {
    if (!track?.id) return false;
    const tid = String(track.id);
    if (!autoPlay) {
      return playTrackByIdCore(tid, false);
    }
    const existing = (queueManager.effectiveTracks || []).find(t => String(t?.id) === tid);
    if (existing) {
      return selectTrack(existing);
    }
    await playFromListCore([track], tid, 'Party');
    return true;
  }, [queueManager.effectiveTracks, selectTrack, playFromListCore, playTrackByIdCore]);

  const partyBridge = usePartyPlaybackBridge({
    activePartyId,
    player: partyPlayerProxy,
    partyMode: partyManager.partyMode,
    partyInfo: partyManager.partyInfo,
    enterPartyMode: partyManager.enterPartyMode,
    exitPartyMode: partyManager.exitPartyMode,
    currentTrack,
    playTrackById: (id, auto) => playTrackByIdCore(id, auto),
    playTrackFromParty: (track, auto) => playTrackFromPartyCore(track, auto),
    onEnterParty: null,
    onPartyEnded: null,
    onError: null,
    onHostNeedsInviteCode: null,
  });

  const handleSyncPlayPause = useCallback(() => {
    const isPlayingNow = playerStoreRef.current?.getSnapshot().isPlaying || state.isPlaying;
    if (!isPlayingNow) {
      const audio = state.audioRef?.current;
      if (audio && audio.paused) audio.play().catch(() => { });
      ensureAudioActivated();
    }
    playerCoreRef.current?.togglePlayPause().catch(() => undefined);
  }, [state.isPlaying, ensureAudioActivated, state.audioRef]);

  const playNextTrackCore = useCallback(() => {
    recordManualSkip('next');
    playerCoreRef.current?.next().catch(() => undefined);
  }, [recordManualSkip]);

  const playPreviousTrackCore = useCallback(() => {
    recordManualSkip('previous');
    playerCoreRef.current?.prev().catch(() => undefined);
  }, [recordManualSkip]);

  useMediaSession({
    currentTrack,
    queueName: state.queueName,
    queueLength: queueManager.effectiveTracks?.length,
    playbackEngine: state.playbackEngine,
    processedSinkAudioRef: null,
    audioRef: state.audioRef,
    setIsPlaying: state.setIsPlaying,
    userWantsPlaybackRef: state.userWantsPlaybackRef,
    playNextTrack: playNextTrackCore,
    playPreviousTrack: playPreviousTrackCore,
    seekToSeconds: (s) => playerCoreRef.current?.seek(s).catch(() => undefined),
    pausePlayback: () => playerCoreRef.current?.pause().catch(() => undefined),
    resumePlayback: handleSyncResume,
    isPlaying: state.isPlaying,
    duration: state.duration,
    currentTime: state.currentTimeRef?.current ?? 0,
    playbackRate: state.playbackRate,
    isSeekingRef: state.isSeekingRef,
    disablePlaybackStateSync: true,
  });

  useMediaSessionSync({
    audioRef: state.audioRef,
    connectorRef: playbackConnectorRef,
    userWantsPlaybackRef: state.userWantsPlaybackRef,
    isSeekingRef: state.isSeekingRef,
    switchingUntilRef: state.switchingUntilRef,
  });

  useIosProcessedSinkRemoteSync({
    audioRef: state.audioRef,
    sinkAudioRef: audioEngine.processedSinkAudioRef,
    userWantsPlaybackRef: state.userWantsPlaybackRef,
    switchingUntilRef: state.switchingUntilRef,
    pausePlayback: () => playerCoreRef.current?.pause().catch(() => undefined),
    resumePlayback: handleSyncResume,
  });

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const stopPlaybackForLogout = () => {
      if (state.userWantsPlaybackRef) {
        state.userWantsPlaybackRef.current = false;
      }
      try { state.setIsPlaying(false); } catch { }
      try { playerStoreRef.current?.patch({ isPlaying: false, isBuffering: false, currentTime: 0, fsmState: 'IDLE' }); } catch { }
      try { state.currentTimeRef.current = 0; } catch { }
      try { state.setDuration(0); } catch { }
      try { state.setResolvedAudioUrl?.(null); } catch { }
      try { state.setResolvedAudioUrlExpiresAtMs?.(null); } catch { }
      try { playerCoreRef.current?.pause().catch(() => undefined); } catch { }

      const audio = state.audioRef?.current;
      if (audio) {
        try { audio.pause(); } catch { }
        try { audio.currentTime = 0; } catch { }
        try { audio.removeAttribute('src'); } catch { }
        try { audio.load(); } catch { }
      }

      try {
        if (typeof navigator !== 'undefined' && navigator.mediaSession) {
          navigator.mediaSession.playbackState = 'none';
          navigator.mediaSession.metadata = null;
        }
      } catch { }
    };

    window.addEventListener('earflow:auth:logout', stopPlaybackForLogout);
    return () => {
      try {
        window.removeEventListener('earflow:auth:logout', stopPlaybackForLogout);
      } catch { }
    };
  }, [state.audioRef, state.currentTimeRef, state.setDuration, state.setIsPlaying, state.setResolvedAudioUrl, state.setResolvedAudioUrlExpiresAtMs, state.userWantsPlaybackRef]);

  useEffect(() => {
    const audioEl = audioRef?.current;
    return () => {
      if (userWantsPlaybackRef) {
        userWantsPlaybackRef.current = false;
      }
      const audio = audioEl;
      if (audio) {
        try { audio.pause(); } catch { }
        try { audio.removeAttribute('src'); } catch { }
        try { audio.load(); } catch { }
      }
    };
  }, [audioRef, userWantsPlaybackRef]);

  useEffect(() => {
    const p = prefetcherRef.current;
    if (!p) return;
    const tracks = queueManager.effectiveTracks;
    if (!Array.isArray(tracks) || tracks.length === 0) return;
    p.update(tracks, currentTrackIndex);
  }, [currentTrackIndex, queueManager.effectiveTracks]);

  useQueueAutoRefill({
    queueSource: state.queueSource,
    currentTrackIndex,
    tracksLength: queueManager.effectiveTracks?.length ?? 0,
    recommendations,
  });

  const onEqGainChange = useMemo(() => {
    return (bandIndex, gainValue) => {
      ensureAudioActivated();
      const idx = Number(bandIndex);
      const v = Number(gainValue);
      if (!Number.isFinite(idx) || idx < 0) return;
      if (!Number.isFinite(v)) return;
      setEqGains((prev) => {
        const base = Array.isArray(prev) ? prev : [];
        const next = base.slice();
        while (next.length < 10) next.push(0);
        if (idx >= next.length) return next;
        next[idx] = v;
        return next;
      });
    };
  }, [ensureAudioActivated, setEqGains]);

  const setEqEnabledSafe = useCallback((next) => {
    ensureAudioActivated();
    setEqEnabled(!!next);
  }, [ensureAudioActivated, setEqEnabled]);

  useEffect(() => {
    const next = storeSnapshot.isSeeking;
    if (state.isSeekingRef) state.isSeekingRef.current = next;
    try { state.setIsSeeking?.(next); } catch { }
  }, [storeSnapshot.isSeeking, state.isSeekingRef, state.setIsSeeking]);

  useEffect(() => {
    const store = playerStoreRef.current;
    if (!store) return;
    const patch = {};
    if (store.get('volume') !== state.volume) {
      patch.volume = state.volume;
      persistField('volume', state.volume);
    }
    if (store.get('playbackRate') !== state.playbackRate) patch.playbackRate = state.playbackRate;
    if (store.get('preservePitch') !== state.preservePitch) {
      patch.preservePitch = state.preservePitch;
      persistField('preservePitch', state.preservePitch);
    }
    if (store.get('eqEnabled') !== state.eqEnabled) {
      patch.eqEnabled = state.eqEnabled;
      persistField('eqEnabled', state.eqEnabled);
    }
    if (store.get('eqGains') !== state.eqGains) {
      patch.eqGains = state.eqGains;
      persistField('eqGains', state.eqGains);
    }
    if (store.get('repeatMode') !== state.repeatMode) {
      patch.repeatMode = state.repeatMode;
      persistField('repeatMode', state.repeatMode);
    }
    if (store.get('shuffleEnabled') !== state.shuffleEnabled) {
      patch.shuffleEnabled = state.shuffleEnabled;
      persistField('shuffleEnabled', state.shuffleEnabled);
    }
    if (store.get('queueSource') !== state.queueSource) patch.queueSource = state.queueSource;
    if (store.get('queueName') !== state.queueName) patch.queueName = state.queueName;
    if (store.get('playbackEngine') !== state.playbackEngine) patch.playbackEngine = state.playbackEngine;
    if (store.get('lastErrorCode') !== state.lastErrorCode) patch.lastErrorCode = state.lastErrorCode;
    if (store.get('currentTrackIndex') !== state.currentTrackIndex) {
      patch.currentTrackIndex = state.currentTrackIndex;
      persistField('currentTrackIndex', state.currentTrackIndex);
    }
    if (Object.keys(patch).length > 0) store.patch(patch);
  }, [
    state.volume, state.playbackRate, state.preservePitch,
    state.eqEnabled, state.eqGains,
    state.repeatMode, state.shuffleEnabled,
    state.queueSource, state.queueName,
    state.playbackEngine, state.lastErrorCode,
    state.currentTrackIndex,
  ]);

  const playerStateValue = useMemo(() => ({
    tracks: queueManager.effectiveTracks,
    libraryTracks: queueManager.libraryTracks,
    recommendationTracks: queueManager.recommendationTracks,
    likedTracks: queueManager.likedQueueTracks,
    currentTrack,
    playbackEngine: storeSnapshot.playbackEngine || state.playbackEngine,
    currentTrackIndex: storeSnapshot.currentTrackIndex,
    playerStatus: state.playerStatus,
    isPlaying: storeSnapshot.isPlaying,
    isActuallyPlaying: storeSnapshot.fsmState === 'PLAYING',
    localOutputState,
    isBuffering: storeSnapshot.isBuffering,
    isSeeking: storeSnapshot.isSeeking,
    fsmState: storeSnapshot.fsmState,
    playbackRate: storeSnapshot.playbackRate,
    preservePitch: storeSnapshot.preservePitch,
    volume: storeSnapshot.volume,
    repeatMode: storeSnapshot.repeatMode,
    eqEnabled: storeSnapshot.eqEnabled,
    eqGains: storeSnapshot.eqGains,
    likedIds: state.likedIds,
    dislikedIds: state.dislikedIds,
    queueSource: storeSnapshot.queueSource,
    queueName: storeSnapshot.queueName,
    shuffleEnabled: storeSnapshot.shuffleEnabled,
    userSettings: state.userSettings,
    partyMode: partyManager.partyMode,
    partyInfo: partyManager.partyInfo,
    activePartyId,
    party: partyBridge.party,
    recommendations,
    recommendationsLoading: recommendations.loading,
  }), [
    queueManager.effectiveTracks,
    queueManager.libraryTracks,
    queueManager.recommendationTracks,
    queueManager.likedQueueTracks,
    currentTrack,
    storeSnapshot,
    state.playbackEngine,
    state.playerStatus,
    state.likedIds,
    state.dislikedIds,
    state.userSettings,
    localOutputState,
    partyManager.partyMode,
    partyManager.partyInfo,
    activePartyId,
    partyBridge.party,
    recommendations,
  ]);

  const playerProgressValue = useMemo(() => {
    const audioDuration = Number(state.duration);
    const trackDuration = resolveTrackDurationSeconds(currentTrack);
    const durationRaw = audioDuration > 0 ? audioDuration : trackDuration;
    return {
      duration: formatTime(durationRaw),
      durationRaw,
      currentTimeRef: state.currentTimeRef,
    };
  }, [state.duration, state.currentTimeRef, currentTrack]);

  const playerDispatchValue = useMemo(() => ({
    setUserSettings: state.setUserSettings,
    setVolume,
    setPlaybackRate: (next) => {
      ensureAudioActivated();
      const n = Number(next);
      if (!Number.isFinite(n)) return;
      setPlaybackRateState(n);
    },
    setPreservePitch: (next) => {
      ensureAudioActivated();
      setPreservePitchState(!!next);
    },
    setEqEnabled: setEqEnabledSafe,
    setEqGains: state.setEqGains,
    onEqGainChange,
    ensureAudioActivated,

    togglePlayPause: handleSyncPlayPause,
    playNextTrack: playNextTrackCore,
    playPreviousTrack: playPreviousTrackCore,
    seekToPercent: seekToPercentCore,
    handleTrackSelect: (track) => selectTrack(track),
    playFromList: (list, startId, queueName) => playFromListCore(list, startId, queueName),
    setLocalOutputState,
    projectPlaybackUiState,
    toggleLikeCurrent,
    toggleDislikeCurrent,
    cycleRepeatMode,
    toggleShuffle: toggleShuffleCore,
    loadSongs,
    switchToRecommendationsQueue: switchToRecommendationsQueueCore,
    switchToLibraryQueue: switchToLibraryQueueCore,
    switchToLikedQueue: switchToLikedQueueCore,
    refreshLikedQueue,
    playPlaylist: (...args) => playPlaylistCore(...args),
    playTrackById: (...args) => playTrackByIdCore(...args),
    applyRemotePlayback: (...args) => applyRemotePlaybackCore(...args),
    suspendLocalOutput,

    onPlayPause: handleSyncPlayPause,
    onNext: playNextTrackCore,
    onPrevious: playPreviousTrackCore,
    onTrackSelect: (track) => selectTrack(track),
    onVolumeChange: setVolume,
    onToggleLike: toggleLikeCurrent,
    onSwitchToRecommendations: switchToRecommendationsQueueCore,
    onSwitchToLibrary: switchToLibraryQueueCore,
    onSwitchToLiked: switchToLikedQueueCore,
    onRefreshLiked: refreshLikedQueue,
    onPlayPlaylist: (...args) => playPlaylistCore(...args),
    onProgressClick: handleProgressClickCore,

    beginSeek,
    updateSeek: updateSeekCore,
    commitSeek: seekToPercentCore,
    seekToSeconds: seekToSecondsCore,
    seekToPosition: seekToPositionCore,
    pausePlayback: () => playerCoreRef.current?.pause().catch(() => undefined),
    resumePlayback: handleSyncResume,

    enterPartyMode: partyManager.enterPartyMode,
    exitPartyMode: partyManager.exitPartyMode,
    playPartyTrack: partyManager.playPartyTrack,
    setActivePartyId,

    getCurrentPositionMs: () => Math.floor((currentTimeRef?.current || 0) * 1000),
    cyclePlaybackRate,
    handleProgressClick: handleProgressClickCore,

    audioRef: state.audioRef,
  }), [
    state.setUserSettings,
    setVolume,
    setEqEnabledSafe,
    state.setEqGains,
    currentTimeRef,
    onEqGainChange,
    ensureAudioActivated,
    seekToPercentCore,
    selectTrack,
    playFromListCore,
    toggleLikeCurrent,
    toggleDislikeCurrent,
    cycleRepeatMode,
    playPlaylistCore,
    playTrackByIdCore,
    applyRemotePlaybackCore,
    suspendLocalOutput,
    projectPlaybackUiState,
    setLocalOutputState,
    beginSeek,
    updateSeekCore,
    seekToSecondsCore,
    seekToPositionCore,
    cyclePlaybackRate,
    handleProgressClickCore,
    toggleShuffleCore,
    switchToRecommendationsQueueCore,
    switchToLibraryQueueCore,
    switchToLikedQueueCore,
    refreshLikedQueue,
    partyManager.enterPartyMode,
    partyManager.exitPartyMode,
    partyManager.playPartyTrack,
    setActivePartyId,
    loadSongs,
    state.audioRef,
    setPlaybackRateState,
    setPreservePitchState,
    handleSyncPlayPause,
    handleSyncResume,
    playNextTrackCore,
    playPreviousTrackCore,
  ]);

  return (
    <PlayerStoreContext.Provider value={playerStoreRef.current}>
      <PlayerDispatchContext.Provider value={playerDispatchValue}>
        <PlayerProgressContext.Provider value={playerProgressValue}>
          <PlayerStateContext.Provider value={playerStateValue}>
            {children}
            <audio
              key={audioElementKey}
              ref={state.audioRef}
              preload="metadata"
              playsInline
              webkit-playsinline="true"
              x-webkit-airplay="allow"
              crossOrigin="use-credentials"
              style={{
                position: 'absolute',
                width: 1,
                height: 1,
                overflow: 'hidden',
                clip: 'rect(0 0 0 0)',
                clipPath: 'inset(50%)',
                whiteSpace: 'nowrap',
                border: 0,
                padding: 0,
                margin: -1,
              }}
            />
          </PlayerStateContext.Provider>
        </PlayerProgressContext.Provider>
      </PlayerDispatchContext.Provider>
    </PlayerStoreContext.Provider>
  );
};

export default PlayerProvider;
