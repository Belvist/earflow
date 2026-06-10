import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { usePlayer, usePlayerState } from '../../context/PlayerContext';
import { usePlayerSheet } from '../../context/PlayerSheetContext';
import { usePlayerStoreSnapshot } from '../../hooks/usePlayerStoreSnapshot';
import MobilePlayerModal from '../MobilePlayerModal';
import { PartyDrawer } from '../Party';
import apiClient from '../../api/client';
import { useCoverAccentColor } from '../../utils/useCoverAccentColor';
import useMiniBarVariant from '../../hooks/useMiniBarVariant';
import { useSeekableProgress } from '../hooks/useSeekableProgress';
import useMiniPlayerGestureSession from './useMiniPlayerGestureSession';
import { PLAYER_SHEET_PHASE } from './playerSheetPhase';
import MiniPlayButtonIos from './MiniPlayButtonIos';
import MiniPlayButtonAdaptive from './MiniPlayButtonAdaptive';
import useMiniPlayStyle, { MINI_PLAY_STYLE } from '../../hooks/useMiniPlayStyle';
import { requestDeviceTiltPermission } from './useDeviceTiltGlare';
import { miniPlayIconColor } from '../../utils/miniPlayIconColor';
import { toListenerSameOriginCoverUrl } from '../../utils/listenerCoverUrl';
import { FaHeart, FaRegHeart } from 'react-icons/fa';
import {
  MiniPlayerShell,
  MiniPlayerContent,
  MiniPlayerMainRow,
  SwipeableTrackContainer,
  MiniTrackInfo,
  MiniAlbumCover,
  MiniCoverPlaceholder,
  MiniTrackDetails,
  MiniTrackTitle,
  MiniTrackArtist,
  MiniControlsCluster,
  MiniLikeSlot,
  MiniLikeHit,
  MiniPlayControl,
  MiniPlayInner,
  ProgressBarMini,
  ProgressFillMini,
  MobilePartyBadge,
} from './MobilePlayerBar.styles';

const MobilePlayerBar = ({ onOpenEq }) => {
  const [showParty, setShowParty] = useState(false);
  const player = usePlayer();
  const { likedIds } = usePlayerState();
  const store = usePlayerStoreSnapshot();
  const { registerOpenFullPlayer } = usePlayerSheet();
  const { variant, isClassic, isFloating } = useMiniBarVariant();
  const { style: playStyle } = useMiniPlayStyle();

  const currentTrack = player.currentTrack || (player.tracks && player.tracks[0]);
  const hasTrack = !!currentTrack;
  const partyMode = player.partyMode;
  const partyInfo = player.partyInfo;

  const durationSeconds = useMemo(() => {
    const candidates = [
      player.durationRaw,
      store.duration,
      currentTrack?.durationSeconds,
      currentTrack?.duration,
    ];
    for (const raw of candidates) {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return 0;
  }, [player.durationRaw, store.duration, currentTrack?.durationSeconds, currentTrack?.duration]);

  const {
    progressBarRef,
  } = useSeekableProgress({
    currentTimeRef: player.currentTimeRef,
    durationRaw: durationSeconds,
    isSeeking: store.isSeeking,
    disabled: true,
    progressBarId: 'mini-progress-bar',
  });

  const accentCoverUrl = useMemo(
    () => (currentTrack ? apiClient.getCoverUrl(currentTrack, true) : null),
    [currentTrack],
  );
  const accentSourceUrl = useMemo(() => {
    if (!accentCoverUrl) return '';
    return toListenerSameOriginCoverUrl(accentCoverUrl) || accentCoverUrl;
  }, [accentCoverUrl]);
  const miniCoverUrl = useMemo(
    () => (currentTrack ? apiClient.getCoverUrl(currentTrack) : null),
    [currentTrack],
  );
  const { background: accentBg } = useCoverAccentColor(accentSourceUrl, 0.5, 1);
  const playIconColor = useMemo(() => miniPlayIconColor(accentBg), [accentBg]);

  const {
    sheet,
    controls,
    cleanupTrackAnimation,
    resetTrackVisual,
    forceUnlockGestures,
    isTrackSwipeAnimating,
  } = useMiniPlayerGestureSession({ player });

  const isCurrentTrackLiked = useMemo(() => {
    const ctid = currentTrack ? Number.parseInt(String(currentTrack.id), 10) : NaN;
    return Number.isFinite(ctid) && likedIds?.has?.(ctid);
  }, [currentTrack, likedIds]);

  const handleLikeClick = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    player.toggleLikeCurrent();
  }, [player]);

  const handlePlayPause = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    if (playStyle === MINI_PLAY_STYLE.METALLIC) {
      requestDeviceTiltPermission();
    }
    player.togglePlayPause();
  }, [player, playStyle]);

  const handlePartyClick = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    setShowParty(true);
  }, []);

  const handleModalClose = useCallback(() => {
    sheet.stopSnapAnimation();
    sheet.cancel();
  }, [sheet]);

  const handleOpenParty = useCallback(() => {
    sheet.stopSnapAnimation();
    sheet.cancel();
    setShowParty(true);
  }, [sheet]);

  useEffect(() => {
    if (isTrackSwipeAnimating()) return;
    resetTrackVisual();
  }, [currentTrack?.id, isTrackSwipeAnimating, resetTrackVisual]);

  useEffect(() => {
    if (!accentSourceUrl) return undefined;
    const img = new Image();
    img.decoding = 'async';
    img.src = accentSourceUrl;
    return undefined;
  }, [accentSourceUrl]);

  useEffect(() => {
    if (!sheet.modalVisible) return;
    controls.set({ x: 0, y: 0, opacity: 1 });
  }, [sheet.modalVisible, controls]);

  // INV-SHEET-009: unlock once when entering CLOSED — not every render while closed.
  const prevSheetPhaseRef = useRef(sheet.phase);
  useEffect(() => {
    const prev = prevSheetPhaseRef.current;
    prevSheetPhaseRef.current = sheet.phase;
    if (prev === sheet.phase) return;
    if (sheet.phase !== PLAYER_SHEET_PHASE.CLOSED) return;
    forceUnlockGestures('sheet-closed-clear');
  }, [sheet.phase, forceUnlockGestures]);

  useEffect(() => () => {
    cleanupTrackAnimation();
  }, [cleanupTrackAnimation]);

  useEffect(() => {
    registerOpenFullPlayer(() => sheet.open());
    return () => registerOpenFullPlayer(null);
  }, [registerOpenFullPlayer, sheet.open]);

  if (!hasTrack) {
    return null;
  }

  const isPlayerSheetClosing = sheet.sheetOpen && !sheet.dragging;
  const hideMiniChrome = sheet.sheetOpen;
  // CLOSED (incl. snap-to-closed spring): never tie mini visibility to sheetProgress — it
  // can still be ~1 while y animates down, which zeroed opacity and dropped expand swipes.
  const miniAtRest = sheet.phase === PLAYER_SHEET_PHASE.CLOSED && !sheet.holdModalForCloseSnap;

  return (
    <>
      <AnimatePresence>
        {sheet.modalVisible && (
          <MobilePlayerModal
            key="mobile-player-modal"
            onClose={handleModalClose}
            currentTrack={currentTrack}
            sheetDragY={sheet.sheetDragY}
            sheetProgress={sheet.sheetProgress}
            sheetFullyOpen={sheet.sheetOpen}
            draggingFromMini={sheet.draggingFromMini}
            onSheetDragStart={sheet.beginSheetDrag}
            onSheetDragMove={sheet.applySheetDragDelta}
            onSheetDragSettle={sheet.settleDrag}
            onOpenEq={onOpenEq}
            onOpenParty={handleOpenParty}
          />
        )}
      </AnimatePresence>

      <MiniPlayerShell
        key={`mini-player-shell-${variant}-${playStyle}`}
        data-testid="mini-player-bar"
        data-mini-gesture-zone="true"
        data-mini-bar-variant={variant}
        data-mini-play-style={playStyle}
        data-mini-bar-ui="2026-06-v70-chrome-tune"
        $variant={variant}
        initial={false}
        animate={false}
        $accentBg={accentBg}
        style={{
          pointerEvents: sheet.miniBarPointerEvents,
          opacity: hideMiniChrome ? 0 : miniAtRest ? 1 : sheet.miniOpacity,
          y: hideMiniChrome ? 0 : miniAtRest ? 0 : sheet.miniY,
          scale: hideMiniChrome ? 1 : miniAtRest ? 1 : sheet.miniScale,
          borderRadius: isClassic ? 0 : miniAtRest ? 14 : sheet.miniRadius,
          '--mini-shell-radius': isClassic ? '0px' : `${miniAtRest ? 14 : sheet.miniRadius}px`,
          zIndex: isPlayerSheetClosing ? 10000 : undefined,
        }}
      >
        <MiniPlayerContent $variant={variant} className="ef-mini-player-content">
          <MiniPlayerMainRow $variant={variant} className="ef-mini-player-main">
            <SwipeableTrackContainer animate={controls}>
              <MiniTrackInfo>
                {miniCoverUrl ? (
                  <MiniAlbumCover
                    $variant={variant}
                    key={`mini-cover-${currentTrack.id}-${currentTrack.cover_path}`}
                    src={miniCoverUrl}
                    alt={currentTrack.title}
                    draggable={false}
                  />
                ) : (
                  <MiniCoverPlaceholder $variant={variant} aria-hidden="true">♪</MiniCoverPlaceholder>
                )}
                <MiniTrackDetails>
                  <MiniTrackTitle $variant={variant} data-testid="mini-player-track-title">{currentTrack.title}</MiniTrackTitle>
                  <MiniTrackArtist>{currentTrack.artist}</MiniTrackArtist>
                </MiniTrackDetails>
                {partyMode && partyInfo && (
                  <MobilePartyBadge
                    data-mini-no-drag="true"
                    onClick={handlePartyClick}
                    onTouchEnd={(e) => {
                      e.stopPropagation();
                      handlePartyClick(e);
                    }}
                    whileTap={{ scale: 0.95 }}
                  >
                    {partyInfo.isHost ? '👑' : '🎧'}
                  </MobilePartyBadge>
                )}
              </MiniTrackInfo>
            </SwipeableTrackContainer>

            <MiniControlsCluster data-testid="mini-player-controls">
              <MiniLikeSlot aria-hidden="true">
                <MiniLikeHit
                  type="button"
                  data-testid="mini-player-like"
                  data-mini-no-drag="true"
                  aria-label={isCurrentTrackLiked ? 'Убрать из избранного' : 'Нравится'}
                  title={isCurrentTrackLiked ? 'Убрать из избранного' : 'Нравится'}
                  $active={isCurrentTrackLiked}
                  $variant={variant}
                  onClick={handleLikeClick}
                  whileTap={{ scale: 0.88 }}
                >
                  {isCurrentTrackLiked ? <FaHeart /> : <FaRegHeart />}
                </MiniLikeHit>
              </MiniLikeSlot>

              <MiniPlayControl
                key={`mini-play-${playStyle}-${variant}`}
                data-testid="mini-player-play"
                data-play-style={playStyle}
                className={`ef-mini-play-control ef-mini-play--${playStyle}`}
                role="button"
                tabIndex={0}
                aria-label={player.isPlaying ? 'Пауза' : 'Воспроизведение'}
                onClick={handlePlayPause}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handlePlayPause(e);
                  }
                }}
                onTouchEnd={(e) => {
                  e.stopPropagation();
                  handlePlayPause(e);
                }}
                whileTap={{ scale: 0.94 }}
                data-mini-no-drag="true"
                $variant={variant}
                $playStyle={playStyle}
              >
                <MiniPlayInner $variant={variant} $playStyle={playStyle}>
                  {playStyle === MINI_PLAY_STYLE.METALLIC ? (
                    <MiniPlayButtonIos
                      isPlaying={player.isPlaying}
                      size={isClassic ? 34 : 42}
                      emphasis="high"
                    />
                  ) : (
                    <MiniPlayButtonAdaptive
                      isPlaying={player.isPlaying}
                      size={isClassic ? 32 : 42}
                      iconColor={playIconColor}
                    />
                  )}
                </MiniPlayInner>
              </MiniPlayControl>
            </MiniControlsCluster>
          </MiniPlayerMainRow>
        </MiniPlayerContent>

        <ProgressBarMini
          ref={progressBarRef}
          id="mini-progress-bar"
          data-testid="mini-player-progress"
          $variant={variant}
        >
          <ProgressFillMini className="ef-mini-progress-fill" />
        </ProgressBarMini>
      </MiniPlayerShell>

      <PartyDrawer isOpen={showParty} onClose={() => setShowParty(false)} />
    </>
  );
};

export default MobilePlayerBar;
