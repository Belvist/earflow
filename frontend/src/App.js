import React, { useMemo } from 'react';
import styled, { createGlobalStyle } from 'styled-components';
import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import Header from './components/Header';
import ErrorBoundary from './components/ErrorBoundary';
// PartyDrawer встроен в GlobalPlayerBar и MobilePlayerBar; deep link ?partyInvite= — PartyInviteDeepLinkHandler
import PartyInviteDeepLinkHandler from './components/Party/PartyInviteDeepLinkHandler';
import Footer from './components/Footer';
import MobileBottomNav from './components/MobileBottomNav';
import CookieConsentBanner from './components/CookieConsentBanner';
import PwaInstallPrompt from './components/PwaInstallPrompt';
import useAuth from './hooks/useAuth';
import { PlayerProvider, usePlayerState, usePlayerProgress, usePlayerDispatch } from './context/PlayerContext';
import { SkinContext, useSkinState } from './skins/useSkin';
import { OfflineProvider } from './offline/OfflineContext';
import OfflineBanner from './offline/OfflineBanner';
import apiClient from './api/client';
import { isAuthDomain, redirectToAuth, sanitizeReturnTo, shouldSuppressAuthRedirectAfterLogout } from './utils/authRedirect';
import { setPageMeta } from './utils/seo';
// Eager import: один провайдер device-sync вне ленивого Suspense плеера.
import DeviceSyncProvider from './components/DeviceSync/DeviceSyncProvider';
import { GestureArbiterProvider } from './gestures/GestureArbiterProvider';
import { PlayerSheetProvider } from './context/PlayerSheetContext';
import { MiniBarVariantProvider } from './context/MiniBarVariantContext';
import ListenerUiPrefsSync from './preferences/ListenerUiPrefsSync';
import PlayerChrome from './components/PlayerChrome';
import { lazyWithRetry } from './utils/lazyWithRetry';
import { HOME_SURFACE_HEX } from './styles/homeSurface';
import { FLOATING_SHELL_RADIUS_PX } from './components/MobilePlayerBar/miniPlayButtonVisual';
import {
  MOBILE_CHROME_SIDE_INSET_PX,
  MOBILE_MINI_PLAYER_FLOAT_GAP_PX,
  MOBILE_MINI_PLAYER_FLOAT_HEIGHT_PX,
  MOBILE_NAV_TOTAL_HEIGHT_PX,
} from './components/mobileChromeTokens';

const SkinProviderWrapper = ({ children }) => {
  const skinValue = useSkinState();
  return React.createElement(SkinContext.Provider, { value: skinValue }, children);
};

const GlobalPlayerBar = lazyWithRetry(() => import('./components/GlobalPlayerBar'), 'GlobalPlayerBar');
const EqModal = lazyWithRetry(() => import('./components/EqModal'), 'EqModal');

const EmailAuth = lazyWithRetry(() => import('./components/EmailAuth'), 'EmailAuth');
const MusicPlayer = lazyWithRetry(() => import('./components/MusicPlayer'), 'MusicPlayer');
const ProfilePage = lazyWithRetry(() => import('./components/ProfilePage'), 'ProfilePage');
const SubscriptionPage = lazyWithRetry(() => import('./components/SubscriptionPage'), 'SubscriptionPage');
const MoodRadarPage = lazyWithRetry(() => import('./components/MoodRadarPage'), 'MoodRadarPage');
const PublicSharePage = lazyWithRetry(() => import('./components/PublicSharePage'), 'PublicSharePage');
const PlaylistRoute = lazyWithRetry(() => import('./components/PlaylistRoute'), 'PlaylistRoute');
const PlaylistShareRoute = lazyWithRetry(() => import('./components/PlaylistShareRoute'), 'PlaylistShareRoute');
const ArtistPage = lazyWithRetry(() => import('./components/ArtistPage'), 'ArtistPage');
const ArtistTracksPage = lazyWithRetry(() => import('./components/ArtistTracksPage'), 'ArtistTracksPage');
const AlbumPage = lazyWithRetry(() => import('./components/AlbumPage'), 'AlbumPage');
const AboutPage = lazyWithRetry(() => import('./components/AboutPage'), 'AboutPage');
const PopularArtistsPage = lazyWithRetry(() => import('./components/PopularArtistsPage'), 'PopularArtistsPage');
const SearchPage = lazyWithRetry(() => import('./components/SearchPage'), 'SearchPage');
const SocialPage = lazyWithRetry(() => import('./components/SocialPage'), 'SocialPage');
const LegalPage = lazyWithRetry(() => import('./components/LegalPage'), 'LegalPage');
/**
 * Playground - изолированная страница для e2e тестов жестов мобильного плеера.
 * Lazy chunk - не попадает в main bundle. Доступна только по прямому URL
 * /playground/mobile-player; нигде не линкуется из UI.
 */
const MobilePlayerPlayground = lazyWithRetry(() => import('./playground/MobilePlayerPlayground'), 'MobilePlayerPlayground');

const GlobalStyle = createGlobalStyle`
  :root {
    --ef-surface-main: ${HOME_SURFACE_HEX};
    /* Высота плеер-бара для отступов */
    --player-bar-height: 72px;
    --player-bar-height-safe: calc(72px + env(safe-area-inset-bottom, 0px));
    --desktop-player-bar-height: 67px;
    --header-height: 56px;
    --right-rail-width: 0px;
    --panel-rail-width: 380px;
    --panel-rail-gap: 20px;
    --mobile-chrome-side-inset: ${MOBILE_CHROME_SIDE_INSET_PX}px;
    --mobile-bottom-nav-height: ${MOBILE_NAV_TOTAL_HEIGHT_PX}px;
    --mobile-mini-player-height: ${MOBILE_MINI_PLAYER_FLOAT_HEIGHT_PX}px;
    --mobile-mini-player-float-gap: ${MOBILE_MINI_PLAYER_FLOAT_GAP_PX}px;
    --mobile-chrome-height: calc(var(--mobile-bottom-nav-height) + var(--mobile-mini-player-float-gap) + var(--mobile-mini-player-height));
    --z-bottom-nav: 9997;
    --z-mini-player: 9998;
    --z-sheet-overlay: 10050;
    --z-sheet: 10051;
    --ef-font-body: 14px;
    --ef-font-ui: 13px;
    --ef-font-caption: 11px;
    --ef-font-title: 26px;
    --ef-font-title-max: 34px;
    --ef-font-section: 17px;
  }

  :root[data-mini-bar-variant="classic"] {
    --mobile-mini-player-height: 64px;
    --mobile-mini-player-float-gap: 0px;
    --mobile-chrome-height: calc(var(--mobile-bottom-nav-height) + var(--mobile-mini-player-float-gap) + var(--mobile-mini-player-height));
  }

  :root:not([data-mini-bar-variant="classic"]) [data-testid="mini-player-bar"],
  :root[data-mini-bar-variant="floating"] [data-testid="mini-player-bar"],
  [data-testid="mini-player-bar"][data-mini-bar-variant="floating"] {
    left: max(var(--mobile-chrome-side-inset, ${MOBILE_CHROME_SIDE_INSET_PX}px), env(safe-area-inset-left, 0px)) !important;
    right: max(var(--mobile-chrome-side-inset, ${MOBILE_CHROME_SIDE_INSET_PX}px), env(safe-area-inset-right, 0px)) !important;
    width: auto !important;
    max-width: calc(100vw - (var(--mobile-chrome-side-inset, ${MOBILE_CHROME_SIDE_INSET_PX}px) * 2)) !important;
    border-radius: ${FLOATING_SHELL_RADIUS_PX}px !important;
  }

  :root[data-mini-bar-variant="classic"] [data-testid="mini-player-bar"],
  [data-testid="mini-player-bar"][data-mini-bar-variant="classic"] {
    left: 0 !important;
    right: 0 !important;
    width: 100% !important;
    max-width: 100vw !important;
    border-radius: 0 !important;
  }

  [data-testid="mini-player-bar"] .ef-mini-progress-fill {
    position: absolute !important;
    left: 0 !important;
    top: 0 !important;
    bottom: 0 !important;
    display: block !important;
    height: auto !important;
    max-width: 100% !important;
    background: #ffffff !important;
    box-shadow:
      0 0 12px rgba(255, 255, 255, 0.65),
      0 0 2px rgba(255, 255, 255, 0.9) !important;
    transition: none !important;
    width: var(--progress, 0%) !important;
  }

  [data-testid="mini-player-bar"] [data-testid="mini-player-progress"] {
    display: block !important;
    opacity: 1 !important;
    visibility: visible !important;
    z-index: 10 !important;
  }

  :root:not([data-mini-bar-variant="classic"]) [data-testid="mini-player-bar"] [data-testid="mini-player-progress"],
  [data-testid="mini-player-bar"][data-mini-bar-variant="floating"] [data-testid="mini-player-progress"] {
    position: absolute !important;
    bottom: 0 !important;
    height: 2px !important;
    min-height: 2px !important;
    max-height: 2px !important;
    left: 0 !important;
    right: 0 !important;
    width: 100% !important;
    max-width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    pointer-events: none !important;
    border-radius: 0 0 var(--mini-shell-radius, ${FLOATING_SHELL_RADIUS_PX}px) var(--mini-shell-radius, ${FLOATING_SHELL_RADIUS_PX}px) !important;
    overflow: hidden !important;
    background: rgba(255, 255, 255, 0.22) !important;
    box-shadow: none !important;
  }

  :root[data-mini-bar-variant="classic"] [data-testid="mini-player-bar"] [data-testid="mini-player-progress"],
  [data-testid="mini-player-bar"][data-mini-bar-variant="classic"] [data-testid="mini-player-progress"] {
    position: absolute !important;
    height: 2px !important;
    min-height: 2px !important;
    max-height: 2px !important;
    left: 0 !important;
    right: 0 !important;
    width: auto !important;
    bottom: 0 !important;
    pointer-events: none !important;
    border-radius: 0 !important;
    background: rgba(0, 0, 0, 0.35) !important;
  }

  [data-testid="mini-player-bar"] .ef-mini-play-ios-svg,
  [data-testid="mini-player-bar"] .ef-mini-play-adaptive-svg {
    display: block !important;
    width: 100% !important;
    height: 100% !important;
  }

  [data-testid="mini-player-play"] {
    background: transparent !important;
    box-shadow: none !important;
  }

  [data-testid="mini-player-play"][data-play-style="adaptive"],
  [data-testid="mini-player-play"][data-play-style="metallic"] {
    border: none !important;
  }

  :root[data-mini-play-style="adaptive"] [data-testid="mini-player-play"],
  [data-testid="mini-player-bar"][data-mini-play-style="adaptive"] [data-testid="mini-player-play"],
  [data-testid="mini-player-play"][data-play-style="adaptive"],
  .ef-mini-play--adaptive {
    background: transparent !important;
    border: none !important;
    border-radius: 0 !important;
    box-shadow: none !important;
  }

  :root[data-mini-play-style="metallic"] [data-testid="mini-player-play"],
  [data-testid="mini-player-bar"][data-mini-play-style="metallic"] [data-testid="mini-player-play"],
  [data-testid="mini-player-play"][data-play-style="metallic"],
  .ef-mini-play--metallic {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
  }

  @media (min-width: 1024px) {
    :root {
      --desktop-player-bar-height: 71px;
    }
  }

  @media (min-width: 1440px) {
    :root {
      --desktop-player-bar-height: 73px;
    }
  }

  /* Mobile: bottom nav + mini-player stacked above it */
  @media (max-width: 767px) {
    :root {
      --player-bar-height: var(--mobile-chrome-height);
      --player-bar-height-safe: calc(var(--mobile-chrome-height) + env(safe-area-inset-bottom, 0px));
    }
  }

  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  html {
    font-size: 16px;
  }

  body {
    font-family: 'Unbounded', sans-serif;
    font-size: var(--ef-font-body);
    line-height: 1.35;
    letter-spacing: 0;
    background: ${({ $mainSurface }) => ($mainSurface ? 'var(--ef-surface-main, #0D0D0D)' : '#000')};
    color: #fff;
    overflow-x: hidden;
  }

  @media (max-width: 768px) {
    html {
      font-size: 14px;
    }
    body {
      font-size: 13px;
    }
  }

  button,
  input,
  select,
  textarea {
    font-family: inherit;
  }

  ${({ $mainSurface }) => $mainSurface ? `
  p,
  li,
  label,
  small {
    letter-spacing: 0 !important;
  }

  .nav-button,
  .text-button,
  .tab-button {
    font-size: var(--ef-font-ui) !important;
    line-height: 1.1 !important;
    letter-spacing: 0 !important;
  }

  input,
  textarea,
  select {
    font-size: 13px !important;
    line-height: 1.25 !important;
    letter-spacing: 0 !important;
  }

  .responsive-title {
    font-size: clamp(22px, 3vw, 34px) !important;
  }

  .responsive-subtitle {
    font-size: clamp(13px, 1.6vw, 18px) !important;
  }

  @media (max-width: 767px) {
    .nav-button,
    .text-button,
    .tab-button {
      font-size: 11px !important;
    }

    input,
    textarea,
    select {
      font-size: 15px !important;
    }
  }
  ` : ''}
`;

function AuthStandalonePage() {
  const location = useLocation();
  const { authReady, status: authStatus } = useAuth();
  const hasConfirmedAuth = authStatus === 'authenticated';

  React.useEffect(() => {
    if (!isAuthDomain()) return;
    if (location.pathname === '/login') return;
    const dest = `/login${location.search || ''}`;
    const w = typeof window !== 'undefined' ? window : undefined;
    w?.location?.replace?.(dest);
  }, [location.pathname, location.search]);

  const params = new URLSearchParams(location.search || '');
  const returnTo = sanitizeReturnTo(params.get('return_to') || '');

  React.useEffect(() => {
    if (!isAuthDomain()) return;
    if (!authReady) return;
    if (!hasConfirmedAuth) return;
    const w = typeof window !== 'undefined' ? window : undefined;
    w?.location?.replace?.(returnTo);
  }, [authReady, hasConfirmedAuth, returnTo]);

  React.useEffect(() => {
    if (!isAuthDomain()) return undefined;
    const onPageShow = () => {
      if (!authReady || !hasConfirmedAuth) return;
      const w = typeof window !== 'undefined' ? window : undefined;
      w?.location?.replace?.(returnTo);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [authReady, hasConfirmedAuth, returnTo]);

  if (isAuthDomain() && authReady && hasConfirmedAuth) {
    return (
      <AppContainer>
        <LoadingContainer>Загрузка...</LoadingContainer>
      </AppContainer>
    );
  }

  return (
    <AppContainer>
      <EmailAuth
        onClose={() => undefined}
        onSuccess={() => {
          const w = typeof window !== 'undefined' ? window : undefined;
          w?.location?.replace?.(returnTo);
        }}
        canClose={false}
        initialMode="login"
      />
    </AppContainer>
  );
}

const ModalHost = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
`;

const AppContainer = styled.div`
  width: 100%;
  min-height: 100vh;
  min-height: calc(var(--app-vh, 1vh) * 100);
  background: ${(p) => (p.$listenerSurface ? 'var(--ef-surface-main, #0D0D0D)' : 'black')};
  overflow-x: hidden;
  padding-bottom: env(safe-area-inset-bottom, 0px);
`;

const AppShell = styled.div`
  min-height: 100vh;
  min-height: calc(var(--app-vh, 1vh) * 100);
  display: flex;
  flex-direction: column;
  background: ${(p) => (p.$listenerSurface ? 'var(--ef-surface-main, #0D0D0D)' : 'black')};
  padding-bottom: calc(var(--player-bar-height-safe, 0px) + env(safe-area-inset-bottom, 0px));
  width: 100%;
  max-width: 100vw;
  transition: width 220ms ease, max-width 220ms ease;

  @media (min-width: 768px) {
    padding-bottom: calc(var(--desktop-player-bar-height, 0px) + env(safe-area-inset-bottom, 0px));
    width: calc(100% - var(--right-rail-width, 0px));
    max-width: calc(100vw - var(--right-rail-width, 0px));
  }
`;

const RoutedContent = styled.div`
  width: 100%;
  min-height: ${p => (p.$compact ? '0' : '100vh')};
  min-height: ${p => (p.$compact ? '0' : 'calc(var(--app-vh, 1vh) * 100)')};
  background: ${p => (p.$useMainSurface ? 'var(--ef-surface-main, #0D0D0D)' : 'black')};
  overflow-x: hidden;
  flex: ${p => (p.$compact ? '0 0 auto' : '1')};
  padding-top: ${p => (p.$withHeader ? 'calc(var(--header-height) + env(safe-area-inset-top, 0px))' : '0px')};
  padding-bottom: env(safe-area-inset-bottom, 0px);
  position: relative;
  z-index: 5;
`;

const LoadingContainer = styled.div`
  min-height: 100vh;
  min-height: calc(var(--app-vh, 1vh) * 100);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: black;
  color: white;
  gap: 20px;
  padding: 20px;
`;

const LoginMessage = styled.p`
  color: rgba(255, 255, 255, 0.7);
  margin-bottom: 30px;
  text-align: center;
  max-width: 400px;
  line-height: 1.6;
  font-family: 'Unbounded', sans-serif;
  font-size: 16px;
  font-weight: 400;
`;

const VisuallyHiddenH1 = styled.h1`
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
`;

function computePageMeta(pathname, isAuthHost) {
  if (isAuthHost) return { title: 'Вход — Earflow', description: 'Вход в аккаунт Earflow' };
  if (pathname === '/') return { title: 'Earflow — музыкальная платформа', description: 'Музыкальная платформа с персональными рекомендациями' };
  if (pathname.startsWith('/profile') || pathname.startsWith('/account/')) return { title: 'Профиль — Earflow', description: 'Профиль пользователя Earflow' };

  const parts = (pathname || '').split('/').filter(Boolean);
  const route = parts[0] || '';

  const handlers = {
    playlist: (p) => {
      const idOrToken = p[1] ? decodeURIComponent(p[1]) : '';
      return { title: idOrToken ? `Плейлист ${idOrToken} — Earflow` : 'Плейлист — Earflow', description: 'Плейлист в Earflow' };
    },
    artist: (p) => {
      const artist = p[1] ? decodeURIComponent(p[1]) : '';
      return { title: artist ? `${artist} — Earflow` : 'Артист — Earflow', description: artist ? `Треки и релизы: ${artist}` : 'Страница артиста в Earflow' };
    },
    album: (p) => {
      const artist = p[1] ? decodeURIComponent(p[1]) : '';
      const albumName = p[2] ? decodeURIComponent(p[2]) : '';
      const left = [artist, albumName].filter(Boolean).join(' — ');
      return { title: left ? `${left} — Earflow` : 'Альбом — Earflow', description: albumName ? `Альбом: ${albumName}` : 'Страница альбома в Earflow' };
    },
  };

  const handler = handlers[route];
  if (handler) return handler(parts);
  return { title: 'Earflow', description: 'Музыкальная платформа' };
}

function MainApp() {
  const location = useLocation();
  const playerState = usePlayerState();
  const playerProgress = usePlayerProgress();
  const playerDispatch = usePlayerDispatch();

  const showMainPlayer = location.pathname === '/';

  return (
    <AppContainer $listenerSurface>
      {showMainPlayer ? <VisuallyHiddenH1>Earflow</VisuallyHiddenH1> : null}
      {showMainPlayer ? (
        <React.Suspense fallback={<LoadingContainer>Загрузка...</LoadingContainer>}>
          <MusicPlayer
            tracks={playerState.tracks}
            currentTrackIndex={playerState.currentTrackIndex}
            isPlaying={playerState.isPlaying}
            progress={playerProgress.progress}
            currentTime={playerProgress.currentTime}
            duration={playerProgress.duration}
            onTrackSelect={playerDispatch.handleTrackSelect}
            onPlayPause={playerDispatch.togglePlayPause}
            onNext={playerDispatch.playNextTrack}
            onPrevious={playerDispatch.playPreviousTrack}
            onProgressClick={playerDispatch.handleProgressClick}
            volume={playerState.volume}
            onVolumeChange={playerDispatch.setVolume}
            eqEnabled={playerState.eqEnabled}
            setEqEnabled={playerDispatch.setEqEnabled}
            eqGains={playerState.eqGains}
            onEqGainChange={playerDispatch.onEqGainChange}
            isCurrentLiked={playerState.currentTrack ? playerState.likedIds.has(playerState.currentTrack.id) : false}
            onToggleLike={playerDispatch.toggleLikeCurrent}
            queueSource={playerState.queueSource}
            onSwitchToRecommendations={playerDispatch.switchToRecommendationsQueue}
            onSwitchToLiked={playerDispatch.switchToLikedQueue}
            onRefreshLiked={playerDispatch.refreshLikedQueue}
            onPlayPlaylist={playerDispatch.playPlaylist}
          />
        </React.Suspense>
      ) : null}
    </AppContainer>
  );
}

function ProfileWithOffline() {
  return (
    <RequireAuth>
      <OfflineProvider apiClient={apiClient}>
        <ProfilePage />
      </OfflineProvider>
    </RequireAuth>
  );
}

function PlayerRuntimeProvider({ children, isAuthenticated, stableUser, rehydrateSession }) {
  const location = useLocation();
  const path = location.pathname || '/';
  const listenerRoute = !isAuthDomain();
  if (!listenerRoute) {
    return children;
  }

  const playerHome = listenerRoute && path === '/';
  const searchRoute = listenerRoute && path === '/search';
  const libraryRoute = playerHome || searchRoute;
  const recommendationsRoute = playerHome || searchRoute;
  const feedbackRoute = listenerRoute && (
    path === '/'
    || path === '/search'
    || path.startsWith('/playlist/')
    || path.startsWith('/p/')
    || path.startsWith('/mix/')
    || path.startsWith('/album/')
    || path.startsWith('/artist/')
  );

  return (
    <PlayerProvider
      isAuthenticated={isAuthenticated}
      user={stableUser}
      autoLoadLibrary={libraryRoute}
      autoLoadRecommendations={recommendationsRoute}
      autoLoadFeedback={feedbackRoute}
      onAuthDegraded={rehydrateSession}
    >
      <DeviceSyncProvider>
        {children}
      </DeviceSyncProvider>
    </PlayerProvider>
  );
}

function RequireAuth({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated, authReady, rehydrateSession } = useAuth();
  const [rehydrating, setRehydrating] = React.useState(false);
  const rehydrateAttemptedRef = React.useRef(false);

  React.useEffect(() => {
    if (!authReady) return;
    if (isAuthenticated) return;

    if (shouldSuppressAuthRedirectAfterLogout()) {
      navigate('/', { replace: true });
      return;
    }

    if (!rehydrateAttemptedRef.current) {
      rehydrateAttemptedRef.current = true;
      setRehydrating(true);
      Promise.resolve(rehydrateSession?.())
        .then((ok) => {
          if (ok) return;
          const origin = typeof window !== 'undefined' ? window.location.origin : 'https://earflow.ru';
          const returnTo = sanitizeReturnTo(new URL(location.pathname + location.search, origin).toString());
          redirectToAuth({ reason: 'require_auth', returnTo, replace: true });
        })
        .catch(() => {
          const origin = typeof window !== 'undefined' ? window.location.origin : 'https://earflow.ru';
          const returnTo = sanitizeReturnTo(new URL(location.pathname + location.search, origin).toString());
          redirectToAuth({ reason: 'require_auth', returnTo, replace: true });
        })
        .finally(() => {
          setRehydrating(false);
        });
      return;
    }

    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://earflow.ru';
    const returnTo = sanitizeReturnTo(new URL(location.pathname + location.search, origin).toString());
    redirectToAuth({ reason: 'require_auth', returnTo, replace: true });
  }, [authReady, isAuthenticated, location.pathname, location.search, navigate, rehydrateSession]);

  if (!authReady) {
    return <LoadingContainer>Загрузка...</LoadingContainer>;
  }

  if (rehydrating) {
    return <LoadingContainer>Загрузка...</LoadingContainer>;
  }

  if (!isAuthenticated) {
    return <LoadingContainer>Требуется авторизация...</LoadingContainer>;
  }

  return children;
}

function useMediaQuery(query, defaultValue = false) {
  const getMatches = React.useCallback(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return defaultValue;
    }
    return window.matchMedia(query).matches;
  }, [defaultValue, query]);

  const [matches, setMatches] = React.useState(getMatches);

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, [query]);

  return matches;
}

function AppLayout() {
  const [showEqModal, setShowEqModal] = React.useState(false);
  const location = useLocation();
  const isMobileViewport = useMediaQuery('(max-width: 767px)');
  const hideGlobalHeader =
    isAuthDomain() ||
    location.pathname.startsWith('/playlist/') ||
    location.pathname.startsWith('/p/') ||
    location.pathname.startsWith('/mix/') ||
    location.pathname.startsWith('/album/') ||
    location.pathname === '/profile' ||
    location.pathname.startsWith('/account/');
  const { isAuthenticated } = useAuth();

  React.useEffect(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://earflow.ru';
    const canonicalUrl = `${origin}${location.pathname}`;

    const { title, description } = computePageMeta(location.pathname, isAuthDomain());
    setPageMeta({ title, description, canonicalUrl });
  }, [location.pathname]);

  return (
    <GestureArbiterProvider>
      <GlobalStyle $mainSurface={!isAuthDomain()} />

      {isAuthenticated && !isAuthDomain() ? <PartyInviteDeepLinkHandler /> : null}

      {!isAuthDomain() ? <CookieConsentBanner reserveBottom={isAuthenticated} /> : null}

      <AppShell $listenerSurface={!isAuthDomain()}>
        {!hideGlobalHeader && <Header />}

        <RoutedContent
          $withHeader={!hideGlobalHeader}
          $compact={!isAuthDomain() && location.pathname !== '/'}
          $useMainSurface={!isAuthDomain()}
        >
          {isAuthDomain() ? (
            <React.Suspense fallback={<LoadingContainer>Загрузка...</LoadingContainer>}>
              <Routes>
                <Route path="/login" element={<AuthStandalonePage />} />
                <Route path="*" element={<AuthStandalonePage />} />
              </Routes>
            </React.Suspense>
          ) : (
            <React.Suspense fallback={<LoadingContainer>Загрузка...</LoadingContainer>}>
              <Routes>
                <Route path="/" element={<MainApp />} />
                <Route path="/playground/mobile-player" element={<MobilePlayerPlayground />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/social" element={<SocialPage />} />
                <Route path="/p/:slug" element={<PlaylistShareRoute />} />
                <Route path="/mix/:token" element={<PublicSharePage />} />
                <Route path="/playlist/:idOrToken" element={<PlaylistRoute />} />
                <Route path="/about" element={<AboutPage />} />
                <Route path="/privacy" element={<LegalPage slug="privacy" />} />
                <Route path="/cookies" element={<LegalPage slug="cookies" />} />
                <Route path="/security" element={<LegalPage slug="security" />} />
                <Route path="/artists/popular" element={<PopularArtistsPage />} />
                <Route path="/artist/:artist" element={<ArtistPage />} />
                <Route path="/artist/:artist/tracks" element={<ArtistTracksPage />} />
                <Route path="/album/:albumPublicId" element={<AlbumPage />} />
                <Route path="/album/:artist/:albumName" element={<AlbumPage />} />
                <Route path="/profile" element={<ProfileWithOffline />} />
                <Route path="/subscription" element={<RequireAuth><SubscriptionPage /></RequireAuth>} />
                <Route path="/mood-radar" element={<RequireAuth><MoodRadarPage /></RequireAuth>} />
                <Route path="/account/:id" element={<ProfileWithOffline />} />
              </Routes>
            </React.Suspense>
          )}
        </RoutedContent>

        {!isAuthDomain() ? <Footer /> : null}
      </AppShell>

      {!isAuthDomain() ? <MobileBottomNav /> : null}

      {isAuthenticated && !isAuthDomain() ? (
        <>
          <React.Suspense fallback={null}>
            {isMobileViewport ? (
              <PlayerChrome onOpenEq={() => setShowEqModal(true)} />
            ) : (
              <GlobalPlayerBar onOpenEq={() => setShowEqModal(true)} />
            )}
            <EqModal isOpen={showEqModal} onClose={() => setShowEqModal(false)} />
          </React.Suspense>
          <PwaInstallPrompt />
        </>
      ) : null}
    </GestureArbiterProvider>
  );
}

function App() {
  const { isAuthenticated, user, rehydrateSession } = useAuth();

  const stableUserId = user?.id || user?.userId || null;
  const stableUsername = user?.username || null;
  const stableUser = useMemo(() => {
    if (!stableUserId) return null;
    return { id: stableUserId, username: stableUsername };
  }, [stableUserId, stableUsername]);

  return (
    <Router>
      <SkinProviderWrapper>
        <OfflineBanner />
        <PlayerRuntimeProvider
          isAuthenticated={isAuthenticated}
          stableUser={stableUser}
          rehydrateSession={rehydrateSession}
        >
          <MiniBarVariantProvider>
            <ListenerUiPrefsSync />
            <PlayerSheetProvider>
              <ErrorBoundary>
                <AppLayout />
              </ErrorBoundary>
            </PlayerSheetProvider>
          </MiniBarVariantProvider>
        </PlayerRuntimeProvider>
      </SkinProviderWrapper>
    </Router>
  );
}

export default App;
