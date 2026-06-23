import React, { useState, useRef, useEffect } from 'react';
import styled, { createGlobalStyle } from 'styled-components';
import MusicPlayer from './components/MusicPlayer';
import useAuth from './hooks/useAuth';
import useSongs from './hooks/useSongs';

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
`;

const LoadingContainer = styled.div`
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: black;
  color: white;
`;

const ContentWrapper = styled.div`
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
`;

function App() {
  const { isAuthenticated, user, loading: authLoading } = useAuth();
  const { songs, formatSongsForPlayer } = useSongs(isAuthenticated);

  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef(null);

  const tracks = formatSongsForPlayer(songs);
  const currentTrack = tracks[currentTrackIndex] || null;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateTime = () => {
      setCurrentTime(audio.currentTime);
      setProgress((audio.currentTime / audio.duration) * 100);
    };

    const updateDuration = () => {
      setDuration(audio.duration);
    };

    const handleEnded = () => {
      playNextTrack();
    };

    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('loadedmetadata', updateDuration);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('loadedmetadata', updateDuration);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [currentTrackIndex]);

  const togglePlayPause = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const playNextTrack = () => {
    if (tracks.length === 0) return;
    const nextIndex = (currentTrackIndex + 1) % tracks.length;
    setCurrentTrackIndex(nextIndex);
    setIsPlaying(false);
  };

  const playPreviousTrack = () => {
    if (tracks.length === 0) return;
    const prevIndex = currentTrackIndex === 0 ? tracks.length - 1 : currentTrackIndex - 1;
    setCurrentTrackIndex(prevIndex);
    setIsPlaying(false);
  };

  const handleProgressClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const clickedValue = (x / rect.width) * 100;
    const newTime = (clickedValue / 100) * audioRef.current.duration;
    audioRef.current.currentTime = newTime;
    setProgress(clickedValue);
  };

  const handleTrackSelect = (track) => {
    const trackIndex = tracks.findIndex(t => t.id === track.id);
    if (trackIndex !== -1) {
      setCurrentTrackIndex(trackIndex);
      setIsPlaying(false);
      if (audioRef.current) {
        audioRef.current.load();
        setTimeout(() => audioRef.current.play().catch(e => { void e; }), 100);
      }
    }
  };

  const formatTime = (time) => {
    if (isNaN(time)) return "0:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  };

  if (authLoading) {
    return (
      <AppContainer>
        <LoadingContainer>🎵 Загрузка...</LoadingContainer>
      </AppContainer>
    );
  }

  if (!isAuthenticated) {
    return (
      <AppContainer>
        <LoadingContainer>Требуется вход</LoadingContainer>
      </AppContainer>
    );
  }

  return (
    <AppContainer>
      <GlobalStyle />

      {currentTrack && (
        <audio
          ref={audioRef}
          src={currentTrack.audioUrl}
          preload="metadata"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          crossOrigin="anonymous"
          playsInline
        />
      )}

      {tracks.length === 0 ? (
        <ContentWrapper>
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'white' }}>
            <h3>🎵 Добро пожаловать!</h3>
            <p style={{ color: 'rgba(255,255,255,0.7)', marginBottom: '30px' }}>
              Загрузка треков доступна только через кабинет артиста.
            </p>
            <a href="https://artists.earflow.ru/" style={{ color: '#fff' }}>
              Перейти в кабинет артиста
            </a>
          </div>
        </ContentWrapper>
      ) : (
        <MusicPlayer
          tracks={tracks}
          currentTrackIndex={currentTrackIndex}
          isPlaying={isPlaying}
          progress={progress}
          currentTime={formatTime(currentTime)}
          duration={formatTime(duration)}
          onTrackSelect={handleTrackSelect}
          onPlayPause={togglePlayPause}
          onNext={playNextTrack}
          onPrevious={playPreviousTrack}
          onProgressClick={handleProgressClick}
        />
      )}
    </AppContainer>
  );
}

export default App;
