import React, { useState, useMemo } from 'react';
import styled, { createGlobalStyle } from 'styled-components';
import { AnimatePresence } from 'framer-motion';
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import MusicPlayer from './components/MusicPlayer';
import GlobalPlayerBar from './components/GlobalPlayerBar';
import MobilePlayerBar from './components/MobilePlayerBar';
import EqModal from './components/EqModal';
import EmailAuth from './components/EmailAuth';
import ProfilePage from './components/ProfilePage';
// PartyDrawer теперь встроен в GlobalPlayerBar и MobilePlayerBar
import useAuth from './hooks/useAuth';
import { PlayerProvider, usePlayer } from './context/PlayerContext';

const GlobalStyle = createGlobalStyle`
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  body {
    font-family: 'Unbounded', sans-serif;
    background: #000;
    color: #fff;
    overflow-x: hidden;
  }
`;

const AppContainer = styled.div`
  width: 100%;
  min-height: 100vh;
  background: black;
  overflow-x: hidden;
  padding-top: 70px; /* offset for fixed header */
`;

const LoadingContainer = styled.div`
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: black;
  color: white;
  gap: 20px;
  padding: 20px;
`;

const EmailLoginButton = styled.button`
  padding: 16px 45px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.95) 0%, rgba(240, 240, 240, 0.95) 100%);
  border: none;
  border-radius: 14px;
  color: black;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 1px;
  font-family: 'Unbounded', sans-serif;
  transition: all 0.3s ease;
  box-shadow: 
    0 8px 20px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.5);
  
  &:hover {
    background: linear-gradient(135deg, rgba(255, 255, 255, 1) 0%, rgba(245, 245, 245, 1) 100%);
    transform: translateY(-2px);
    box-shadow: 
      0 12px 28px rgba(0, 0, 0, 0.4),
      inset 0 1px 0 rgba(255, 255, 255, 0.6);
  }
  
  &:active {
    transform: translateY(0);
    box-shadow: 
      0 4px 12px rgba(0, 0, 0, 0.3),
      inset 0 1px 0 rgba(255, 255, 255, 0.4);
  }
`;

const ContentWrapper = styled.div`
  max-width: 900px;
  margin: 0 auto;
  padding: 20px;
  
  @media (min-width: 1440px) {
    max-width: 950px;
  }
`;

const Header = styled.header`
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  padding: 14px 20px;
  background: rgba(0,0,0,0.85);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(255,255,255,0.08);
  z-index: 80;
`;


const ProfileButton = styled.button`
  width: 40px;
  height: 40px;
  background: rgba(255, 255, 255, 0.1);
  border: 2px solid rgba(255, 255, 255, 0.3);
  color: white;
  padding: 0;
  border-radius: 50%;
  font-size: 18px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  
  &:hover {
    background: rgba(255, 255, 255, 0.2);
    border-color: rgba(255, 255, 255, 0.5);
  }
  
  &:active {
    transform: scale(0.95);
  }
`;

const ProfileAvatar = styled.img`
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
`;

const ProfileInitial = styled.span`
  font-size: 16px;
  font-weight: 600;
`;

const HeaderActions = styled.div`
  display: flex;
  align-items: center;
`;

function MainApp() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, loading: authLoading, user } = useAuth();
  const player = usePlayer();
  const [showEmailAuth, setShowEmailAuth] = useState(false);
  // Party теперь управляется через GlobalPlayerBar/MobilePlayerBar

  if (authLoading) {
    return (
      <AppContainer>
        <LoadingContainer>Загрузка...</LoadingContainer>
      </AppContainer>
    );
  }

  if (!isAuthenticated) {
    return (
      <AppContainer>
        <LoadingContainer>
          <>
            <p style={{ color: 'rgba(255,255,255,0.7)', marginBottom: '30px', textAlign: 'center', maxWidth: '400px', lineHeight: '1.6' }}>
              Войдите в свой аккаунт для доступа к музыкальной платформе
            </p>
            <EmailLoginButton onClick={() => setShowEmailAuth(true)}>
              Войти через Email
            </EmailLoginButton>
          </>
        </LoadingContainer>

        <AnimatePresence>
          {showEmailAuth && (
            <EmailAuth
              onClose={() => setShowEmailAuth(false)}
              onSuccess={() => {
                setShowEmailAuth(false);
                window.location.reload();
              }}
            />
          )}
        </AnimatePresence>
      </AppContainer>
    );
  }

  const showMainPlayer = location.pathname === '/';

  return (
    <AppContainer>
      <GlobalStyle />

      <Header>
        <HeaderActions>
          <ProfileButton onClick={() => navigate('/profile')}>
            {user && user.photoUrl ? (
              <ProfileAvatar
                src={user.photoUrl}
                alt={user.username || user.firstName || 'Profile'}
              />
            ) : (
              <ProfileInitial>
                {(user?.firstName?.[0] || user?.username?.[0] || '?').toUpperCase()}
              </ProfileInitial>
            )}
          </ProfileButton>
        </HeaderActions>
      </Header>

      {showMainPlayer && (
        <MusicPlayer
          tracks={player.tracks}
          currentTrackIndex={player.currentTrackIndex}
          isPlaying={player.isPlaying}
          progress={player.progress}
          currentTime={player.currentTime}
          duration={player.duration}
          onTrackSelect={player.handleTrackSelect}
          onPlayPause={player.togglePlayPause}
          onNext={player.playNextTrack}
          onPrevious={player.playPreviousTrack}
          onProgressClick={player.handleProgressClick}
          volume={player.volume}
          onVolumeChange={player.setVolume}
          eqEnabled={player.eqEnabled}
          setEqEnabled={player.setEqEnabled}
          eqGains={player.eqGains}
          onEqGainChange={player.onEqGainChange}
          isCurrentLiked={player.currentTrack ? player.likedIds.has(player.currentTrack.id) : false}
          onToggleLike={player.toggleLikeCurrent}
          queueSource={player.queueSource}
          onSwitchToRecommendations={player.switchToRecommendationsQueue}
          onSwitchToLibrary={player.switchToLibraryQueue}
          onPlayPlaylist={player.playPlaylist}
        />
      )}
    </AppContainer>
  );
}

// Layout компонент который оборачивает все страницы
function AppLayout() {
  const [showEqModal, setShowEqModal] = React.useState(false);

  return (
    <>
      <Routes>
        <Route path="/" element={<MainApp />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/account/:id" element={<ProfilePage />} />
      </Routes>

      {/* Десктопный саундбар - Party встроен внутрь */}
      <GlobalPlayerBar onOpenEq={() => setShowEqModal(true)} />

      {/* Мобильный мини-бар */}
      <MobilePlayerBar onOpenEq={() => setShowEqModal(true)} />

      {/* Модальный эквалайзер */}
      <EqModal isOpen={showEqModal} onClose={() => setShowEqModal(false)} />
    </>
  );
}

function App() {
  const { isAuthenticated, user } = useAuth();

  // Стабилизируем userId чтобы PlayerProvider не перерендеривался
  // при изменении других свойств user объекта
  const stableUserId = user?.id || user?.userId || null;
  const stableUser = useMemo(() => {
    if (!user) return null;
    return { id: stableUserId, username: user.username };
  }, [stableUserId, user?.username]);

  return (
    <Router>
      <PlayerProvider isAuthenticated={isAuthenticated} user={stableUser}>
        <AppLayout />
      </PlayerProvider>
    </Router>
  );
}

export default App;
