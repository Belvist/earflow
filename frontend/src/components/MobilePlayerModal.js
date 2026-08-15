import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, memo } from "react";
import { AnimatePresence, motion, useMotionValue, useTransform } from 'framer-motion';
import { useCoverAccentColor } from '../utils/useCoverAccentColor';
import { toListenerSameOriginCoverUrl } from '../utils/listenerCoverUrl';
import { FaStepForward, FaStepBackward, FaChevronDown, FaRedo, FaHeart, FaRegHeart, FaThumbsDown, FaRegThumbsDown, FaListUl, FaEllipsisV, FaAlignLeft, FaTv } from 'react-icons/fa';
import PlayerSheetPlayButton from './MobilePlayerBar/PlayerSheetPlayButton';
import PlayerBackdrop from './MobilePlayerModal/PlayerBackdrop';
import { FiSliders } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
import { usePlayer } from '../context/PlayerContext';
import { useDeviceSyncContext } from '../context/DeviceSyncContext';
import { DEVICE_SYNC_ENABLED } from '../api/runtimeConfig';
import apiClient from '../api/client';
import { AddToPlaylistMenu, CreatePlaylistModal } from './Playlist/index';
import { usePlaylistActions } from './hooks/usePlaylistActions';
import { useSeekableProgress } from './hooks/useSeekableProgress';
import { resolveArtistPath } from '../utils/artistRoute';
import { buildTrackShareUrl, resolveTrackShareUrl } from '../utils/trackRoute';
import { LyricsView } from './Lyrics';
import useBodyScrollLock from '../hooks/useBodyScrollLock';
import useAuth from '../hooks/useAuth';
import useRecentlyPlayed from '../hooks/useRecentlyPlayed';
import { QueuePanel } from './queue-panel';
import BottomSheet from './BottomSheet';
import DevicesPanel from './DeviceSync/DevicesPanel';
import { buildDeviceSyncControlDispatch } from './DeviceSync/deviceSyncControls';
import {
  ModalOverlay,
  ContentLayer, ControlsDock, ModalHeader, CloseButton, TrackListOverlay, DragHandle,
  QueuePanelHost, ModalTitle, AlbumSection, AlbumBody, AlbumCoverLarge,
  TrackInfoSection, TrackTitleContainer, TrackTitleLarge, TrackArtistLarge,
  TrackArtistButton, TrackReasonText, ControlsSection, ProgressSection,
  ProgressBarContainer, ProgressBar, ProgressThumb, ProgressFill, TimeDisplay,
  MainControls, LikeButton, DislikeButton, MoreMenuContainer, MoreMenuDropdown,
  MoreMenuItem, ControlButton, AdditionalControls, ActionButton,
} from './MobilePlayerModal.styles';
import {
  GESTURE_AXIS,
  IOS_GESTURE,
  isInteractiveGestureTarget,
} from '../utils/gestureIntent';
import { getPlayerSheetClosedY, getPlayerSheetHeight, yToSheetProgress } from '../utils/playerSheetPhysics';
import {
  canSheetDragDismissFromTarget,
  getScrollTopFromGestureTarget,
  isQueueScrollBlockingSheetDismiss,
} from '../utils/sheetScrollHandoff';
import { GESTURE_CAPTURE_POLICY, GESTURE_SURFACE } from '../gestures/gestureContracts';
import { GESTURE_PROFILE } from '../gestures/gestureProfiles';
import { usePointerGestureMachine } from '../gestures/usePointerGestureMachine';
import useQueuePanelGesture from './MobilePlayerModal/useQueuePanelGesture';
import useModalAlbumGestures from './MobilePlayerModal/useModalAlbumGestures';

const WINDOW_SIZE = 10;
const EMPTY_ARRAY = [];
const DISMISS_INTENT_PX = IOS_GESTURE.intentPx;
const DISMISS_DOMINANCE = IOS_GESTURE.dominance;

const shouldIgnorePlayerDismissTarget = (target) => {
  return isInteractiveGestureTarget(target, [
    '[data-player-no-drag]',
    '[data-sheet-no-drag]',
    '[data-testid="queue-drag-handle"]',
    '#mobile-progress-bar',
  ]);
};

const getDismissClosedY = () => {
  return getPlayerSheetClosedY(getPlayerSheetHeight());
};

const clampNumber = (value, min, max) => Math.max(min, Math.min(max, value));

// Компонент бегущей строки для длинных названий
const MarqueeTitle = React.memo(({ title }) => {
  const containerRef = useRef(null);
  const textRef = useRef(null);
  const [shouldScroll, setShouldScroll] = useState(false);
  const [duration, setDuration] = useState(10);

  useEffect(() => {
    if (!containerRef.current || !textRef.current) return;

    const checkOverflow = () => {
      const container = containerRef.current;
      const text = textRef.current;
      if (!container || !text) return;

      const isOverflowing = text.scrollWidth > container.clientWidth;
      setShouldScroll(isOverflowing);

      if (isOverflowing) {
        // Рассчитываем длительность анимации на основе длины текста
        const textLength = title?.length || 0;
        const calculatedDuration = Math.max(8, Math.min(20, textLength * 0.3));
        setDuration(calculatedDuration);
      }
    };

    checkOverflow();
    window.addEventListener('resize', checkOverflow);
    return () => window.removeEventListener('resize', checkOverflow);
  }, [title]);

  if (!title) return null;

  return (
    <TrackTitleContainer ref={containerRef}>
      <TrackTitleLarge
        ref={textRef}
        $shouldScroll={shouldScroll}
        $duration={duration}
      >
        {shouldScroll ? `${title}${'\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0'}${title}` : title}
      </TrackTitleLarge>
    </TrackTitleContainer>
  );
});

const MobilePlayerModalComponent = ({
  onClose,
  currentTrack,
  onOpenEq,
  onOpenParty,
  sheetDragY = null,
  sheetProgress = null,
  sheetFullyOpen = false,
  draggingFromMini = false,
  onSheetDragStart,
  onSheetDragMove,
  onSheetDragSettle,
}) => {
  const player = usePlayer();
  const { user, isAuthenticated } = useAuth();
  const deviceSync = useDeviceSyncContext();
  const effectivePlayer = React.useMemo(
    () => buildDeviceSyncControlDispatch(player, deviceSync),
    [player, deviceSync]
  );
  const { recentlyPlayed, clearRecentlyPlayed } = useRecentlyPlayed(currentTrack, user?.id ?? null);

  const navigate = useNavigate();
  const [showTrackList, setShowTrackList] = useState(false);
  const [showReason, setShowReason] = useState(true);
  const [trackListExpanded, setTrackListExpanded] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showDeviceSheet, setShowDeviceSheet] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const playlist = usePlaylistActions({ currentTrack });
  const moreMenuRef = useRef(null);
  const fallbackSheetY = useMotionValue(0);
  const fallbackSheetProgress = useMotionValue(sheetFullyOpen ? 1 : 0);
  const yMotion = sheetDragY ?? fallbackSheetY;
  const progressMotion = sheetProgress ?? fallbackSheetProgress;
  // INV-SHEET-004: overlay chrome tracks finger 1:1 — no spring lag on open/close.
  const modalScale = useTransform(progressMotion, [0, 0.45, 1], [0.94, 0.985, 1]);
  const modalOpacity = useTransform(progressMotion, [0, 0.12, 0.45, 1], [0, 0.85, 1, 1]);
  const modalRadius = useTransform(progressMotion, [0, 1], [28, 0]);
  const backgroundOpacity = useTransform(progressMotion, [0, 0.35, 0.72, 1], [0, 0.55, 0.88, 1]);
  const contentOpacity = useTransform(progressMotion, [0.12, 0.74, 1], [0, 0.86, 1]);
  const contentY = useTransform(progressMotion, [0, 1], [24, 0]);
  const coverScale = useTransform(progressMotion, [0, 0.42, 1], [0.7, 0.9, 1]);
  const coverY = useTransform(progressMotion, [0, 1], [42, 0]);
  const trackInfoOpacity = useTransform(progressMotion, [0.38, 0.82, 1], [0, 0.88, 1]);
  const trackInfoY = useTransform(progressMotion, [0.2, 1], [20, 0]);
  const headerOpacity = useTransform(progressMotion, [0, 0.34, 0.58, 1], [0, 0, 1, 1]);
  const expandBodyGate = useTransform(progressMotion, [0, 0.64, 0.72, 1], [0, 0, 1, 1]);
  const contentLayerOpacity = useTransform(
    [contentOpacity, expandBodyGate],
    ([content, gate]) => (draggingFromMini ? content * gate : content),
  );
  const [showPlayerControls, setShowPlayerControls] = useState(false);
  const dismissCloseRef = useRef(false);
  const headerDismissDragRef = useRef(false);
  const [, setIsDismissDragging] = useState(false);
  const isSheetDragOpen = Boolean(sheetDragY) && !sheetFullyOpen;
  const useOwnedSheetDrag = Boolean(sheetDragY && onSheetDragStart && onSheetDragMove && onSheetDragSettle);

  useBodyScrollLock(true);

  // Guard: first mount frame during mini expand must not paint full sheet at y≈0.
  useLayoutEffect(() => {
    if (!draggingFromMini || !sheetDragY || !sheetProgress) return;
    const height = getPlayerSheetHeight();
    const closed = getPlayerSheetClosedY(height);
    const y = sheetDragY.get();
    if (y < closed * 0.35) {
      sheetDragY.set(closed);
      sheetProgress.set(0);
    }
  }, [draggingFromMini, sheetDragY, sheetProgress]);

  // Mount controls when sheet is visually open — not only phase OPEN (avoids empty dock after expand snap).
  useEffect(() => {
    const CONTROLS_PROGRESS = 0.86;
    const syncControls = (progress) => {
      if (draggingFromMini) {
        setShowPlayerControls(false);
        return;
      }
      setShowPlayerControls(sheetFullyOpen || progress >= CONTROLS_PROGRESS);
    };
    syncControls(progressMotion.get());
    return progressMotion.on('change', syncControls);
  }, [draggingFromMini, progressMotion, sheetFullyOpen]);

  const coverUrl = React.useMemo(() => {
    if (!currentTrack) return '';
    return apiClient.getCoverUrl(currentTrack, false) || '';
  }, [currentTrack]);

  const accentCoverUrl = React.useMemo(
    () => (currentTrack ? apiClient.getCoverUrl(currentTrack, true) : null),
    [currentTrack],
  );

  const accentSourceUrl = React.useMemo(() => {
    if (!accentCoverUrl) return '';
    return toListenerSameOriginCoverUrl(accentCoverUrl) || accentCoverUrl;
  }, [accentCoverUrl]);

  const { background: backdropAccent } = useCoverAccentColor(accentSourceUrl, 0.5, 1);

  const handleArtistNavigate = useCallback((raw) => {
    const name = typeof raw === 'string' ? raw : '';
    if (!name) return;
    void resolveArtistPath(apiClient, name)
      .then((path) => {
        if (!path) return;
        onClose?.();
        navigate(path);
      })
      .catch(() => { });
  }, [navigate, onClose]);

  const handleLyricsSeek = useCallback((seconds) => {
    const s = Number(seconds);
    if (!Number.isFinite(s) || s < 0) return;
    if (typeof effectivePlayer.seekToSeconds !== 'function') return;
    effectivePlayer.seekToSeconds(s);
  }, [effectivePlayer]);

  const openAddMenu = useCallback(async () => {
    setShowMoreMenu(false);
    await playlist.openAddToPlaylist();
  }, [playlist]);

  // Закрытие меню при клике вне
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target)) {
        setShowMoreMenu(false);
      }
    };
    if (showMoreMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [showMoreMenu]);

  const handleQueueExpand = useCallback(() => {
    setTrackListExpanded(true);
  }, []);

  const handleQueueCollapse = useCallback(() => {
    setTrackListExpanded(false);
  }, []);

  const handleQueueClose = useCallback(() => {
    setTrackListExpanded(false);
    setShowTrackList(false);
  }, []);

  const {
    handlers: queueHandleGestureHandlers,
    consumeClickIfDragged: consumeQueueHandleClick,
  } = useQueuePanelGesture({
    expanded: trackListExpanded,
    onExpand: handleQueueExpand,
    onCollapse: handleQueueCollapse,
    onClose: handleQueueClose,
  });

  const shouldIgnoreDismissGesture = useCallback((target) => {
    if (!useOwnedSheetDrag) return true;
    if (dismissCloseRef.current) return true;
    if (showDeviceSheet || showMoreMenu || showLyrics) return true;
    if (isQueueScrollBlockingSheetDismiss()) return true;
    if (getScrollTopFromGestureTarget(target) > 0) return true;
    return shouldIgnorePlayerDismissTarget(target);
  }, [showDeviceSheet, showLyrics, showMoreMenu, useOwnedSheetDrag]);

  const resetHeaderDismissDrag = useCallback(() => {
    headerDismissDragRef.current = false;
  }, []);

  const handleDismissCommit = useCallback(({ velocityY, dy }) => {
    resetHeaderDismissDrag();
    setIsDismissDragging(false);
    if (useOwnedSheetDrag) {
      onSheetDragSettle(velocityY, dy);
      return;
    }
    onClose?.();
  }, [onClose, onSheetDragSettle, resetHeaderDismissDrag, useOwnedSheetDrag]);

  const handleDismissActiveMove = useCallback(({ dy }) => {
    if (useOwnedSheetDrag) {
      onSheetDragMove(dy);
      return;
    }
    const nextY = clampNumber(dy, 0, getDismissClosedY());
    yMotion.set(nextY);
    if (sheetProgress) {
      sheetProgress.set(yToSheetProgress(nextY, getPlayerSheetHeight()));
    }
  }, [onSheetDragMove, sheetProgress, useOwnedSheetDrag, yMotion]);

  /** Sheet follows finger on first downward px — no 10px intent lock lag (INV-SHEET-004). */
  const handleDismissTrackingMove = useCallback(({ dy, absX, absY }) => {
    if (!useOwnedSheetDrag) return;
    if (dy <= 0) return;
    if (absY < 2) return;
    if (absX > absY * 1.05) return;
    if (!headerDismissDragRef.current) {
      headerDismissDragRef.current = true;
      onSheetDragStart('modal');
    }
    onSheetDragMove(dy);
  }, [onSheetDragMove, onSheetDragStart, useOwnedSheetDrag]);

  const { handlers: headerDismissHandlers } = usePointerGestureMachine({
    surfaceId: GESTURE_SURFACE.MODAL_DISMISS,
    profileId: GESTURE_PROFILE.DISMISS_DOWN,
    capturePolicy: GESTURE_CAPTURE_POLICY.AFTER_INTENT_LOCK,
    claimOnPointerDown: false,
    disabled: draggingFromMini,
    intentPx: DISMISS_INTENT_PX,
    dominance: DISMISS_DOMINANCE,
    shouldIgnoreTarget: shouldIgnoreDismissGesture,
    shouldActivate: ({ event, intent }) => {
      if (intent !== GESTURE_AXIS.VERTICAL) return false;
      if (isQueueScrollBlockingSheetDismiss()) return false;
      return canSheetDragDismissFromTarget(event.target);
    },
    onTrackingMove: handleDismissTrackingMove,
    onIntent: () => {
      setIsDismissDragging(true);
      if (useOwnedSheetDrag && !headerDismissDragRef.current) {
        headerDismissDragRef.current = true;
        onSheetDragStart('modal');
      }
    },
    onActiveMove: handleDismissActiveMove,
    onCommit: ({ state, dy, intent }) => {
      if (intent !== GESTURE_AXIS.VERTICAL) return;
      resetHeaderDismissDrag();
      handleDismissCommit({ velocityY: state.velocityY, dy });
    },
    onCancel: ({ intent }) => {
      if (intent !== GESTURE_AXIS.VERTICAL) return;
      resetHeaderDismissDrag();
      setIsDismissDragging(false);
      if (useOwnedSheetDrag) {
        onSheetDragSettle(0, 0);
      }
    },
  });

  const { handlers: albumGestureHandlers, coverShift } = useModalAlbumGestures({
    disabled: draggingFromMini || showLyrics,
    useOwnedSheetDrag,
    onSheetDragStart,
    onSheetDragMove,
    onSheetDragSettle,
    onDismissDragging: setIsDismissDragging,
    onNextTrack: effectivePlayer.playNextTrack,
    onPreviousTrack: effectivePlayer.playPreviousTrack,
  });

  // Мемоизируем массивы чтобы избежать лишних ре-рендеров
  const allTracks = React.useMemo(
    () => Array.isArray(player.tracks) ? player.tracks : EMPTY_ARRAY,
    [player.tracks]
  );
  const libraryTracks = React.useMemo(
    () => Array.isArray(player.libraryTracks) ? player.libraryTracks : EMPTY_ARRAY,
    [player.libraryTracks]
  );
  const recommendationTracks = React.useMemo(
    () => Array.isArray(player.recommendationTracks) ? player.recommendationTracks : EMPTY_ARRAY,
    [player.recommendationTracks]
  );
  const likedTracks = React.useMemo(
    () => Array.isArray(player.likedTracks) ? player.likedTracks : EMPTY_ARRAY,
    [player.likedTracks]
  );

  const queuePanelTracks = React.useMemo(() => {
    const currentIndex = player.currentTrackIndex || 0;
    const startIndex = Math.max(0, currentIndex);
    const endIndex = startIndex + WINDOW_SIZE;

    let source;
    if (player.queueSource === 'auto') {
      source = allTracks.length > 0 ? allTracks : recommendationTracks;
    } else if (player.queueSource === 'library') {
      source = libraryTracks.length > 0 ? libraryTracks : allTracks;
    } else if (player.queueSource === 'liked') {
      source = likedTracks.length > 0 ? likedTracks : allTracks;
    } else {
      source = allTracks;
    }

    return source.slice(startIndex, endIndex);
  }, [player.queueSource, player.currentTrackIndex, allTracks, libraryTracks, recommendationTracks, likedTracks]);

  const queueTitle = React.useMemo(() => {
    if (player.queueName) return player.queueName;
    if (player.queueSource === 'auto') return 'РЕКОМЕНДАЦИИ';
    if (player.queueSource === 'liked') return 'НРАВИТСЯ';
    if (player.queueSource === 'library') return 'МОИ ТРЕКИ';
    return 'ОЧЕРЕДЬ';
  }, [player.queueName, player.queueSource]);

  const handleQueueTrackSelect = useCallback((track) => {
    if (!track) return;
    effectivePlayer.handleTrackSelect(track);
    setShowTrackList(false);
  }, [effectivePlayer]);

  useEffect(() => {
    if (!currentTrack || !currentTrack.id) {
      setShowReason(false);
      return;
    }
    setShowReason(true);
    const timer = setTimeout(() => {
      setShowReason(false);
    }, 12000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id]); // Only re-run when track changes

  // ============================================
  // SEEK + TIME ENGINE (shared hook)
  // ============================================
  const {
    isSeeking,
    displayTime: displayTimeLabel,
    progressBarRef,
    seekHandlers,
  } = useSeekableProgress({
    currentTimeRef: player.currentTimeRef,
    durationRaw: Number(player?.durationRaw || 0),
    isSeeking: player.isSeeking,
    disabled: Number(player?.durationRaw) <= 0,
    progressBarId: 'mobile-progress-bar',
    onBeginSeek: effectivePlayer.beginSeek,
    onCommitSeek: effectivePlayer.commitSeek,
    onPreviewSeek: effectivePlayer.updateSeek,
    pollIntervalMs: 250,
  });

  const currentTimeRaw = Number(player?.currentTimeRef?.current || 0);
  const overlayStyle = {
    y: yMotion,
    opacity: modalOpacity,
    scale: modalScale,
    borderRadius: modalRadius,
    pointerEvents: draggingFromMini ? 'none' : 'auto',
  };

  return (
    <ModalOverlay
      data-testid="mobile-player-modal"
      initial={false}
      animate={undefined}
      exit={undefined}
      transition={{ duration: 0 }}
      style={overlayStyle}
      $dragPreview={isSheetDragOpen}
    >
      <PlayerBackdrop
        accentColor={backdropAccent}
        style={{ opacity: backgroundOpacity }}
      />

      <ContentLayer
        style={{
          opacity: contentLayerOpacity,
          y: contentY,
        }}
      >
        <ModalHeader
          as={motion.div}
          style={{ opacity: headerOpacity }}
          onPointerDownCapture={headerDismissHandlers.onPointerDown}
          onPointerMoveCapture={headerDismissHandlers.onPointerMove}
          onPointerUpCapture={headerDismissHandlers.onPointerUp}
          onPointerCancelCapture={headerDismissHandlers.onPointerCancel}
        >
          <CloseButton onClick={onClose} whileTap={{ scale: 0.9 }}>
            <FaChevronDown />
          </CloseButton>
          <ModalTitle>Сейчас играет</ModalTitle>
          <div style={{ width: 40 }} /> {/* Spacer */}
        </ModalHeader>

        <AlbumSection
          data-testid="player-album-section"
          data-lyrics-mode={showLyrics ? 'true' : undefined}
          $lyricsMode={showLyrics}
          onPointerDownCapture={albumGestureHandlers.onPointerDown}
          onPointerMoveCapture={albumGestureHandlers.onPointerMove}
          onPointerUpCapture={albumGestureHandlers.onPointerUp}
          onPointerCancelCapture={albumGestureHandlers.onPointerCancel}
        >
          {showLyrics ? (
            <LyricsView
              songId={currentTrack?.id}
              currentTime={currentTimeRaw}
              onSeek={handleLyricsSeek}
            />
          ) : (
            <AlbumBody>
              <AlbumCoverLarge
                key={`cover-${currentTrack.id}`}
                src={coverUrl}
                alt={currentTrack.title}
                initial={false}
                animate={coverShift}
                style={showPlayerControls ? undefined : { scale: coverScale, y: coverY }}
                loading="lazy"
                decoding="async"
              />

              <TrackInfoSection
                initial={false}
                animate={false}
                style={showPlayerControls
                  ? { opacity: 1, y: 0 }
                  : { opacity: trackInfoOpacity, y: trackInfoY }}
              >
                <MarqueeTitle title={currentTrack.title} />
                <TrackArtistButton whileTap={{ scale: 0.98 }}>
                  <TrackArtistLarge value={currentTrack.artist} onNavigate={handleArtistNavigate} />
                </TrackArtistButton>
                {currentTrack.reason && showReason && (
                  <TrackReasonText>{currentTrack.reason}</TrackReasonText>
                )}
              </TrackInfoSection>
            </AlbumBody>
          )}
        </AlbumSection>

        {showPlayerControls ? (
        <ControlsDock data-testid="player-controls-dock">
        <ControlsSection>
          <ProgressSection>
            <ProgressBarContainer
              ref={progressBarRef}
              id="mobile-progress-bar"
              style={undefined}
              onPointerDown={seekHandlers.onPointerDown}
              onPointerMove={seekHandlers.onPointerMove}
              onPointerUp={seekHandlers.onPointerUp}
              onPointerCancel={seekHandlers.onPointerCancel}
            >
              <ProgressBar>
                <ProgressFill
                  $seeking={isSeeking}
                  $buffering={player.fsmState === 'LOADING' || player.isBuffering}
                />
                <ProgressThumb $active={isSeeking} />
              </ProgressBar>
            </ProgressBarContainer>
            <TimeDisplay>
              <span>{displayTimeLabel}</span>
              <span>{player.duration}</span>
            </TimeDisplay>
          </ProgressSection>

          <MainControls>
            {(() => {
              const ctid = currentTrack ? Number.parseInt(String(currentTrack.id), 10) : NaN;
              const isLiked = Number.isFinite(ctid) && player.likedIds?.has?.(ctid);
              const isDisliked = Number.isFinite(ctid) && player.dislikedIds?.has?.(ctid);
              return (
                <>
                  <DislikeButton
                    onClick={effectivePlayer.toggleDislikeCurrent}
                    whileTap={{ scale: 0.85 }}
                    $active={isDisliked}
                    title={isDisliked ? 'Убрать дизлайк' : 'Не нравится'}
                  >
                    {isDisliked ? <FaThumbsDown /> : <FaRegThumbsDown />}
                  </DislikeButton>

                  <ControlButton
                    onClick={effectivePlayer.playPreviousTrack}
                    whileTap={{ scale: 0.9 }}
                  >
                    <FaStepBackward />
                  </ControlButton>

                  <PlayerSheetPlayButton
                    isPlaying={player.isPlaying}
                    isLoading={
                      player.fsmState === 'LOADING'
                      || player.fsmState === 'SEEKING'
                      || player.isBuffering
                    }
                    onClick={effectivePlayer.togglePlayPause}
                    whileTap={{ scale: 0.9 }}
                  />

                  <ControlButton
                    onClick={effectivePlayer.playNextTrack}
                    whileTap={{ scale: 0.9 }}
                  >
                    <FaStepForward />
                  </ControlButton>

                  <LikeButton
                    onClick={effectivePlayer.toggleLikeCurrent}
                    whileTap={{ scale: 0.85 }}
                    $active={isLiked}
                    title={isLiked ? 'Убрать из избранного' : 'Нравится'}
                  >
                    {isLiked ? <FaHeart /> : <FaRegHeart />}
                  </LikeButton>
                </>
              );
            })()}
          </MainControls>

          <AdditionalControls>
            <ActionButton
              onClick={effectivePlayer.cycleRepeatMode}
              whileTap={{ scale: 0.95 }}
              $active={player.repeatMode !== 'off'}
              title={
                player.repeatMode === 'off'
                  ? 'Повтор: выкл'
                  : player.repeatMode === 'all'
                    ? 'Повтор плейлиста'
                    : 'Повтор одного трека'
              }
              style={{ position: 'relative', overflow: 'hidden' }}
            >
              <FaRedo style={{ fontSize: player.repeatMode === 'one' ? '14px' : '18px' }} />
              {player.repeatMode === 'one' && (
                <span style={{
                  position: 'absolute',
                  fontSize: '10px',
                  fontWeight: 'bold',
                  bottom: '6px',
                  right: '8px',
                  color: 'inherit',
                  lineHeight: 1
                }}>1</span>
              )}
            </ActionButton>

            <ActionButton
              onClick={() => setShowLyrics(!showLyrics)}
              $active={showLyrics}
              title={showLyrics ? 'Скрыть текст' : 'Текст песни'}
            >
              <FaAlignLeft />
            </ActionButton>

            <ActionButton
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowTrackList(true)}
              title="Список треков"
            >
              <FaListUl />
            </ActionButton>

            {/* Кнопка меню (3 точки) для дополнительных опций */}
            <MoreMenuContainer ref={moreMenuRef}>
              <ActionButton
                onClick={() => setShowMoreMenu(!showMoreMenu)}
                whileTap={{ scale: 0.95 }}
                $active={showMoreMenu}
                title="Ещё"
              >
                <FaEllipsisV />
              </ActionButton>

              <AnimatePresence>
                {showMoreMenu && (
                  <MoreMenuDropdown
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                  >
                    {typeof onOpenEq === 'function' ? (
                      <MoreMenuItem
                        onClick={() => {
                          onOpenEq();
                          setShowMoreMenu(false);
                        }}
                      >
                        <span style={{ display: 'inline-flex' }}><FiSliders size={16} /></span>
                        Эквалайзер
                      </MoreMenuItem>
                    ) : null}
                    {isAuthenticated && DEVICE_SYNC_ENABLED && deviceSync?.enabled ? (
                      <MoreMenuItem
                        onClick={() => {
                          setShowDeviceSheet(true);
                          setShowMoreMenu(false);
                        }}
                        $active={false}
                      >
                        <span style={{ display: 'inline-flex' }}><FaTv size={14} /></span>
                        Устройства
                      </MoreMenuItem>
                    ) : null}
                    <MoreMenuItem
                      onClick={() => {
                        onOpenParty?.();
                        setShowMoreMenu(false);
                      }}
                      $active={player.partyMode}
                    >
                      <span>🎧</span>
                      Listening Party
                    </MoreMenuItem>
                    <MoreMenuItem
                      onClick={() => {
                        openAddMenu();
                      }}
                    >
                      <span>📋</span>
                      Добавить в плейлист
                    </MoreMenuItem>
                    <MoreMenuItem
                      onClick={async () => {
                        // Поделиться треком
                        const trackToShare = currentTrack;
                        if (navigator.share && trackToShare) {
                          let shareUrl = buildTrackShareUrl(trackToShare);
                          if (!shareUrl) shareUrl = await resolveTrackShareUrl(apiClient, trackToShare);
                          if (shareUrl) {
                            navigator.share({
                              title: trackToShare.title,
                              text: `${trackToShare.title} - ${trackToShare.artist}`,
                              url: shareUrl
                            }).catch(() => { });
                          }
                        }
                        setShowMoreMenu(false);
                      }}
                    >
                      <span>📤</span>
                      Поделиться
                    </MoreMenuItem>
                  </MoreMenuDropdown>
                )}
              </AnimatePresence>
            </MoreMenuContainer>
          </AdditionalControls>
        </ControlsSection>
        </ControlsDock>
        ) : null}

        {/* EQ Modal будем добавлять отдельно */}

        <AnimatePresence>
          {showTrackList && (
            <TrackListOverlay
              data-testid="queue-panel-overlay"
              data-expanded={trackListExpanded ? 'true' : 'false'}
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              $expanded={trackListExpanded}
              onPointerDownCapture={queueHandleGestureHandlers.onPointerDown}
              onPointerMoveCapture={queueHandleGestureHandlers.onPointerMove}
              onPointerUpCapture={queueHandleGestureHandlers.onPointerUp}
              onPointerCancelCapture={queueHandleGestureHandlers.onPointerCancel}
              onClickCapture={consumeQueueHandleClick}
            >
              <DragHandle data-testid="queue-drag-handle" />
              <QueuePanelHost>
                <QueuePanel
                  nowPlayingLabel={currentTrack ? 'Сейчас играет' : 'Очередь'}
                  queueTitle={queueTitle}
                  queueTracks={queuePanelTracks}
                  recentTracks={recentlyPlayed}
                  currentTrackId={currentTrack ? currentTrack.id : null}
                  isPlaying={!!player.isPlaying}
                  onSelectTrack={handleQueueTrackSelect}
                  onClearRecent={clearRecentlyPlayed}
                  onClose={handleQueueClose}
                  showCloseButton
                />
              </QueuePanelHost>
            </TrackListOverlay>
          )}
        </AnimatePresence>

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

        {isAuthenticated && DEVICE_SYNC_ENABLED && deviceSync?.enabled ? (
          <BottomSheet
            isOpen={showDeviceSheet}
            onClose={() => setShowDeviceSheet(false)}
            snapPoints={[0.5, 0.92]}
            initialSnap={0.55}
            bottomOffsetPx={64}
          >
            <div
              style={{
                padding: '0 0 max(8px, env(safe-area-inset-bottom, 0px))',
                paddingLeft: 'max(14px, env(safe-area-inset-left, 0px))',
                paddingRight: 'max(14px, env(safe-area-inset-right, 0px))',
                boxSizing: 'border-box',
                maxWidth: '100%',
              }}
            >
              <DevicesPanel
                showTitle
                devices={deviceSync.devices}
                nowPlaying={deviceSync.nowPlaying}
                currentDeviceId={deviceSync.deviceId}
                connectionState={deviceSync.connectionState}
                onTransfer={deviceSync.transferTo}
                onRemove={deviceSync.removeDevice}
                onReconnect={deviceSync.reconnectNow}
              />
            </div>
          </BottomSheet>
        ) : null}

      </ContentLayer>

    </ModalOverlay>
  );
};

const MobilePlayerModal = memo(MobilePlayerModalComponent);
export default MobilePlayerModal;
