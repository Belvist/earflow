import React, { useCallback, useEffect, useMemo, useState, memo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { FaPlay, FaPause, FaStepForward, FaStepBackward, FaRedo, FaHeart, FaRegHeart, FaList, FaPlus, FaThumbsDown, FaRegThumbsDown } from 'react-icons/fa';
import apiClient from '../api/client';
import { usePlayerDispatch, usePlayerProgress, usePlayerState } from '../context/PlayerContext';
import { useDeviceSyncContext } from '../context/DeviceSyncContext';
import { DEVICE_SYNC_ENABLED } from '../api/runtimeConfig';
import useAuth from '../hooks/useAuth';
import { resolveArtistPath } from '../utils/artistRoute';
import ArtistLinks from './ArtistLinks';
import MobilePlayerModal from './MobilePlayerModal';
import PartyDrawer from './Party/PartyDrawer';
import { useSeekableProgress } from './hooks/useSeekableProgress';
import { AddToPlaylistMenu, CreatePlaylistModal } from './Playlist/index';
import BottomSheet from './BottomSheet';
import DevicesPanel from './DeviceSync/DevicesPanel';
import { buildDeviceSyncControlDispatch } from './DeviceSync/deviceSyncControls';
import { FiSliders } from 'react-icons/fi';
import { usePlaylistActions } from './hooks/usePlaylistActions';
import { useCoverAccentColor } from '../utils/useCoverAccentColor';
import useRecentlyPlayed from '../hooks/useRecentlyPlayed';
import { QueuePanel } from './queue-panel';
import { PanelShell } from './queue-panel/queuePanel.styles';
import { MOBILE_CHROME_OFFSET_PX } from '../styles/mediaCover';
import { usePlayerSheet } from '../context/PlayerSheetContext';
import {
  DeviceSyncStatusDot, DeviceSyncPanelBody, PartyBadge, PlayerBar, DislikeButtonBar, PlayerBarContent,
  ProgressSection, ProgressBar, ProgressFill, TimeDisplay,
  MainPlayerSection, LeftSection, CenterSection, RightSection,
  TrackInfoMini, AlbumCoverMini, TrackDetailsMini, TrackTitleMini, TrackArtistMini,
  PlayerControlsBar, ControlButton, ModeControlButton, ModeDot, ModeOneBadge,
  PlayPauseButton, VolumeSlider, EqToggle, LikeButtonBar,
} from './GlobalPlayerBar.styles';

const WINDOW_SIZE = 10;
const EMPTY_ARRAY = [];
const RAIL_EDGE_GAP_PX = 20;
const RAIL_PANEL_GAP_PX = 20;
const RAIL_MIN_CONTENT_PX = 280;

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function calculateRightRailLayout({ isMobile, showRecommendations, showParty, showDeviceSyncPanel, viewportWidth: rawViewportWidth }) {
  const panelCount = (showRecommendations ? 1 : 0) + (showParty ? 1 : 0) + (showDeviceSyncPanel ? 1 : 0);
  if (isMobile || panelCount === 0) {
    return { panelWidth: 380, reserve: 0 };
  }

  const viewportWidth = Number.isFinite(Number(rawViewportWidth)) && Number(rawViewportWidth) > 0
    ? Number(rawViewportWidth)
    : (typeof window !== 'undefined' ? window.innerWidth || 1440 : 1440);
  const baseWidth = clampNumber(Math.round(viewportWidth * 0.29), 360, 430);

  if (panelCount === 1) {
    const maxSingle = Math.max(320, viewportWidth - RAIL_MIN_CONTENT_PX - RAIL_EDGE_GAP_PX);
    const panelWidth = clampNumber(Math.min(baseWidth, maxSingle), 320, baseWidth);
    return {
      panelWidth,
      reserve: panelWidth + RAIL_EDGE_GAP_PX,
    };
  }

  const maxPairPanel = Math.floor(
    (viewportWidth - RAIL_MIN_CONTENT_PX - RAIL_EDGE_GAP_PX - RAIL_PANEL_GAP_PX) / 2
  );
  const panelWidth = clampNumber(Math.min(baseWidth, maxPairPanel), 280, baseWidth);

  return {
    panelWidth,
    reserve: (panelWidth * 2) + RAIL_EDGE_GAP_PX + RAIL_PANEL_GAP_PX,
  };
}

const GlobalPlayerBarComponent = ({ onOpenEq }) => {
  const [showFullPlayer, setShowFullPlayer] = useState(false);
  const [showRecommendations, setShowRecommendations] = useState(false);
  const [showParty, setShowParty] = useState(false);
  const [showDeviceSyncPanel, setShowDeviceSyncPanel] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => (
    typeof window !== 'undefined' ? window.innerWidth || 1440 : 1440
  ));
  const playerState = usePlayerState();
  const playerProgress = usePlayerProgress();
  const playerDispatch = usePlayerDispatch();
  const deviceSync = useDeviceSyncContext();
  const effectivePlayerDispatch = useMemo(
    () => buildDeviceSyncControlDispatch(playerDispatch, deviceSync),
    [playerDispatch, deviceSync]
  );
  // eslint-disable-next-line no-unused-vars
  const navigate = useNavigate();

  // Party mode state
  const { partyMode, partyInfo } = playerState;

  // Мемоизируем массивы чтобы избежать лишних ре-рендеров
  const allTracks = React.useMemo(
    () => Array.isArray(playerState.tracks) ? playerState.tracks : EMPTY_ARRAY,
    [playerState.tracks]
  );
  const libraryTracks = React.useMemo(
    () => Array.isArray(playerState.libraryTracks) ? playerState.libraryTracks : EMPTY_ARRAY,
    [playerState.libraryTracks]
  );
  const recommendationTracks = React.useMemo(
    () => Array.isArray(playerState.recommendationTracks) ? playerState.recommendationTracks : EMPTY_ARRAY,
    [playerState.recommendationTracks]
  );
  const likedTracks = React.useMemo(
    () => Array.isArray(playerState.likedTracks) ? playerState.likedTracks : EMPTY_ARRAY,
    [playerState.likedTracks]
  );

  // Показываем "окно" треков - максимум 10 штук от текущего
  const panelTracks = React.useMemo(() => {
    const currentIndex = playerState.currentTrackIndex || 0;
    const startIndex = Math.max(0, currentIndex);
    const endIndex = startIndex + WINDOW_SIZE;

    let source;
    if (playerState.queueSource === 'auto') {
      source = allTracks.length > 0 ? allTracks : recommendationTracks;
    } else if (playerState.queueSource === 'library') {
      source = libraryTracks.length > 0 ? libraryTracks : allTracks;
    } else if (playerState.queueSource === 'liked') {
      source = likedTracks.length > 0 ? likedTracks : allTracks;
    } else {
      source = allTracks;
    }

    return source.slice(startIndex, endIndex);
  }, [playerState.queueSource, playerState.currentTrackIndex, allTracks, libraryTracks, recommendationTracks, likedTracks]);

  const queueTitle = React.useMemo(() => {
    if (playerState.queueName) return playerState.queueName;
    if (playerState.queueSource === 'auto') return 'РЕКОМЕНДАЦИИ';
    if (playerState.queueSource === 'liked') return 'НРАВИТСЯ';
    if (playerState.queueSource === 'library') return 'МОИ ТРЕКИ';
    return 'ОЧЕРЕДЬ';
  }, [playerState.queueName, playerState.queueSource]);

  // Показываем бар, если в плеере вообще есть какие-либо треки.
  // Не завязываемся на panelTracks, потому что "окно" рекомендаций
  // может быть временно пустым при подгрузке.
  const hasAnyTracks =
    !!playerState.currentTrack ||
    (Array.isArray(playerState.tracks) && playerState.tracks.length > 0);

  // Мемоизируем текущий трек
  const currentTrack = React.useMemo(
    () => playerState.currentTrack || (Array.isArray(playerState.tracks) ? playerState.tracks[0] : null),
    [playerState.currentTrack, playerState.tracks]
  );

  const { user, isAuthenticated } = useAuth();
  const { recentlyPlayed, clearRecentlyPlayed } = useRecentlyPlayed(currentTrack, user?.id ?? null);

  const playlist = usePlaylistActions({ currentTrack });

  const { registerOpenFullPlayer } = usePlayerSheet();

  const openFullPlayer = useCallback((e) => {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (!currentTrack) return;
    setShowFullPlayer(true);
  }, [currentTrack]);

  useEffect(() => {
    registerOpenFullPlayer(() => {
      if (!currentTrack) return;
      setShowFullPlayer(true);
    });
    return () => registerOpenFullPlayer(null);
  }, [currentTrack, registerOpenFullPlayer]);

  const handleCoverKeyDown = useCallback((e) => {
    const key = e?.key;
    if (key === 'Enter' || key === ' ') {
      openFullPlayer(e);
    }
  }, [openFullPlayer]);

  const currentCoverUrl = React.useMemo(
    () => (currentTrack ? apiClient.getCoverUrl(currentTrack, false) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentTrack?.id, currentTrack?.cover_path]
  );

  const accentCoverUrl = React.useMemo(
    () => (currentTrack ? apiClient.getCoverUrl(currentTrack, true) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentTrack?.id, currentTrack?.cover_path]
  );

  const { background: accentBg } = useCoverAccentColor(accentCoverUrl, 0.5, 1);

  // Все хуки должны быть ДО условного return
  const handleTrackClick = React.useCallback((track) => {
    effectivePlayerDispatch.handleTrackSelect(track);
    setShowRecommendations(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectivePlayerDispatch]);

  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(max-width: 768px)');
    const apply = () => setIsMobile(!!mql.matches);
    apply();
    if (mql.addEventListener) {
      mql.addEventListener('change', apply);
      return () => mql.removeEventListener('change', apply);
    }
    mql.addListener(apply);
    return () => mql.removeListener(apply);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const apply = () => setViewportWidth(window.innerWidth || 1440);
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);

  const rightRailLayout = useMemo(
    () => calculateRightRailLayout({ isMobile, showRecommendations, showParty, showDeviceSyncPanel, viewportWidth }),
    [isMobile, showDeviceSyncPanel, showRecommendations, showParty, viewportWidth]
  );

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const root = document.documentElement;
    root.style.setProperty('--right-rail-width', `${Math.round(rightRailLayout.reserve)}px`);
    root.style.setProperty('--panel-rail-width', `${Math.round(rightRailLayout.panelWidth)}px`);
    root.style.setProperty('--panel-rail-gap', `${RAIL_PANEL_GAP_PX}px`);
    return undefined;
  }, [rightRailLayout]);

  useEffect(() => {
    return () => {
      if (typeof document === 'undefined') return;
      const root = document.documentElement;
      root.style.setProperty('--right-rail-width', '0px');
      root.style.setProperty('--panel-rail-width', '380px');
      root.style.setProperty('--panel-rail-gap', '20px');
    };
  }, []);

  const openPartyPanel = useCallback(() => {
    setShowRecommendations(false);
    setShowDeviceSyncPanel(false);
    setShowParty(true);
  }, []);

  const toggleQueuePanel = useCallback(() => {
    setShowDeviceSyncPanel(false);
    setShowRecommendations((v) => {
      const next = !v;
      if (next) setShowParty(false);
      return next;
    });
  }, []);

  const toggleDeviceSyncPanel = useCallback((e) => {
    e?.stopPropagation?.();
    e?.preventDefault?.();
    setShowRecommendations(false);
    setShowParty(false);
    setShowDeviceSyncPanel((v) => {
      const next = !v;
      if (next) {
        deviceSync?.enterRealtime?.();
        deviceSync?.refreshDeviceList?.();
      }
      return next;
    });
  }, [deviceSync]);

  const handleDeviceTransfer = useCallback((targetDeviceId) => {
    if (!targetDeviceId || typeof deviceSync?.transferTo !== 'function') return;
    const playback = deviceSync.timeline || deviceSync.nowPlaying;
    const resume = playback?.isPlaying !== false;
    deviceSync.enterRealtime?.();
    deviceSync.transferTo(targetDeviceId, { resume });
  }, [deviceSync]);

  const {
    isSeeking,
    displayTime: displayTimeLabel,
    progressBarRef,
    seekHandlers,
  } = useSeekableProgress({
    currentTimeRef: playerProgress.currentTimeRef,
    durationRaw: Number(playerProgress?.durationRaw || 0),
    isSeeking: playerState.isSeeking,
    disabled: !hasAnyTracks,
    progressBarId: 'global-progress-bar',
    onBeginSeek: effectivePlayerDispatch.beginSeek,
    onCommitSeek: effectivePlayerDispatch.commitSeek,
    onPreviewSeek: effectivePlayerDispatch.updateSeek,
    pollIntervalMs: 250,
  });

  const deviceSyncStatus = useMemo(() => {
    if (!DEVICE_SYNC_ENABLED || !deviceSync?.enabled) return null;
    const s = deviceSync.connectionState;
    if (s === 'disabled') return null;
    if (s === 'connected') {
      return { state: s, label: 'Устройства синхронизированы. Открыть устройства' };
    }
    if (s === 'standby') {
      return { state: s, label: 'Ожидание второго устройства. Открыть устройства' };
    }
    if (s === 'disconnected') {
      return { state: s, label: 'Устройства не подключены. Открыть устройства' };
    }
    if (s === 'connecting' || s === 'reconnecting') {
      return { state: s, label: 'Соединяем устройства. Открыть устройства' };
    }
    if (s === 'error') {
      const e = String(deviceSync.error || '');
      if (e === 'WS_HANDSHAKE_STORM') {
        return { state: s, label: 'Синхронизация устройств: много сбоев. Открыть устройства' };
      }
      return { state: s, label: `Ошибка синхронизации${e ? ` (${e})` : ''}. Открыть устройства` };
    }
    return null;
  }, [deviceSync]);

  if (!hasAnyTracks) {
    return null;
  }

  return (
    <>
      <PlayerBar
        data-testid="global-player-bar"
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.5 }}
        $accentBg={accentBg}
      >
        <PlayerBarContent>
          <ProgressSection>
            <TimeDisplay>{displayTimeLabel}</TimeDisplay>
            <ProgressBar
              ref={progressBarRef}
              id="global-progress-bar"
              style={undefined}
              onPointerDown={seekHandlers.onPointerDown}
              onPointerMove={seekHandlers.onPointerMove}
              onPointerUp={seekHandlers.onPointerUp}
              onPointerCancel={seekHandlers.onPointerCancel}
            >
              <ProgressFill $seeking={isSeeking} $buffering={!isSeeking && (playerState.fsmState === 'LOADING' || !!playerState.isBuffering)} />
            </ProgressBar>
            <TimeDisplay>{playerProgress.duration}</TimeDisplay>
          </ProgressSection>

          <MainPlayerSection>
            <LeftSection>
              <TrackInfoMini>
                {currentCoverUrl && (
                  <AlbumCoverMini
                    src={currentCoverUrl}
                    alt={currentTrack?.title || ''}
                    role="button"
                    tabIndex={0}
                    onClick={openFullPlayer}
                    onKeyDown={handleCoverKeyDown}
                    draggable={false}
                  />
                )}
                <TrackDetailsMini>
                  <TrackTitleMini>{currentTrack.title}</TrackTitleMini>
                  <TrackArtistMini
                    role="link"
                    tabIndex={0}
                  >
                    <ArtistLinks
                      value={currentTrack?.artist}
                      onNavigate={(name) => {
                        void resolveArtistPath(apiClient, name)
                          .then((path) => {
                            if (path) navigate(path);
                          })
                          .catch(() => { });
                      }}
                    />
                  </TrackArtistMini>
                </TrackDetailsMini>
                {deviceSyncStatus ? (
                  <DeviceSyncStatusDot
                    type="button"
                    $state={deviceSyncStatus.state}
                    onClick={toggleDeviceSyncPanel}
                    whileHover={{ scale: 1.08 }}
                    whileTap={{ scale: 0.94 }}
                    title={deviceSyncStatus.label}
                    aria-label={deviceSyncStatus.label}
                  />
                ) : null}
                {/* Party Mode Badge */}
                {partyMode && partyInfo && (
                  <PartyBadge
                    onClick={openPartyPanel}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    title="Открыть Party"
                  >
                    {partyInfo.isHost ? '👑 Хост' : '🎧 Party'}
                  </PartyBadge>
                )}
              </TrackInfoMini>
            </LeftSection>

            <CenterSection>
              <PlayerControlsBar>
                <ModeControlButton
                  $active={playerState.repeatMode !== 'off'}
                  onClick={effectivePlayerDispatch.cycleRepeatMode}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  title={
                    playerState.repeatMode === 'off' ? 'Повтор: выкл' :
                      playerState.repeatMode === 'all' ? 'Повтор плейлиста' : 'Повтор одного трека'
                  }
                >
                  <FaRedo />
                  {playerState.repeatMode !== 'off' && <ModeDot />}
                  {playerState.repeatMode === 'one' && <ModeOneBadge>1</ModeOneBadge>}
                </ModeControlButton>
                <ControlButton
                  onClick={effectivePlayerDispatch.playPreviousTrack}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                >
                  <FaStepBackward />
                </ControlButton>
                <PlayPauseButton
                  $isPlaying={playerState.isPlaying}
                  onClick={effectivePlayerDispatch.togglePlayPause}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                >
                  {playerState.isPlaying ? <FaPause /> : <FaPlay />}
                </PlayPauseButton>
                <ControlButton
                  onClick={effectivePlayerDispatch.playNextTrack}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                >
                  <FaStepForward />
                </ControlButton>
              </PlayerControlsBar>
            </CenterSection>

            <RightSection>
              <EqToggle
                onClick={playlist.openAddToPlaylist}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                title="Добавить в плейлист"
              >
                <FaPlus />
              </EqToggle>

              {(() => {
                const ctid = currentTrack ? Number.parseInt(String(currentTrack.id), 10) : NaN;
                const isLiked = Number.isFinite(ctid) && playerState.likedIds.has(ctid);
                const isDisliked = Number.isFinite(ctid) && playerState.dislikedIds.has(ctid);
                return (
                  <>
                    <LikeButtonBar
                      $active={isLiked}
                      onClick={effectivePlayerDispatch.toggleLikeCurrent}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      title={isLiked ? "Убрать из избранного" : "Добавить в избранное"}
                    >
                      {isLiked ? <FaHeart /> : <FaRegHeart />}
                    </LikeButtonBar>

                    <DislikeButtonBar
                      $active={isDisliked}
                      onClick={effectivePlayerDispatch.toggleDislikeCurrent}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      title={isDisliked ? "Убрать дизлайк" : "Дизлайк"}
                    >
                      {isDisliked ? <FaThumbsDown /> : <FaRegThumbsDown />}
                    </DislikeButtonBar>
                  </>
                );
              })()}

              <EqToggle
                $active={playerState.eqEnabled}
                onClick={onOpenEq}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                title="Эквалайзер"
              >
                <FiSliders />
              </EqToggle>

              {/* Party Button */}
              <EqToggle
                $active={partyMode}
                onClick={openPartyPanel}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                title="Listening Party"
              >
                🎧
                {partyMode && <ModeDot />}
              </EqToggle>

              <EqToggle
                $active={showRecommendations}
                onClick={toggleQueuePanel}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                title={showRecommendations ? 'Скрыть список треков' : 'Показать список треков'}
              >
                <FaList />
                {showRecommendations && <ModeDot />}
              </EqToggle>

              <VolumeSlider
                type="range"
                id="player-volume"
                name="player-volume"
                min={0}
                max={100}
                step={1}
                value={Math.round(Math.sqrt(playerState.volume) * 100)}
                $percent={Math.round(Math.sqrt(playerState.volume) * 100)}
                onChange={(e) => {
                  // Экспоненциальная шкала для более естественного контроля громкости
                  const sliderValue = parseFloat(e.target.value) / 100;
                  const actualVolume = sliderValue * sliderValue; // x^2 для плавного контроля
                  effectivePlayerDispatch.setVolume(actualVolume);
                }}
                title="Громкость"
              />
            </RightSection>
          </MainPlayerSection>
        </PlayerBarContent>
      </PlayerBar>

      {/* Queue Panel — mobile bottom sheet / desktop side panel (Spotify-style) */}
      {isMobile ? (
        <BottomSheet
          isOpen={showRecommendations}
          onClose={() => setShowRecommendations(false)}
          snapPoints={[0.72, 0.96]}
          initialSnap={0.72}
          bottomOffsetPx={MOBILE_CHROME_OFFSET_PX + 8}
          sideInsetPx={8}
          topInsetPx={12}
          showOverlay={false}
        >
          <QueuePanel
            nowPlayingLabel={currentTrack ? 'Сейчас играет' : 'Очередь'}
            queueTitle={queueTitle}
            queueTracks={panelTracks}
            recentTracks={recentlyPlayed}
            currentTrackId={currentTrack ? currentTrack.id : null}
            isPlaying={!!playerState.isPlaying}
            onSelectTrack={handleTrackClick}
            onClearRecent={clearRecentlyPlayed}
            onClose={() => setShowRecommendations(false)}
            showCloseButton={false}
          />
        </BottomSheet>
      ) : (
        <AnimatePresence>
          {showRecommendations && (
            <PanelShell
              key="queue-panel-desktop"
              initial={{ x: '100%', opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              $offset="20px"
              aria-label="Очередь и недавно прослушанные"
            >
              <QueuePanel
                nowPlayingLabel={currentTrack ? 'Сейчас играет' : 'Очередь'}
                queueTitle={queueTitle}
                queueTracks={panelTracks}
                recentTracks={recentlyPlayed}
                currentTrackId={currentTrack ? currentTrack.id : null}
                isPlaying={!!playerState.isPlaying}
                onSelectTrack={handleTrackClick}
                onClearRecent={clearRecentlyPlayed}
                onClose={() => setShowRecommendations(false)}
              />
            </PanelShell>
          )}
        </AnimatePresence>
      )}

      {!isMobile && isAuthenticated && DEVICE_SYNC_ENABLED && deviceSync?.enabled ? (
        <AnimatePresence>
          {showDeviceSyncPanel && (
            <PanelShell
              key="device-sync-panel-desktop"
              initial={{ x: '100%', opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              $offset="20px"
              aria-label="Устройства синхронизации"
            >
              <DeviceSyncPanelBody>
                <DevicesPanel
                  devices={deviceSync.devices}
                  nowPlaying={deviceSync.nowPlaying}
                  currentDeviceId={deviceSync.deviceId}
                  connectionState={deviceSync.connectionState}
                  onTransfer={handleDeviceTransfer}
                  onRemove={deviceSync.removeDevice}
                  onReconnect={deviceSync.reconnectNow}
                />
              </DeviceSyncPanelBody>
            </PanelShell>
          )}
        </AnimatePresence>
      ) : null}

      <AddToPlaylistMenu
        isOpen={playlist.showAddToPlaylist}
        onClose={playlist.closeAddToPlaylist}
        track={currentTrack}
        playlists={playlist.playlists}
        loading={playlist.playlistsLoading}
        onAddToPlaylist={playlist.handleAddToPlaylist}
        onCreateNew={playlist.handleCreateNewFromMenu}
      />

      <CreatePlaylistModal
        isOpen={playlist.showCreatePlaylist}
        onClose={playlist.closeCreatePlaylist}
        onSubmit={playlist.handleCreatePlaylistSubmit}
        loading={playlist.createPlaylistLoading}
      />

      <AnimatePresence>
        {showFullPlayer && (
          <MobilePlayerModal
            sheetFullyOpen
            sheetDragY={null}
            sheetProgress={null}
            onClose={() => setShowFullPlayer(false)}
            currentTrack={currentTrack}
            onOpenEq={onOpenEq}
            onOpenParty={() => {
              setShowFullPlayer(false);
              openPartyPanel();
            }}
          />
        )}
      </AnimatePresence>

      {/* Party Drawer - всегда справа */}
      <PartyDrawer
        isOpen={showParty}
        onClose={() => setShowParty(false)}
      />
    </>
  );
};

const GlobalPlayerBar = memo(GlobalPlayerBarComponent);
export default GlobalPlayerBar;
