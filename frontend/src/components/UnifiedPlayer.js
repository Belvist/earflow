import React, { useState, useCallback, useMemo, memo } from "react";
import styled from "styled-components";
import { motion, AnimatePresence } from 'framer-motion';
import { FaPlay, FaPause, FaStepForward, FaStepBackward } from 'react-icons/fa';
import apiClient from '../api/client';
import { GESTURE_PROFILE, getGestureProfile } from '../gestures/gestureProfiles';
import { GESTURE_CAPTURE_POLICY, GESTURE_SURFACE } from '../gestures/gestureContracts';
import { usePointerGestureMachine } from '../gestures/usePointerGestureMachine';

const horizontalSwipeProfile = getGestureProfile(GESTURE_PROFILE.HORIZONTAL_SWIPE);

// Основной контейнер
const PlayerContainer = styled.div`
  width: 100%;
  min-height: 100vh;
  min-height: calc(var(--app-vh, 1vh) * 100);
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
  padding: 20px;
`;

// Заголовок "РЕКОМЕНДАЦИИ"
const SectionTitle = styled(motion.h1)`
  color: white;
  font-size: 22px;
  font-family: 'Unbounded', sans-serif;
  font-weight: 400;
  text-transform: uppercase;
  text-align: center;
  margin-bottom: 40px;
  
  @media (min-width: 768px) {
    font-size: 28px;
    margin-bottom: 44px;
  }
  
  @media (min-width: 1024px) {
    font-size: 34px;
    margin-bottom: 56px;
  }
`;

// Контейнер для карточек с 3D перспективой
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

// Карточка трека
const TrackCard = styled(motion.div)`
  position: absolute;
  left: 50%;
  top: 50%;
  width: 90%;
  max-width: 450px;
  height: 140px;
  background: rgba(255, 255, 255, 0.11);
  border-radius: 20px;
  backdrop-filter: blur(24.15px);
  display: flex;
  align-items: center;
  padding: 15px 20px;
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

// Навигация
const NavigationButtons = styled.div`
  position: fixed;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  justify-content: center;
  gap: 20px;
  z-index: 90;
  
  @media (min-width: 768px) {
    bottom: 60px;
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

// Полноэкранный плеер (когда трек запущен)
const FullscreenPlayer = styled(motion.div)`
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: black;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
`;

const AlbumCoverContainer = styled(motion.div)`
  position: relative;
  width: 200px;
  height: 250px;
  margin-bottom: 24px;
  
  @media (min-width: 480px) {
    width: 240px;
    height: 300px;
    margin-bottom: 32px;
  }
  
  @media (min-width: 768px) {
    width: 280px;
    height: 350px;
    margin-bottom: 40px;
  }
  
  @media (min-width: 1024px) {
    width: 320px;
    height: 400px;
    margin-bottom: 60px;
  }
`;

const AlbumCoverLayer = styled(motion.div)`
  position: absolute;
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8);
  
  @media (min-width: 768px) {
    border-radius: 30px;
  }
`;

const AlbumCoverImage = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
`;

const TrackInfoSection = styled(motion.div)`
  text-align: center;
  margin-bottom: 40px;
  width: 100%;
  max-width: 600px;
`;

const TrackTitle = styled.h2`
  color: white;
  font-size: 18px;
  font-family: 'Unbounded', sans-serif;
  font-weight: 600;
  text-transform: uppercase;
  margin-bottom: 10px;
  
  @media (min-width: 768px) {
    font-size: 21px;
  }
  
  @media (min-width: 1024px) {
    font-size: 24px;
  }
`;

const TrackArtist = styled.p`
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
  font-family: 'Unbounded', sans-serif;
  font-weight: 300;
  text-transform: uppercase;
  
  @media (min-width: 768px) {
    font-size: 13px;
  }
  
  @media (min-width: 1024px) {
    font-size: 14px;
  }
`;

// Прогресс бар
const ProgressSection = styled(motion.div)`
  width: 100%;
  max-width: 600px;
  margin-bottom: 30px;
`;

const ProgressBar = styled.div`
  width: 100%;
  height: 6px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
  cursor: pointer;
  position: relative;
  margin-bottom: 10px;
`;

const ProgressFill = styled.div`
  height: 100%;
  background: white;
  border-radius: 3px;
  width: ${props => props.progress || 0}%;
  transition: width 0.1s linear;
`;

const TimeDisplay = styled.div`
  display: flex;
  justify-content: space-between;
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
  font-family: 'Unbounded', sans-serif;
  
  @media (min-width: 768px) {
    font-size: 14px;
  }
`;

// Контролы плеера
const PlayerControls = styled(motion.div)`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  
  @media (min-width: 768px) {
    gap: 30px;
  }
`;

const ControlButton = styled(motion.button)`
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
  
  &:hover {
    background: rgba(255, 255, 255, 0.2);
    transform: scale(1.1);
  }
  
  @media (min-width: 768px) {
    width: 60px;
    height: 60px;
    font-size: 20px;
  }
`;

const PlayPauseButton = styled(motion.button)`
  width: 70px;
  height: 70px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.9);
  border: none;
  color: black;
  font-size: 24px;
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
    width: 80px;
    height: 80px;
    font-size: 28px;
  }
`;

const UnifiedPlayerComponent = ({
  tracks = [],
  currentTrackIndex = 0,
  isPlaying = false,
  progress = 0,
  currentTime = "0:00",
  duration = "0:00",
  onTrackSelect = () => { },
  onPlayPause = () => { },
  onNext = () => { },
  onPrevious = () => { },
  onProgressClick = () => { }
}) => {
  const [visibleCardIndex, setVisibleCardIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleNextCard = useCallback(() => {
    setVisibleCardIndex(prev => prev < tracks.length - 1 ? prev + 1 : prev);
  }, [tracks.length]);

  const handlePreviousCard = useCallback(() => {
    setVisibleCardIndex(prev => prev > 0 ? prev - 1 : prev);
  }, []);

  const handleCardClick = useCallback((index) => {
    onTrackSelect(tracks[index]);
    setVisibleCardIndex(index);
    setIsFullscreen(true);
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

  // Анимации для карточек - memoized to prevent recreation on each render
  const cardVariants = useMemo(() => ({
    center: {
      x: '-50%',
      y: '-50%',
      scale: 1,
      opacity: 1,
      rotateY: 0,
      z: 0,
      zIndex: 5,
      transition: {
        duration: 0.3,
        ease: "easeOut"
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
        duration: 0.3,
        ease: "easeOut"
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
        duration: 0.3,
        ease: "easeOut"
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
        duration: 0.3,
        ease: "easeOut"
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
        duration: 0.3,
        ease: "easeOut"
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
        duration: 0.3,
        ease: "easeOut"
      }
    }
  }), []);

  const getCardVariant = useCallback((index) => {
    const diff = index - visibleCardIndex;
    switch (diff) {
      case 0: return 'center';
      case -1: return 'left';
      case -2: return 'farLeft';
      case 1: return 'right';
      case 2: return 'farRight';
      default: return Math.abs(diff) > 2 ? 'hidden' : diff < -2 ? 'farLeft' : 'farRight';
    }
  }, [visibleCardIndex]);

  const currentTrack = tracks[currentTrackIndex] || tracks[0];

  return (
    <PlayerContainer>
      <BackgroundLayer />

      {/* Экран рекомендаций */}
      <AnimatePresence>
        {!isFullscreen && (
          <ContentWrapper
            as={motion.div}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <SectionTitle
              initial={{ y: -50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              РЕКОМЕНДАЦИИ
            </SectionTitle>

            <CardsContainer>
              {tracks.map((track, index) => {
                const variant = getCardVariant(index);
                const isHidden = variant === 'hidden';
                const isCenter = variant === 'center';

                // Virtualization: skip rendering hidden cards entirely
                if (isHidden) return null;

                return (
                  <TrackCard
                    key={track.id}
                    variants={cardVariants}
                    animate={variant}
                    onClick={() => handleCardClick(index)}
                    onPointerDown={isCenter ? cardSwipeHandlers.onPointerDown : undefined}
                    onPointerMove={isCenter ? cardSwipeHandlers.onPointerMove : undefined}
                    onPointerUp={isCenter ? cardSwipeHandlers.onPointerUp : undefined}
                    onPointerCancel={isCenter ? cardSwipeHandlers.onPointerCancel : undefined}
                    whileHover={{ scale: isCenter ? 1.02 : 1 }}
                    style={{
                      cursor: isCenter ? 'grab' : 'default',
                      willChange: isCenter ? 'transform' : 'auto'
                    }}
                    layout
                  >
                    <TrackCardImage
                      src={apiClient.getCoverUrl(track)}
                      alt={track.title}
                      loading="lazy"
                      decoding="async"
                    />
                    <TrackCardInfo>
                      <TrackCardTitle>{track.title}</TrackCardTitle>
                      <TrackCardArtist>{track.artist}</TrackCardArtist>
                    </TrackCardInfo>
                  </TrackCard>
                );
              })}
            </CardsContainer>

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
        )}
      </AnimatePresence>

      {/* Полноэкранный плеер */}
      <AnimatePresence>
        {isFullscreen && (
          <FullscreenPlayer
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.4 }}
            onClick={() => setIsFullscreen(false)}
          >
            <AlbumCoverContainer
              initial={{ y: -100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              <AlbumCoverLayer
                style={{
                  width: '100%',
                  height: '100%',
                  inset: 0
                }}
              >
                <AlbumCoverImage
                  key={`unified-${currentTrack?.id}-${currentTrack?.cover_path}`}
                  src={apiClient.getCoverUrl(currentTrack)}
                  alt={currentTrack?.title}
                />
              </AlbumCoverLayer>
            </AlbumCoverContainer>

            <TrackInfoSection
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              <TrackTitle>{currentTrack?.title}</TrackTitle>
              <TrackArtist>{currentTrack?.artist}</TrackArtist>
            </TrackInfoSection>

            <ProgressSection
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              onClick={(e) => e.stopPropagation()}
            >
              <ProgressBar onClick={onProgressClick}>
                <ProgressFill progress={progress} />
              </ProgressBar>
              <TimeDisplay>
                <span>{currentTime}</span>
                <span>{duration}</span>
              </TimeDisplay>
            </ProgressSection>

            <PlayerControls
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.5 }}
              onClick={(e) => e.stopPropagation()}
            >
              <ControlButton
                onClick={onPrevious}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <FaStepBackward />
              </ControlButton>
              <PlayPauseButton
                onClick={onPlayPause}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                {isPlaying ? <FaPause /> : <FaPlay />}
              </PlayPauseButton>
              <ControlButton
                onClick={onNext}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <FaStepForward />
              </ControlButton>
            </PlayerControls>
          </FullscreenPlayer>
        )}
      </AnimatePresence>
    </PlayerContainer>
  );
};

const UnifiedPlayer = memo(UnifiedPlayerComponent);
export default UnifiedPlayer;
