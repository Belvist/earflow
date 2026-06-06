import React, { useCallback, useState } from "react";
import styled from "styled-components";
import apiClient from '../api/client';
import { motion } from 'framer-motion';
import { FaPlay, FaPause, FaStepForward, FaStepBackward, FaArrowLeft } from 'react-icons/fa';
import { GESTURE_PROFILE, getGestureProfile } from '../gestures/gestureProfiles';
import { GESTURE_CAPTURE_POLICY, GESTURE_SURFACE } from '../gestures/gestureContracts';
import { usePointerGestureMachine } from '../gestures/usePointerGestureMachine';

const horizontalSwipeProfile = getGestureProfile(GESTURE_PROFILE.HORIZONTAL_SWIPE);

// Основной контейнер плейлиста
const PlaylistContainer = styled.div`
  width: 100%;
  min-height: 0;
  background: black;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
`;

// Фоновый слой
const BackgroundLayer = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.11);
  backdrop-filter: blur(24.15px);
  z-index: 1;
`;

// Контент wrapper
const ContentWrapper = styled.div`
  position: relative;
  z-index: 2;
  width: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px 120px;
  
  @media (min-width: 768px) {
    padding: 100px 40px 140px;
  }
`;

// Кнопка "Назад"
const BackButton = styled(motion.button)`
  position: fixed;
  top: calc(20px + env(safe-area-inset-top, 0px));
  left: 20px;
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: white;
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
  z-index: 100;
  
  &:hover {
    background: rgba(255, 255, 255, 0.2);
    transform: scale(1.1);
  }
  
  @media (min-width: 768px) {
    top: 30px;
    left: 30px;
    width: 60px;
    height: 60px;
    font-size: 20px;
  }
`;

// Заголовок плейлиста (маленький вверху)
const PlaylistHeader = styled(motion.div)`
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  text-align: center;
  z-index: 90;
  
  @media (min-width: 768px) {
    top: 30px;
  }
`;

const PlaylistTitle = styled.div`
  color: white;
  font-size: 14px;
  font-family: 'Unbounded', sans-serif;
  font-weight: 400;
  text-transform: uppercase;
  
  @media (min-width: 768px) {
    font-size: 16px;
  }
  
  @media (min-width: 1024px) {
    font-size: 18px;
  }
`;

// Контейнер для карточек (с 3D перспективой)
const CardsContainer = styled.div`
  position: relative;
  width: 100%;
  max-width: 500px;
  height: 400px;
  perspective: 1500px;
  perspective-origin: center;
  
  @media (min-width: 768px) {
    max-width: 700px;
    height: 500px;
  }
  
  @media (min-width: 1024px) {
    max-width: 900px;
    height: 600px;
  }
`;

// Карточка трека с правильным 3D позиционированием
const TrackCard = styled(motion.div)`
  position: absolute;
  left: 50%;
  top: 50%;
  width: 90%;
  max-width: 450px;
  height: 140px;
  background: rgba(255, 255, 255, 0.11);
  border-radius: 20px;
  overflow: hidden;
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
  touch-action: pan-y;
  -webkit-user-select: none;
  user-select: none;
  cursor: pointer;
  transform-style: preserve-3d;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
  
  @media (min-width: 768px) {
    max-width: 600px;
    height: 160px;
    border-radius: 25px;
    padding: 20px 30px;
  }
  
  @media (min-width: 1024px) {
    max-width: 800px;
    height: 180px;
    border-radius: 30px;
  }
  
  &:hover {
    background: rgba(255, 255, 255, 0.15);
  }
`;

const TrackCardImage = styled.img`
  width: 70px;
  height: 70px;
  border-radius: 12px;
  object-fit: cover;
  margin-right: 20px;
  flex-shrink: 0;
  
  @media (min-width: 768px) {
    width: 90px;
    height: 90px;
    border-radius: 15px;
  }
  
  @media (min-width: 1024px) {
    width: 110px;
    height: 110px;
  }
`;

const TrackCardInfo = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
`;

const TrackCardTitle = styled.h4`
  color: white;
  font-size: 14px;
  font-family: 'Unbounded', sans-serif;
  font-weight: 500;
  text-transform: uppercase;
  margin-bottom: 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  
  @media (min-width: 768px) {
    font-size: 16px;
  }
  
  @media (min-width: 1024px) {
    font-size: 18px;
  }
`;

const TrackCardArtist = styled.p`
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
  font-family: 'Unbounded', sans-serif;
  font-weight: 300;
  text-transform: uppercase;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  
  @media (min-width: 768px) {
    font-size: 14px;
  }
  
  @media (min-width: 1024px) {
    font-size: 16px;
  }
`;

// Кнопка play в карточке
const PlayButton = styled(motion.div)`
  width: 35px;
  height: 50px;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 9px;
  outline: 6px white solid;
  outline-offset: -3px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  
  &::before {
    content: '▶';
    color: black;
    font-size: 14px;
    margin-left: 2px;
  }
  
  @media (min-width: 768px) {
    width: 40px;
    height: 56px;
    outline: 8px white solid;
    outline-offset: -4px;
    
    &::before {
      font-size: 16px;
    }
  }
`;

// Навигация по карточкам
const NavigationButtons = styled.div`
  position: fixed;
  bottom: 140px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  justify-content: center;
  gap: 20px;
  z-index: 90;
  
  @media (min-width: 768px) {
    bottom: 160px;
    gap: 30px;
  }
`;

const NavButton = styled(motion.button)`
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: white;
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
  
  &:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  
  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.2);
    transform: scale(1.1);
  }
  
  @media (min-width: 768px) {
    width: 60px;
    height: 60px;
    font-size: 20px;
  }
`;

// Мини плеер внизу
const MiniPlayer = styled.div`
  position: fixed;
  bottom: 0;
  left: 0;
  width: 100%;
  background: rgba(0, 0, 0, 0.95);
  backdrop-filter: blur(20px);
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  padding: 15px 20px;
  z-index: 100;
  
  @media (min-width: 768px) {
    padding: 20px 30px;
  }
`;

const MiniPlayerContent = styled.div`
  display: flex;
  align-items: center;
  gap: 15px;
  max-width: 1200px;
  margin: 0 auto;
`;

const MiniPlayerImage = styled.img`
  width: 50px;
  height: 50px;
  border-radius: 8px;
  object-fit: cover;
  flex-shrink: 0;
  
  @media (min-width: 768px) {
    width: 60px;
    height: 60px;
    border-radius: 10px;
  }
`;

const MiniPlayerInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const MiniPlayerTitle = styled.h5`
  color: white;
  font-size: 14px;
  font-family: 'Unbounded', sans-serif;
  font-weight: 500;
  text-transform: uppercase;
  margin-bottom: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const MiniPlayerArtist = styled.p`
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
  font-family: 'Unbounded', sans-serif;
  font-weight: 300;
  text-transform: uppercase;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const MiniPlayerControls = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  
  @media (min-width: 768px) {
    gap: 15px;
  }
`;

const MiniControlButton = styled(motion.button)`
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: white;
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
  
  &:hover {
    background: rgba(255, 255, 255, 0.2);
    transform: scale(1.1);
  }
`;

const MiniPlayButton = styled(motion.button)`
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.9);
  border: none;
  color: black;
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
  
  &:hover {
    background: white;
    transform: scale(1.1);
  }
  
  @media (min-width: 768px) {
    width: 56px;
    height: 56px;
    font-size: 18px;
  }
`;

const PlaylistView = ({
  tracks = [],
  currentTrackIndex = 0,
  isPlaying = false,
  onTrackSelect = () => { },
  onPlayPause = () => { },
  onNext = () => { },
  onPrevious = () => { },
  onBack = () => { }
}) => {
  const [visibleCardIndex, setVisibleCardIndex] = useState(0);

  const handleNextCard = useCallback(() => {
    setVisibleCardIndex(prev => prev < tracks.length - 1 ? prev + 1 : prev);
  }, [tracks.length]);

  const handlePreviousCard = useCallback(() => {
    setVisibleCardIndex(prev => prev > 0 ? prev - 1 : prev);
  }, []);

  const handleCardClick = useCallback((index) => {
    onTrackSelect(tracks[index]);
    setVisibleCardIndex(index);
  }, [onTrackSelect, tracks]);

  const handleSwipe = useCallback((direction) => {
    if (direction === 'left') {
      handleNextCard();
    } else if (direction === 'right') {
      handlePreviousCard();
    }
  }, [handleNextCard, handlePreviousCard]);

  const handleCardSwipeCommit = useCallback(({ state, dx, dy, intent }) => {
    if (intent !== 'horizontal') return;
    const direction = horizontalSwipeProfile.commit({
      dx,
      dy,
      velocityX: state.velocityX,
    });
    if (direction < 0) {
      handleSwipe('left');
    } else if (direction > 0) {
      handleSwipe('right');
    }
  }, [handleSwipe]);

  const { handlers: cardSwipeHandlers } = usePointerGestureMachine({
    surfaceId: GESTURE_SURFACE.COVER_STACK,
    profileId: GESTURE_PROFILE.HORIZONTAL_SWIPE,
    capturePolicy: GESTURE_CAPTURE_POLICY.AFTER_INTENT_LOCK,
    disabled: tracks.length < 2,
    onCommit: handleCardSwipeCommit,
  });

  // Анимации для карточек с 3D эффектом
  const cardVariants = {
    center: {
      x: '-50%',
      y: '-50%',
      scale: 1,
      opacity: 1,
      rotateY: 0,
      z: 0,
      zIndex: 5,
      transition: {
        duration: 0.5,
        ease: "easeInOut"
      }
    },
    left: {
      x: '-50%',
      y: '-50%',
      scale: 0.85,
      opacity: 0.7,
      rotateY: -15,
      z: -200,
      zIndex: 4,
      transition: {
        duration: 0.5,
        ease: "easeInOut"
      }
    },
    farLeft: {
      x: '-50%',
      y: '-50%',
      scale: 0.7,
      opacity: 0.4,
      rotateY: -25,
      z: -400,
      zIndex: 3,
      transition: {
        duration: 0.5,
        ease: "easeInOut"
      }
    },
    right: {
      x: '-50%',
      y: '-50%',
      scale: 0.85,
      opacity: 0.7,
      rotateY: 15,
      z: -200,
      zIndex: 4,
      transition: {
        duration: 0.5,
        ease: "easeInOut"
      }
    },
    farRight: {
      x: '-50%',
      y: '-50%',
      scale: 0.7,
      opacity: 0.4,
      rotateY: 25,
      z: -400,
      zIndex: 3,
      transition: {
        duration: 0.5,
        ease: "easeInOut"
      }
    },
    hidden: {
      x: '-50%',
      y: '-50%',
      scale: 0.5,
      opacity: 0,
      rotateY: 40,
      z: -600,
      zIndex: 1,
      transition: {
        duration: 0.5,
        ease: "easeInOut"
      }
    }
  };

  const getCardVariant = (index) => {
    const diff = index - visibleCardIndex;
    switch (diff) {
      case 0: return 'center';
      case -1: return 'left';
      case -2: return 'farLeft';
      case 1: return 'right';
      case 2: return 'farRight';
      default: return Math.abs(diff) > 2 ? 'hidden' : diff < -2 ? 'farLeft' : 'farRight';
    }
  };

  const currentTrack = tracks[currentTrackIndex] || tracks[0];

  return (
    <PlaylistContainer>
      <BackgroundLayer />

      {/* Кнопка "Назад" */}
      <BackButton
        onClick={onBack}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
      >
        <FaArrowLeft />
      </BackButton>

      <ContentWrapper>
        <PlaylistHeader>
          <PlaylistTitle>РЕКОМЕНДАЦИИ</PlaylistTitle>
        </PlaylistHeader>

        {/* Анимированные карточки */}
        <CardsContainer>
          {tracks.map((track, index) => (
            <TrackCard
              key={track.id}
              variants={cardVariants}
              animate={getCardVariant(index)}
              onClick={() => handleCardClick(index)}
              onPointerDown={getCardVariant(index) === 'center' ? cardSwipeHandlers.onPointerDown : undefined}
              onPointerMove={getCardVariant(index) === 'center' ? cardSwipeHandlers.onPointerMove : undefined}
              onPointerUp={getCardVariant(index) === 'center' ? cardSwipeHandlers.onPointerUp : undefined}
              onPointerCancel={getCardVariant(index) === 'center' ? cardSwipeHandlers.onPointerCancel : undefined}
              whileHover={{ scale: getCardVariant(index) === 'center' ? 1.02 : 1 }}
              style={{
                cursor: getCardVariant(index) === 'center' ? 'grab' : 'default'
              }}
            >
              <TrackCardImage src={apiClient.getCoverUrl(track)} alt={track.title} />
              <TrackCardInfo>
                <TrackCardTitle>{track.title}</TrackCardTitle>
                <TrackCardArtist>{track.artist}</TrackCardArtist>
              </TrackCardInfo>
              {getCardVariant(index) === 'center' && (
                <PlayButton
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                />
              )}
            </TrackCard>
          ))}
        </CardsContainer>

        {/* Навигация */}
        <NavigationButtons>
          <NavButton
            onClick={handlePreviousCard}
            disabled={visibleCardIndex === 0}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <FaStepBackward />
          </NavButton>
          <NavButton
            onClick={handleNextCard}
            disabled={visibleCardIndex === tracks.length - 1}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <FaStepForward />
          </NavButton>
        </NavigationButtons>
      </ContentWrapper>

      {/* Мини плеер */}
      <MiniPlayer>
        <MiniPlayerContent>
          <MiniPlayerImage src={apiClient.getCoverUrl(currentTrack)} alt={currentTrack?.title} />
          <MiniPlayerInfo>
            <MiniPlayerTitle>{currentTrack?.title}</MiniPlayerTitle>
            <MiniPlayerArtist>{currentTrack?.artist}</MiniPlayerArtist>
          </MiniPlayerInfo>
          <MiniPlayerControls>
            <MiniControlButton
              onClick={onPrevious}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
            >
              <FaStepBackward />
            </MiniControlButton>
            <MiniPlayButton
              onClick={onPlayPause}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
            >
              {isPlaying ? <FaPause /> : <FaPlay />}
            </MiniPlayButton>
            <MiniControlButton
              onClick={onNext}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
            >
              <FaStepForward />
            </MiniControlButton>
          </MiniPlayerControls>
        </MiniPlayerContent>
      </MiniPlayer>
    </PlaylistContainer>
  );
};

export default PlaylistView;
