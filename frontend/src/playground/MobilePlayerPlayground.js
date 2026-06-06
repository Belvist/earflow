/**
 * MobilePlayerPlayground - изолированная страница для e2e тестирования
 * мобильного плеера. НЕ использует реальный PlayerProvider/AuthProvider
 * (которые тащат сетевые запросы, audio engine, recommendations). Вместо
 * этого предоставляет fake context values с минимальным набором полей
 * нужных для MobilePlayerBar.
 *
 * Доступна по URL /playground/mobile-player. Используется только тестами
 * и при manual debugging - в production пользователь никогда сюда не попадёт
 * органически (нет ссылок на этот route).
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  PlayerStateContext,
  PlayerProgressContext,
  PlayerDispatchContext,
} from '../context/PlayerContext';
import { AuthContext } from '../context/AuthContext';
import { DeviceSyncContext } from '../context/DeviceSyncContext';
import PlayerChrome from '../components/PlayerChrome';

const FAKE_TRACKS = [
  {
    id: 1001,
    title: 'Playground Track Alpha',
    artist: 'Test Artist One',
    album: 'Test Album',
    cover_path: null,
    coverPath: null,
    duration: 200,
    durationSeconds: 200,
  },
  {
    id: 1002,
    title: 'Playground Track Beta',
    artist: 'Test Artist Two',
    album: 'Test Album',
    cover_path: null,
    coverPath: null,
    duration: 220,
    durationSeconds: 220,
  },
  {
    id: 1003,
    title: 'Playground Track Gamma',
    artist: 'Test Artist Three',
    album: 'Test Album',
    cover_path: null,
    coverPath: null,
    duration: 180,
    durationSeconds: 180,
  },
  {
    id: 1004,
    title: 'Playground Track Delta',
    artist: 'Test Artist Four',
    album: 'Test Album',
    cover_path: null,
    coverPath: null,
    duration: 240,
    durationSeconds: 240,
  },
];

const FAKE_USER = {
  id: 1,
  userId: 1,
  username: 'playground_user',
  email: 'test@earflow.local',
  displayName: 'Playground User',
};

const noop = () => {};
const asyncNoop = async () => undefined;

const MobilePlayerPlayground = () => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [likedIds, setLikedIds] = useState(() => new Set());
  const [dislikedIds, setDislikedIds] = useState(() => new Set());

  /**
   * Refs нужны MobilePlayerBar (player.currentTimeRef.current и т.д.).
   * Реальный PlayerContext использует refs для синхронной не-rerender логики.
   */
  const currentTimeRef = useRef(0);
  const userWantsPlaybackRef = useRef(true);
  const switchingUntilRef = useRef(0);
  const audioRef = useRef(null);

  const currentTrack = FAKE_TRACKS[currentIndex] || null;

  const playNextTrack = useCallback(async () => {
    setCurrentIndex((i) => (i + 1) % FAKE_TRACKS.length);
  }, []);

  const playPreviousTrack = useCallback(async () => {
    setCurrentIndex((i) => (i - 1 + FAKE_TRACKS.length) % FAKE_TRACKS.length);
  }, []);

  const togglePlayPause = useCallback(() => {
    setIsPlaying((p) => !p);
  }, []);

  const playerStateValue = useMemo(
    () => ({
      currentTrack,
      tracks: FAKE_TRACKS,
      currentTrackIndex: currentIndex,
      isPlaying,
      partyMode: false,
      partyInfo: null,
      likedIds,
      dislikedIds,
      userId: FAKE_USER.id,
      isAuthenticated: true,
      user: FAKE_USER,
      durationRaw: currentTrack?.duration || 0,
      currentTimeRef,
      userWantsPlaybackRef,
      switchingUntilRef,
      audioRef,
      activeTrackId: currentTrack?.id ?? null,
      queueSource: 'recommendations',
      queueName: 'Playground Queue',
      customQueue: [],
      shuffleEnabled: false,
      repeatMode: 'off',
      userSettings: {},
      volume: 1,
      isMuted: false,
      eqEnabled: false,
      eqGains: [],
      playbackRate: 1,
      preservePitch: false,
      partySession: null,
    }),
    [currentTrack, currentIndex, isPlaying, likedIds, dislikedIds],
  );

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__earflowPlayground = {
      currentTimeRef,
      durationRaw: Number(currentTrack?.duration || 200),
    };
    return () => {
      delete window.__earflowPlayground;
    };
  }, [currentTrack]);

  const playerProgressValue = useMemo(
    () => ({
      currentTime: 0,
      duration: currentTrack?.duration || 0,
      durationRaw: Number(currentTrack?.duration || 200),
      currentTimeRef,
      progressPercent: 0,
      formatTime: (secs) => {
        const s = Math.max(0, Math.floor(Number(secs) || 0));
        const m = Math.floor(s / 60);
        const r = s % 60;
        return `${m}:${r.toString().padStart(2, '0')}`;
      },
    }),
    [currentTrack],
  );

  const playerDispatchValue = useMemo(
    () => ({
      playNextTrack,
      playPreviousTrack,
      togglePlayPause,
      selectTrack: asyncNoop,
      playFromList: asyncNoop,
      playPlaylist: asyncNoop,
      playTrackById: asyncNoop,
      seek: noop,
      setVolume: noop,
      toggleMute: noop,
      toggleLikeCurrent: () => {
        if (!currentTrack) return;
        setLikedIds((prev) => {
          const next = new Set(prev);
          if (next.has(currentTrack.id)) next.delete(currentTrack.id);
          else next.add(currentTrack.id);
          return next;
        });
      },
      toggleDislikeCurrent: () => {
        if (!currentTrack) return;
        setDislikedIds((prev) => {
          const next = new Set(prev);
          if (next.has(currentTrack.id)) next.delete(currentTrack.id);
          else next.add(currentTrack.id);
          return next;
        });
      },
      setShuffleEnabled: noop,
      setRepeatMode: noop,
      setPlaybackRate: noop,
      setPreservePitch: noop,
      setEqGains: noop,
      setEqEnabled: noop,
      recordManualSkip: noop,
      ensureAudioActivated: asyncNoop,
      requireAuthFor: () => true,
    }),
    [playNextTrack, playPreviousTrack, togglePlayPause, currentTrack],
  );

  const authValue = useMemo(
    () => ({
      status: 'authenticated',
      user: FAKE_USER,
      isAuthenticated: true,
      isBooting: false,
      isGuest: false,
      isDegraded: false,
      error: null,
      revalidateSession: asyncNoop,
      logout: asyncNoop,
      showLoginModal: false,
      setShowLoginModal: noop,
      requireAuth: () => true,
    }),
    [],
  );

  /**
   * DeviceSyncContext = null — useDeviceSyncContext() в MobilePlayerModal
   * вернёт null, и buildDeviceSyncControlDispatch обработает это безопасно
   * (transparent passthrough к реальному player dispatch).
   */
  const deviceSyncValue = null;

  return (
    <AuthContext.Provider value={authValue}>
      <DeviceSyncContext.Provider value={deviceSyncValue}>
        <PlayerStateContext.Provider value={playerStateValue}>
          <PlayerProgressContext.Provider value={playerProgressValue}>
            <PlayerDispatchContext.Provider value={playerDispatchValue}>
              <div
                data-testid="playground-root"
                style={{
                  minHeight: '100vh',
                  background:
                    'linear-gradient(180deg, #1a1a2e 0%, #0f0f1a 100%)',
                  color: '#fff',
                  paddingTop: 20,
                  paddingBottom: 200,
                  fontFamily: 'system-ui, sans-serif',
                }}
              >
                <div style={{ padding: 20 }}>
                  <h1 style={{ fontSize: 24, marginBottom: 8 }}>
                    Mobile Player Playground
                  </h1>
                  <p style={{ opacity: 0.7, fontSize: 14, marginBottom: 16 }}>
                    Isolated mini-player for e2e gesture testing. Track index:{' '}
                    <span data-testid="playground-track-index">
                      {currentIndex}
                    </span>{' '}
                    | Playing:{' '}
                    <span data-testid="playground-is-playing">
                      {isPlaying ? 'yes' : 'no'}
                    </span>
                  </p>
                  {/**
                   * Fake "playlist carousel" - имитирует элементы под mini-bar,
                   * которые могут перехватывать pointer events. Используется
                   * в тесте 5 для проверки setPointerCapture фикса.
                   */}
                  <div
                    data-testid="playground-fake-waveform"
                    role="slider"
                    aria-label="Playground fake waveform seek"
                    aria-valuenow={0}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    style={{
                      height: 44,
                      margin: '8px 0 16px',
                      borderRadius: 8,
                      background: 'rgba(255, 255, 255, 0.12)',
                      touchAction: 'none',
                    }}
                  />
                  <div
                    data-testid="playground-fake-carousel"
                    style={{
                      display: 'flex',
                      gap: 12,
                      overflowX: 'auto',
                      padding: '20px 0',
                      touchAction: 'pan-x',
                    }}
                  >
                    {Array.from({ length: 10 }, (_, i) => (
                      <div
                        key={i}
                        style={{
                          minWidth: 140,
                          height: 140,
                          background: 'rgba(255, 255, 255, 0.08)',
                          borderRadius: 12,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 14,
                          opacity: 0.6,
                        }}
                      >
                        Fake Card {i + 1}
                      </div>
                    ))}
                  </div>
                </div>
                <PlayerChrome onOpenEq={noop} />
              </div>
            </PlayerDispatchContext.Provider>
          </PlayerProgressContext.Provider>
        </PlayerStateContext.Provider>
      </DeviceSyncContext.Provider>
    </AuthContext.Provider>
  );
};

export default MobilePlayerPlayground;
