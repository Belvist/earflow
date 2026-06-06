/* eslint-disable no-unused-vars */
import React, { useCallback } from 'react';
import { motion } from 'framer-motion';
import styled from 'styled-components';
import { useNavigate } from 'react-router-dom';
import ArtistLinks from './ArtistLinks';
import apiClient from '../api/client';

import useAuth from '../hooks/useAuth';
import { usePlayerState } from '../context/PlayerContext';
import useUserPlaylists from '../hooks/usePlaylists';
import { redirectToAuth, buildReturnToFromCurrentLocation } from '../utils/authRedirect';
import { buildPlaylistPathFromIdentifier, extractPlaylistIdentifier } from '../utils/playlistUrls';
import useTrackReason from './MusicPlayer/useTrackReason';
import { resolveArtistPath } from '../utils/artistRoute';

import PlaylistSection from './PlaylistSection';
import useDiscoverRails from '../hooks/useDiscoverRails';
import useCoverStack from './MusicPlayer/useCoverStack';
import PopularArtistsSection from './PopularArtistsSection';
import { GESTURE_PROFILE, getGestureProfile } from '../gestures/gestureProfiles';
import { GESTURE_CAPTURE_POLICY, GESTURE_SURFACE } from '../gestures/gestureContracts';
import { usePointerGestureMachine } from '../gestures/usePointerGestureMachine';
import { GESTURE_AXIS } from '../utils/gestureIntent';
import useMediaQuery from '../hooks/useMediaQuery';
import HomeDesktopHeroV3 from './MusicPlayer/HomeDesktopHeroV3';
import HomeMobileHeroV3 from './MusicPlayer/HomeMobileHeroV3';
import { DesktopHomeRoot, CategoryTabs, CategoryTab } from './MusicPlayer/HomeDesktopShell.styles';
import { MobileHomeRoot } from './MusicPlayer/HomeMobileShell.styles';
import HomeForYouRow from './MusicPlayer/HomeForYouRow';
import HomeForYouList from './MusicPlayer/HomeForYouList';
import HomeMoodChips from './MusicPlayer/HomeMoodChips';
import { usePlayerSheet } from '../context/PlayerSheetContext';

const horizontalSwipeProfile = getGestureProfile(GESTURE_PROFILE.HORIZONTAL_SWIPE);

const HOME_SECTIONS_DELAY_MS = 900;

/** Avoid duplicate «Для вас» next to «Слушайте дальше» on desktop home. */
function formatDiscoverRailTitle(title) {
  const t = String(title || '').trim();
  if (!t) return 'Подборки';
  if (/^для\s+вас$/iu.test(t)) return 'Открытия для вас';
  return t;
}

function useDeferredHomeSections() {
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined') {
      setReady(true);
      return undefined;
    }

    let timeoutId = 0;
    let idleId = 0;
    let done = false;
    const activate = () => {
      if (done) return;
      done = true;
      if (timeoutId) window.clearTimeout(timeoutId);
      setReady(true);
    };

    timeoutId = window.setTimeout(activate, HOME_SECTIONS_DELAY_MS);
    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(activate, { timeout: HOME_SECTIONS_DELAY_MS });
    }

    return () => {
      done = true;
      if (timeoutId) window.clearTimeout(timeoutId);
      if (idleId && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      }
    };
  }, []);

  return ready;
}

const PlayerContainer = styled.div`
  width: 100%;
  min-height: 100vh;
  min-height: calc(var(--app-vh, 1vh) * 100);
  background: var(--ef-surface-main, #0d0d0d);
  position: relative;
  overflow-x: hidden;
  overflow-y: visible;
  display: flex;
  flex-direction: column;
  padding-bottom: var(--player-bar-height-safe, 72px);
  overscroll-behavior-y: auto;

  @media (min-width: 768px) {
    padding-bottom: var(--desktop-player-bar-height, 90px);
  }
`;

const BackgroundLayer = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: calc((var(--app-vh, 1vh) * 100) - 100px);
  background: rgba(0, 0, 0, 0.11);
  backdrop-filter: blur(24.15px);
  z-index: 1;
  pointer-events: none;
`;

const MainPlayerSection = styled.div`
  position: relative;
  z-index: 2;
  width: 100%;
  max-width: 700px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding: 10px 16px 12px;
  margin: 0 auto;

  @media (min-width: 480px) {
    padding: 14px 20px 16px;
  }

  @media (min-width: 768px) {
    max-width: 1120px;
    align-items: stretch;
    padding: 20px 28px 18px;
  }

  @media (min-width: 1440px) {
    max-width: 1180px;
    padding: 24px 36px 20px;
  }
`;

const QueueSourceSwitch = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(20px);
  margin-bottom: 16px;

  @media (min-width: 768px) {
    align-self: flex-start;
    margin-bottom: 20px;
  }
`;

const QueueSourceButton = styled.button`
  padding: 6px 16px;
  border-radius: 999px;
  border: none;
  font-size: 11px;
  font-family: 'Unbounded', sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: ${(props) => (props.$active ? 'black' : 'rgba(255, 255, 255, 0.8)')};
  background: ${(props) => (props.$active ? 'rgba(255, 255, 255, 0.96)' : 'transparent')};
  box-shadow: ${(props) => (props.$active ? '0 10px 30px rgba(0, 0, 0, 0.7)' : 'none')};
  cursor: ${(props) => (props.disabled ? 'default' : 'pointer')};
  opacity: ${(props) => (props.disabled ? 0.6 : 1)};
  transition: all 0.25s ease;

  &:hover {
    background: ${(props) => (props.$active ? 'white' : 'rgba(255, 255, 255, 0.06)')};
  }

  @media (min-width: 768px) {
    padding: 10px 20px;
    font-size: 12px;
  }
`;

const AlbumCoverContainer = styled(motion.div)`
  position: relative;
  width: 200px;
  height: 250px;
  margin-bottom: 18px;
  will-change: transform;
  transform: translate3d(0, 0, 0);
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;

  @media (min-width: 480px) {
    width: 240px;
    height: 300px;
    margin-bottom: 24px;
  }

  @media (min-width: 768px) {
    width: 280px;
    height: 350px;
    margin-bottom: 28px;
  }

  @media (min-width: 1024px) {
    width: 300px;
    height: 375px;
    margin-bottom: 36px;
  }

  @media (min-width: 1440px) {
    width: 310px;
    height: 390px;
  }
`;

const AlbumLayer = styled(motion.div)`
  position: absolute;
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);

  @media (min-width: 768px) {
    border-radius: 25px;
  }
`;

const AlbumLayer5 = styled(AlbumLayer)`
  width: 60%;
  height: 60%;
  left: 20%;
  top: 60%;
  z-index: 1;
  background: linear-gradient(135deg, rgba(40, 40, 40, 0.9), rgba(20, 20, 20, 0.95));
`;

const AlbumImage5 = styled.img.attrs({ loading: 'lazy', decoding: 'async' })`
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.4;
  filter: blur(8px) brightness(0.6);
`;

const AlbumLayer4 = styled(AlbumLayer)`
  width: 70%;
  height: 70%;
  left: 15%;
  top: 45%;
  z-index: 2;
  background: linear-gradient(135deg, rgba(50, 50, 50, 0.85), rgba(30, 30, 30, 0.9));
`;

const AlbumImage4 = styled.img.attrs({ loading: 'lazy', decoding: 'async' })`
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.5;
  filter: blur(6px) brightness(0.7);
`;

const AlbumLayer3 = styled(AlbumLayer)`
  width: 80%;
  height: 80%;
  left: 10%;
  top: 30%;
  z-index: 3;
  background: linear-gradient(135deg, rgba(60, 60, 60, 0.8), rgba(40, 40, 40, 0.85));
`;

const AlbumImage3 = styled.img.attrs({ loading: 'lazy', decoding: 'async' })`
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.6;
  filter: blur(4px) brightness(0.8);
`;

const AlbumLayer2 = styled(AlbumLayer)`
  width: 90%;
  height: 90%;
  left: 5%;
  top: 15%;
  z-index: 4;
  background: linear-gradient(135deg, rgba(70, 70, 70, 0.75), rgba(50, 50, 50, 0.8));
`;

const AlbumImage2 = styled.img.attrs({ loading: 'lazy', decoding: 'async' })`
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.75;
  filter: blur(2px) brightness(0.9);
`;

const AlbumLayer1 = styled(AlbumLayer)`
  width: 100%;
  height: 100%;
  left: 0;
  top: 0;
  z-index: 5;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8);
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  touch-action: pan-y;
  will-change: transform;
  transform: translate3d(0, 0, 0);
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;

  &:active {
    cursor: grabbing;
  }
`;

const AlbumCoverImage = styled.img.attrs({ loading: 'eager', decoding: 'async', fetchPriority: 'high' })`
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
`;

const AlbumCoverPlaceholder = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(145deg, rgba(45, 45, 45, 0.95), rgba(18, 18, 18, 0.98));
  color: rgba(255, 255, 255, 0.28);
  font-size: 2.6rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  user-select: none;
  pointer-events: none;
`;

const TrackInfoSection = styled(motion.div)`
  text-align: center;
  margin-top: 22px;
  margin-bottom: 12px;
  width: 100%;
  max-width: 600px;
  position: relative;
  z-index: 10;

  @media (min-width: 768px) {
    margin-top: 32px;
  }

  @media (min-width: 1024px) {
    margin-top: 40px;
  }
`;

const TrackTitle = styled.h2`
  color: white;
  font-size: 16px;
  font-family: 'Unbounded', sans-serif;
  font-weight: 600;
  text-transform: uppercase;
  margin-bottom: 8px;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.8);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 16px;

  @media (min-width: 480px) {
    font-size: 18px;
    white-space: normal;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  @media (min-width: 768px) {
    font-size: 20px;
  }

  @media (min-width: 1024px) {
    font-size: 22px;
  }

  @media (min-width: 1440px) {
    font-size: 24px;
  }
`;

const TrackArtist = styled.p`
  color: rgba(255, 255, 255, 0.9);
  font-size: 12px;
  font-family: 'Unbounded', sans-serif;
  font-weight: 300;
  text-transform: uppercase;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.7);

  @media (min-width: 1024px) {
    font-size: 13px;
  }

  @media (min-width: 1440px) {
    font-size: 14px;
  }
`;

const TrackReason = styled.p`
  color: rgba(255, 255, 255, 0.6);
  font-size: 10px;
  font-family: 'Unbounded', sans-serif;
  font-weight: 300;
  margin-top: 8px;
  max-width: 100%;
  opacity: 0.9;
`;

const HomeSkeletonSection = styled.section`
  position: relative;
  z-index: 3;
  width: 100%;
  padding: 18px 16px 22px;
  background: transparent;

  @media (min-width: 768px) {
    padding: 18px 24px 22px;
  }
`;

const HomeSkeletonHeader = styled.div`
  width: 180px;
  height: 16px;
  border-radius: 999px;
  margin-bottom: 22px;
  background: rgba(255, 255, 255, 0.08);
`;

const HomeSkeletonScroller = styled.div`
  display: flex;
  gap: 12px;
  overflow: hidden;

  @media (min-width: 768px) {
    gap: 16px;
  }
`;

const HomeSkeletonCard = styled.div`
  flex: 0 0 116px;

  @media (min-width: 768px) {
    flex-basis: 156px;
  }
`;

const HomeSkeletonCover = styled.div`
  width: 100%;
  aspect-ratio: 4 / 5;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(255,255,255,0.09), rgba(255,255,255,0.03));
`;

const HomeSkeletonLine = styled.div`
  width: ${(p) => p.$w || '70%'};
  height: 10px;
  border-radius: 999px;
  margin-top: ${(p) => p.$mt || '10px'};
  background: rgba(255, 255, 255, 0.07);
`;

function HomeSectionsSkeleton() {
  return (
    <HomeSkeletonSection aria-hidden="true" data-testid="home-sections-skeleton">
      <HomeSkeletonHeader />
      <HomeSkeletonScroller>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <HomeSkeletonCard key={i}>
            <HomeSkeletonCover />
            <HomeSkeletonLine $w={`${62 + (i % 3) * 10}%`} />
            <HomeSkeletonLine $w={`${42 + (i % 2) * 12}%`} $mt="7px" />
          </HomeSkeletonCard>
        ))}
      </HomeSkeletonScroller>
    </HomeSkeletonSection>
  );
}

const HomeQueueStatusWrap = styled.div`
  width: min(100%, 280px);
  min-height: 280px;
  margin: 0 auto 36px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 28px 20px;
  border-radius: 24px;
  background: linear-gradient(160deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02));
  border: 1px solid rgba(255, 255, 255, 0.08);
`;

const HomeQueueStatusTitle = styled.h2`
  margin: 0 0 10px;
  font-size: 1.05rem;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.95);
`;

const HomeQueueStatusText = styled.p`
  margin: 0;
  font-size: 0.92rem;
  line-height: 1.45;
  color: rgba(255, 255, 255, 0.62);
  max-width: 24rem;
`;

const HomeQueueStatusAction = styled.button`
  margin-top: 18px;
  border: 0;
  border-radius: 999px;
  padding: 11px 18px;
  font-size: 0.88rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #111;
  background: #fff;
  cursor: pointer;
`;

const HomeQueueSpinner = styled.div`
  width: 34px;
  height: 34px;
  margin-bottom: 16px;
  border-radius: 50%;
  border: 3px solid rgba(255, 255, 255, 0.12);
  border-top-color: rgba(255, 255, 255, 0.85);
  animation: homeQueueSpin 0.8s linear infinite;

  @keyframes homeQueueSpin {
    to { transform: rotate(360deg); }
  }
`;

function resolveHomeQueueEmptyCopy({
  authReady,
  isAuthenticated,
  queueSource,
  recommendationsLoading,
  recommendationsError,
}) {
  if (!authReady) {
    return {
      testId: 'home-queue-loading',
      title: 'Проверяем сессию…',
      text: 'Подождите, пока загрузится ваш профиль.',
      showSpinner: true,
    };
  }

  if (!isAuthenticated) {
    return {
      testId: 'home-queue-empty',
      title: 'Войдите, чтобы слушать',
      text: 'Рекомендации и плеер доступны после авторизации.',
      actionLabel: 'Войти',
      actionKind: 'login',
    };
  }

  if (queueSource === 'liked') {
    return {
      testId: 'home-queue-empty-liked',
      title: 'В избранном пока пусто',
      text: 'Отмечайте треки сердечком — они появятся в этом разделе.',
      actionLabel: 'Обновить',
      actionKind: 'retry',
    };
  }

  if (queueSource === 'library') {
    return {
      testId: 'home-queue-empty-library',
      title: 'В библиотеке пока пусто',
      text: 'Добавьте треки в библиотеку или переключитесь на рекомендации.',
      actionLabel: 'К рекомендациям',
      actionKind: 'retry',
    };
  }

  if (recommendationsLoading) {
    return {
      testId: 'home-queue-loading',
      title: 'Загружаем рекомендации',
      text: 'Подбираем треки для очереди воспроизведения.',
      showSpinner: true,
    };
  }

  const errorText = typeof recommendationsError === 'string' ? recommendationsError.trim() : '';
  const looksLikeBackendDown = /failed to fetch|network|fetch|connection|502|503|504|ECONNREFUSED/i.test(errorText);

  if (errorText) {
    return {
      testId: 'home-queue-error',
      title: 'Не удалось загрузить треки',
      text: looksLikeBackendDown
        ? 'Фронтенд запущен, но API недоступен. Поднимите backend: docker compose up -d'
        : (errorText === 'auth_degraded'
          ? 'Сессия устарела. Обновите страницу или войдите снова.'
          : errorText),
      actionLabel: 'Повторить',
      actionKind: 'retry',
    };
  }

  return {
    testId: 'home-queue-empty',
    title: 'Пока нет треков',
    text: 'Очередь пуста. Проверьте backend и попробуйте обновить рекомендации.',
    actionLabel: 'Обновить',
    actionKind: 'retry',
  };
}

function HomeQueueStatus({
  authReady,
  isAuthenticated,
  queueSource,
  recommendationsLoading,
  recommendationsError,
  onLogin,
  onRetry,
}) {
  const copy = resolveHomeQueueEmptyCopy({
    authReady,
    isAuthenticated,
    queueSource,
    recommendationsLoading,
    recommendationsError,
  });

  const handleAction = () => {
    if (copy.actionKind === 'login') {
      onLogin();
      return;
    }
    if (copy.actionKind === 'retry') {
      onRetry();
    }
  };

  return (
    <HomeQueueStatusWrap data-testid={copy.testId}>
      {copy.showSpinner ? <HomeQueueSpinner aria-hidden="true" /> : null}
      <HomeQueueStatusTitle>{copy.title}</HomeQueueStatusTitle>
      <HomeQueueStatusText>{copy.text}</HomeQueueStatusText>
      {copy.actionLabel ? (
        <HomeQueueStatusAction type="button" onClick={handleAction}>
          {copy.actionLabel}
        </HomeQueueStatusAction>
      ) : null}
    </HomeQueueStatusWrap>
  );
}

function getPlaylistTracksList(playlist) {
  const p = playlist && typeof playlist === 'object' ? playlist : null;
  if (!p) return [];
  if (Array.isArray(p.tracks)) return p.tracks;
  if (Array.isArray(p.items)) return p.items;
  if (Array.isArray(p.songs)) return p.songs;
  return [];
}

const MusicPlayer = ({
  tracks = [],
  currentTrackIndex = 0,
  onNext = () => { },
  onPrevious = () => { },
  queueSource = 'auto',
  onSwitchToRecommendations = () => { },
  onSwitchToLiked = () => { },
  onRefreshLiked = () => { },
  onPlayPlaylist = () => { }
}) => {
  const navigate = useNavigate();
  const { isAuthenticated, user, authReady } = useAuth();
  const { recommendationsLoading, recommendations } = usePlayerState();
  const isDesktopHome = useMediaQuery('(min-width: 768px)');
  const homeSectionsReady = useDeferredHomeSections();
  const { playlists: userPlaylists } = useUserPlaylists(Boolean(isAuthenticated && homeSectionsReady));

  const {
    currentTrack,
    track2,
    track3,
    track4,
    track5,
    coverUrls,
  } = useCoverStack(tracks, currentTrackIndex);

  const hasQueueTracks = Array.isArray(tracks) && tracks.length > 0 && !!currentTrack;
  const recommendationsError = recommendations?.error || null;

  const handleHomeQueueLogin = useCallback(() => {
    redirectToAuth({
      reason: 'login',
      returnTo: buildReturnToFromCurrentLocation(),
      replace: true,
    });
  }, []);

  const handleHomeQueueRetry = useCallback(() => {
    if (queueSource === 'liked') {
      onRefreshLiked();
      return;
    }
    onSwitchToRecommendations();
  }, [queueSource, onRefreshLiked, onSwitchToRecommendations]);

  const handleTabRecommendations = useCallback(() => {
    onSwitchToRecommendations();
  }, [onSwitchToRecommendations]);

  const handleTabLiked = useCallback(() => {
    onSwitchToLiked();
  }, [onSwitchToLiked]);

  const handleTabNewReleases = useCallback(() => {
    navigate('/search');
  }, [navigate]);

  const handleTabMood = useCallback(() => {
    if (isAuthenticated) {
      navigate('/mood-radar');
      return;
    }
    navigate('/search');
  }, [isAuthenticated, navigate]);

  const canSwipeCover = hasQueueTracks && tracks.length > 1;
  const coverLayerRef = React.useRef(null);
  const coverDraggedRef = React.useRef(false);
  const { openFullPlayer } = usePlayerSheet();

  const resetCoverDrag = React.useCallback(() => {
    const el = coverLayerRef.current;
    if (el) el.style.transform = 'translate3d(0, 0, 0)';
  }, []);

  const handleCoverActiveMove = React.useCallback(({ dx, intent }) => {
    if (intent !== GESTURE_AXIS.HORIZONTAL) return;
    if (Math.abs(dx) > 10) coverDraggedRef.current = true;
    const clamped = Math.max(-120, Math.min(120, dx * 0.42));
    const el = coverLayerRef.current;
    if (el) el.style.transform = `translate3d(${clamped}px, 0, 0)`;
  }, []);

  const handleCoverSwipeCommit = React.useCallback(({ state, dx, dy, intent }) => {
    coverDraggedRef.current = true;
    resetCoverDrag();
    if (!state || !canSwipeCover || intent !== 'horizontal') return;
    const direction = horizontalSwipeProfile.commit({
      dx,
      dy,
      velocityX: state.velocityX,
    });
    if (direction < 0) {
      onNext();
    } else if (direction > 0) {
      onPrevious();
    }
  }, [canSwipeCover, onNext, onPrevious, resetCoverDrag]);

  const { handlers: coverGestureHandlers } = usePointerGestureMachine({
    surfaceId: GESTURE_SURFACE.COVER_STACK,
    profileId: GESTURE_PROFILE.HORIZONTAL_SWIPE,
    capturePolicy: GESTURE_CAPTURE_POLICY.AFTER_INTENT_LOCK,
    disabled: !canSwipeCover,
    onActiveMove: handleCoverActiveMove,
    onCancel: resetCoverDrag,
    onCommit: handleCoverSwipeCommit,
  });

  const handleHeroCoverOpen = React.useCallback(() => {
    if (coverDraggedRef.current) return;
    openFullPlayer();
  }, [openFullPlayer]);

  const heroCoverGestureHandlers = React.useMemo(() => ({
    onPointerDown: (e) => {
      coverDraggedRef.current = false;
      coverGestureHandlers.onPointerDown?.(e);
    },
    onPointerMove: coverGestureHandlers.onPointerMove,
    onPointerUp: (e) => {
      coverGestureHandlers.onPointerUp?.(e);
      queueMicrotask(() => handleHeroCoverOpen());
    },
    onPointerCancel: (e) => {
      coverGestureHandlers.onPointerCancel?.(e);
      coverDraggedRef.current = false;
    },
  }), [coverGestureHandlers, handleHeroCoverOpen]);

  const computeDiscoverSeed = React.useCallback(() => {
    const now = new Date();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const bucket = Math.floor(now.getUTCHours() / 6);
    return `${yyyy}-${mm}-${dd}:${bucket}`;
  }, []);

  const [discoverSeed, setDiscoverSeed] = React.useState(() => computeDiscoverSeed());

  React.useEffect(() => {
    const now = new Date();
    const currentBucket = Math.floor(now.getUTCHours() / 6);
    const nextBucketHour = (currentBucket + 1) * 6;

    const next = new Date(now);
    next.setUTCMinutes(0, 0, 0);
    if (nextBucketHour >= 24) {
      next.setUTCDate(next.getUTCDate() + 1);
      next.setUTCHours(0);
    } else {
      next.setUTCHours(nextBucketHour);
    }

    const ms = Math.max(1_000, next.getTime() - Date.now());
    const timer = setTimeout(() => {
      setDiscoverSeed(computeDiscoverSeed());
    }, ms);

    return () => clearTimeout(timer);
  }, [computeDiscoverSeed, discoverSeed]);

  const discoverAuthScope = React.useMemo(() => {
    if (!authReady) return 'booting';
    if (isAuthenticated && user?.id !== undefined && user?.id !== null) {
      return `user:${user.id}`;
    }
    return 'anon';
  }, [authReady, isAuthenticated, user?.id]);

  const { rails: discoverRails } = useDiscoverRails({
    autoLoad: homeSectionsReady && authReady,
    seed: discoverSeed,
    authScope: discoverAuthScope,
  });

  let reasonTrackId = null;
  if (currentTrack?.id !== undefined && currentTrack?.id !== null) {
    reasonTrackId = String(currentTrack.id);
  }
  const shouldShowReason = useTrackReason(reasonTrackId, Boolean(currentTrack?.reason));

  const handlePlaylistClick = useCallback((playlist) => {
    const p = playlist && typeof playlist === 'object' ? playlist : null;
    if (!p) return;

    const tracksList = getPlaylistTracksList(p);
    const playlistName = (p.title ?? p.name ?? '').toString().trim();
    if (tracksList.length) {
      onPlayPlaylist(tracksList, playlistName || 'Playlist');
      return;
    }

    const identifier = extractPlaylistIdentifier(p);
    if (!identifier) return;
    const path = buildPlaylistPathFromIdentifier(identifier);
    if (path) navigate(path);
  }, [navigate, onPlayPlaylist]);

  const normalizedUserPlaylists = React.useMemo(() => {
    const src = Array.isArray(userPlaylists) ? userPlaylists : [];
    return src.map((p) => {
      const title = (p?.name ?? p?.title ?? 'Плейлист').toString();
      const trackCountRaw = p?.track_count ?? p?.trackCount ?? p?.tracks_count ?? p?.tracksCount;
      const trackCount = Number.isFinite(Number(trackCountRaw)) ? Number(trackCountRaw) : 0;
      const coverPath = p?.cover_path ?? p?.coverPath ?? null;
      let coverUrl = null;
      if (coverPath) {
        coverUrl = apiClient.getCoverUrl({ cover_path: coverPath });
      }
      return {
        ...p,
        title,
        trackCount,
        coverUrl,
        isFeatured: false,
      };
    });
  }, [userPlaylists]);

  const getRailMaxItems = useCallback((rail) => {
    const list = rail && Array.isArray(rail.playlists) ? rail.playlists : [];
    return Math.min(10, Math.max(1, list.length));
  }, []);

  const desktopSections = homeSectionsReady ? (
    <>
      {Array.isArray(discoverRails) && discoverRails.length > 0
        ? discoverRails.map((rail) => (
          <PlaylistSection
            key={rail.id}
            title={formatDiscoverRailTitle(rail.title)}
            homeDesktopAlign={isDesktopHome}
            onPlaylistClick={handlePlaylistClick}
            maxItems={getRailMaxItems(rail)}
            playlists={rail.playlists}
          />
        ))
        : (
          <PlaylistSection
            title="Микстейпы для вас"
            homeDesktopAlign={isDesktopHome}
            onPlaylistClick={handlePlaylistClick}
            maxItems={10}
            playlists={[]}
          />
        )}
      <PopularArtistsSection limit={12} autoLoad={homeSectionsReady} homeDesktopAlign={isDesktopHome} />
      {isAuthenticated && normalizedUserPlaylists.length > 0 ? (
        <PlaylistSection
          title="Мои плейлисты"
          compactTop
          homeDesktopAlign={isDesktopHome}
          onPlaylistClick={handlePlaylistClick}
          maxItems={10}
          playlists={normalizedUserPlaylists}
        />
      ) : null}
    </>
  ) : (
    <HomeSectionsSkeleton />
  );

  return (
    <PlayerContainer data-testid="home-player-root">

      {isDesktopHome ? (
        <DesktopHomeRoot data-testid="home-desktop-layout-v3">
          <CategoryTabs aria-label="Разделы главной">
            <CategoryTab
              type="button"
              $active={queueSource === 'auto'}
              onClick={handleTabRecommendations}
            >
              Для тебя
            </CategoryTab>
            <CategoryTab
              type="button"
              $active={queueSource === 'liked'}
              onClick={handleTabLiked}
            >
              Нравится
            </CategoryTab>
            <CategoryTab type="button" $active={false} onClick={handleTabNewReleases}>
              Новинки
            </CategoryTab>
            <CategoryTab type="button" $active={false} onClick={handleTabMood}>
              Жанры и настроения
            </CategoryTab>
          </CategoryTabs>

          {hasQueueTracks ? (
            <>
              <HomeDesktopHeroV3
                currentTrack={currentTrack}
                coverUrl={coverUrls.main}
                coverLayerRef={coverLayerRef}
                coverGestureHandlers={heroCoverGestureHandlers}
                canSwipeCover={canSwipeCover}
                shouldShowReason={shouldShowReason}
                onCoverOpen={handleHeroCoverOpen}
              />
              <HomeForYouRow tracks={tracks} currentTrackIndex={currentTrackIndex} />
              <HomeMoodChips />
            </>
          ) : (
            <HomeQueueStatus
              authReady={authReady}
              isAuthenticated={isAuthenticated}
              queueSource={queueSource}
              recommendationsLoading={recommendationsLoading}
              recommendationsError={recommendationsError}
              onLogin={handleHomeQueueLogin}
              onRetry={handleHomeQueueRetry}
            />
          )}

          {desktopSections}
        </DesktopHomeRoot>
      ) : (
        <MobileHomeRoot data-testid="home-mobile-layout-v3">
          <CategoryTabs aria-label="Разделы главной">
            <CategoryTab
              type="button"
              $active={queueSource === 'auto'}
              onClick={handleTabRecommendations}
            >
              Для тебя
            </CategoryTab>
            <CategoryTab
              type="button"
              $active={queueSource === 'liked'}
              onClick={handleTabLiked}
            >
              Нравится
            </CategoryTab>
            <CategoryTab type="button" $active={false} onClick={handleTabNewReleases}>
              Новинки
            </CategoryTab>
          </CategoryTabs>

          {hasQueueTracks ? (
            <>
              <HomeMobileHeroV3
                currentTrack={currentTrack}
                coverUrl={coverUrls.main}
                coverLayerRef={coverLayerRef}
                coverGestureHandlers={heroCoverGestureHandlers}
                canSwipeCover={canSwipeCover}
                shouldShowReason={shouldShowReason}
                onCoverOpen={handleHeroCoverOpen}
              />
              <HomeForYouList tracks={tracks} currentTrackIndex={currentTrackIndex} />
              <HomeMoodChips />
            </>
          ) : (
            <HomeQueueStatus
              authReady={authReady}
              isAuthenticated={isAuthenticated}
              queueSource={queueSource}
              recommendationsLoading={recommendationsLoading}
              recommendationsError={recommendationsError}
              onLogin={handleHomeQueueLogin}
              onRetry={handleHomeQueueRetry}
            />
          )}

          {!homeSectionsReady ? (
            <HomeSectionsSkeleton />
          ) : (
            <>
              {Array.isArray(discoverRails) && discoverRails.length > 0
                ? discoverRails.map((rail) => (
                  <PlaylistSection
                    key={rail.id}
                    title={formatDiscoverRailTitle(rail.title)}
                    onPlaylistClick={handlePlaylistClick}
                    maxItems={getRailMaxItems(rail)}
                    playlists={rail.playlists}
                  />
                ))
                : (
                  <PlaylistSection
                    title="Микстейпы для вас"
                    onPlaylistClick={handlePlaylistClick}
                    maxItems={10}
                    playlists={[]}
                  />
                )}
              <PopularArtistsSection limit={12} autoLoad={homeSectionsReady} />
              {isAuthenticated && normalizedUserPlaylists.length > 0 ? (
                <PlaylistSection
                  title="Мои плейлисты"
                  compactTop
                  onPlaylistClick={handlePlaylistClick}
                  maxItems={10}
                  playlists={normalizedUserPlaylists}
                />
              ) : null}
            </>
          )}
        </MobileHomeRoot>
      )}
    </PlayerContainer>
  );
};

// Мемоизируем компонент для предотвращения лишних ре-рендеров
export default React.memo(MusicPlayer);
