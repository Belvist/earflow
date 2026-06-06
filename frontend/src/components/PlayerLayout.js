import React, { useState, useRef, useEffect } from "react";
import styled from "styled-components";
import { motion } from 'framer-motion';
import apiClient from '../api/client';

// Основной контейнер с адаптацией
const MainContainer = styled.div`
  width: 100%;
  min-height: 100vh;
  min-height: calc(var(--app-vh, 1vh) * 100);
  position: relative;
  background: black;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  
  @media (min-width: 1450px) {
    width: 1450px;
    height: 1901px;
    margin: 0 auto;
    justify-content: flex-start;
  }
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
  max-width: 1297px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 30px;
  
  @media (min-width: 768px) {
    padding: 40px;
    gap: 40px;
  }
  
  @media (min-width: 1450px) {
    position: absolute;
    left: 0;
    top: 0;
    width: 1450px;
    height: 1901px;
    padding: 0;
    max-width: none;
    gap: 0;
  }
`;

// Секция обложки и информации
const MainSection = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  gap: 20px;
  
  @media (min-width: 768px) {
    flex-direction: row;
    gap: 40px;
    align-items: flex-start;
  }
  
  @media (min-width: 1450px) {
    position: absolute;
    left: 0;
    top: 0;
    width: 1450px;
    height: 1200px;
    flex-direction: column;
    align-items: center;
    gap: 0;
  }
`;

// Контейнер обложки альбома
const AlbumCoverContainer = styled.div`
  position: relative;
  width: 280px;
  height: 350px;
  margin: 0 auto 40px;
  
  @media (min-width: 768px) {
    width: 320px;
    height: 400px;
    margin: 0 auto 50px;
  }
  
  @media (min-width: 1024px) {
    width: 340px;
    height: 425px;
    margin: 0 auto 60px;
  }
  
  @media (min-width: 1450px) {
    width: 480px;
    height: 600px;
    aspect-ratio: 4 / 5;
    position: absolute;
    left: 486px;
    top: 359px;
  }
`;

const AlbumCoverShadow = styled.div`
  width: 100%;
  height: 100%;
  position: absolute;
  background: #C5C5C5;
  border-radius: 59px;
`;

const AlbumCoverMain = styled.img`
  width: 100%;
  height: 100%;
  position: absolute;
  top: 0;
  border-radius: 59px;
  object-fit: cover;
`;

const AlbumCoverLayer1 = styled.div`
  width: 90%;
  height: 90%;
  position: absolute;
  left: 5%;
  top: 15%;
  background: rgba(197, 197, 197, 0.3);
  border-radius: 59px;
  z-index: 1;
`;

const AlbumCoverLayer2 = styled.div`
  width: 80%;
  height: 80%;
  position: absolute;
  left: 10%;
  top: 30%;
  background: rgba(197, 197, 197, 0.2);
  border-radius: 59px;
  z-index: 2;
`;

const AlbumCoverLayer3 = styled.div`
  width: 65%;
  height: 65%;
  position: absolute;
  left: 17%;
  top: 50%;
  background: rgba(197, 197, 197, 0.1);
  border-radius: 59px;
  z-index: 3;
`;

// Информация о треке
const TrackInfoContainer = styled.div`
  text-align: center;
  width: 100%;
  
  @media (min-width: 768px) {
    text-align: left;
    flex: 1;
  }
  
  @media (min-width: 1450px) {
    position: absolute;
    left: 0;
    top: 970px;
    width: 1450px;
    text-align: center;
  }
`;

const TrackTitle = styled.div`
  color: white;
  font-size: 18px;
  font-family: 'Unbounded', sans-serif;
  font-weight: 500;
  text-transform: uppercase;
  margin-bottom: 8px;
  
  @media (min-width: 768px) {
    font-size: 20px;
  }
  
  @media (min-width: 1024px) {
    font-size: 22px;
  }
  
  @media (min-width: 1450px) {
    font-size: 24px;
  }
`;

const TrackArtist = styled.h2`
  color: white;
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
  
  @media (min-width: 1450px) {
    font-size: 16px;
  }
`;

// Контролы воспроизведения
const PlaybackControls = styled.div`
  display: flex;
  align-items: center;
  gap: 20px;
  
  @media (min-width: 768px) {
    gap: 30px;
  }
  
  @media (min-width: 1450px) {
    position: absolute;
    left: 50%;
    top: 1370px;
    transform: translateX(-50%);
    gap: 40px;
  }
`;

const ControlButton = styled(motion.div)`
  width: 40px;
  height: 40px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: white;
  font-size: 16px;
  transition: all 0.3s ease;
  
  &:hover {
    background: rgba(255, 255, 255, 0.2);
    transform: scale(1.1);
  }
  
  @media (min-width: 768px) {
    width: 50px;
    height: 50px;
    font-size: 18px;
  }
  
  @media (min-width: 1450px) {
    width: 60px;
    height: 60px;
    font-size: 20px;
  }
`;

const MainPlayControl = styled(motion.div)`
  width: 60px;
  height: 60px;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: black;
  font-size: 20px;
  transition: all 0.3s ease;
  
  &:hover {
    background: white;
    transform: scale(1.1);
  }
  
  @media (min-width: 768px) {
    width: 70px;
    height: 70px;
    font-size: 24px;
  }
  
  @media (min-width: 1450px) {
    width: 80px;
    height: 80px;
    font-size: 28px;
  }
`;

// Прогресс секция
const ProgressSection = styled.div`
  width: 100%;
  
  @media (min-width: 1450px) {
    position: absolute;
    left: 178px;
    top: 1512px;
    width: 1134px;
  }
`;

const ProgressContainer = styled.div`
  width: 100%;
  height: 8px;
  background: rgba(255, 255, 255, 0.11);
  border-radius: 10px;
  backdrop-filter: blur(24.15px);
  position: relative;
  cursor: pointer;
  
  @media (min-width: 768px) {
    height: 10px;
  }
  
  @media (min-width: 1450px) {
    height: 11px;
    border-radius: 73.50px;
  }
`;

const ProgressBarFill = styled.div`
  height: 100%;
  background: rgba(255, 255, 255, 0.63);
  box-shadow: 0px -2px 8px -1px rgba(255, 255, 255, 0.25);
  border-radius: 10px;
  backdrop-filter: blur(24.15px);
  transition: width 0.1s ease;
  width: ${props => props.progress || 25}%;
  
  @media (min-width: 1450px) {
    border-radius: 73.50px;
    box-shadow: 0px -4px 11.3px -1px rgba(255, 255, 255, 0.25);
  }
`;

const ProgressHandle = styled.div`
  width: 20px;
  height: 20px;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 50%;
  position: absolute;
  top: 50%;
  left: ${props => props.progress || 25}%;
  transform: translate(-50%, -50%);
  cursor: pointer;
  transition: left 0.1s ease;
  
  @media (min-width: 768px) {
    width: 24px;
    height: 24px;
  }
  
  @media (min-width: 1450px) {
    width: 35px;
    height: 16px;
    border-radius: 73.50px;
    box-shadow: 0px -4px 11.3px -1px rgba(255, 255, 255, 0.25);
    backdrop-filter: blur(24.15px);
    transform: translateY(-50%);
  }
`;

const TimeDisplay = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  font-family: 'Unbounded', sans-serif;
  margin-top: 8px;
  
  @media (min-width: 768px) {
    font-size: 14px;
    margin-top: 10px;
  }
  
  @media (min-width: 1450px) {
    position: absolute;
    left: 178px;
    top: 1530px;
    width: 1134px;
    margin-top: 0;
  }
`;

// Рекомендации секция
const RecommendationsSection = styled.div`
  width: 100%;
  
  @media (min-width: 1450px) {
    position: absolute;
    left: 105px;
    top: 1547px;
    width: 1297px;
  }
`;

const RecommendationsTitle = styled.h3`
  color: white;
  font-size: 17px;
  font-family: 'Unbounded', sans-serif;
  font-weight: 400;
  text-transform: uppercase;
  margin-bottom: 20px;
  text-align: center;
  
  @media (min-width: 768px) {
    font-size: 20px;
    margin-bottom: 25px;
  }
  
  @media (min-width: 1024px) {
    font-size: 24px;
  }
  
  @media (min-width: 1450px) {
    font-size: 28px;
    margin-bottom: 30px;
  }
`;

// Карточка трека
const TrackCard = styled(motion.div)`
  width: 100%;
  min-height: 120px;
  background: rgba(255, 255, 255, 0.11);
  border-radius: 20px;
  backdrop-filter: blur(24.15px);
  position: relative;
  display: flex;
  align-items: center;
  padding: 20px;
  margin-bottom: 15px;
  cursor: pointer;
  transition: all 0.3s ease;
  
  &:hover {
    background: rgba(255, 255, 255, 0.15);
    transform: translateX(5px);
  }
  
  @media (min-width: 768px) {
    min-height: 140px;
    border-radius: 25px;
    padding: 25px;
  }
  
  @media (min-width: 1450px) {
    width: 1297px;
    height: 147px;
    border-radius: 73.50px;
    padding: 0 30px;
    margin-bottom: 15px;
  }
`;

const TrackCardImage = styled.img`
  width: 60px;
  height: 60px;
  border-radius: 12px;
  object-fit: cover;
  margin-right: 20px;
  flex-shrink: 0;
  
  @media (min-width: 768px) {
    width: 80px;
    height: 80px;
    border-radius: 15px;
  }
  
  @media (min-width: 1450px) {
    width: 86.57px;
    height: 86.57px;
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
`;

// Кнопка play в карточке
const PlayButton = styled(motion.div)`
  width: 30px;
  height: 40px;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 6px;
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
    font-size: 12px;
    margin-left: 1px;
  }
  
  @media (min-width: 768px) {
    width: 35px;
    height: 50px;
    border-radius: 8px;
    outline: 8px white solid;
    outline-offset: -4px;
    
    &::before {
      font-size: 14px;
      margin-left: 2px;
    }
  }
  
  @media (min-width: 1450px) {
    width: 35px;
    height: 56px;
    border-radius: 9px;
    outline: 9px white solid;
    outline-offset: -4.5px;
    position: absolute;
    right: 30px;
    
    &::before {
      font-size: 16px;
      margin-left: 2px;
    }
  }
`;

const PlayerLayout = ({
  trackTitle,
  trackArtist,
  albumCover,
  recommendationTrack,
  isPlaying = false,
  progress = 0,
  currentTime = "0:00",
  duration = "0:00",
  onPlayPause = () => { },
  onProgressClick = () => { },
  onTrackSelect = () => { },
  onNext = () => { },
  onPrevious = () => { }
}) => {
  const [isHovered, setIsHovered] = useState(false);

  const handleProgressClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const clickedValue = (x / rect.width) * 100;
    onProgressClick({ target: { value: clickedValue } });
  };

  return (
    <MainContainer>
      <BackgroundLayer />

      <ContentWrapper>
        {/* Основная секция с обложкой и информацией */}
        <MainSection>
          <AlbumCoverContainer>
            <AlbumCoverShadow />
            <AlbumCoverMain
              key={`layout-${albumCover}`}
              src={albumCover}
              alt={trackTitle}
            />
            <AlbumCoverLayer1 />
            <AlbumCoverLayer2 />
            <AlbumCoverLayer3 />
          </AlbumCoverContainer>

          <TrackInfoContainer>
            <TrackTitle>{trackTitle}</TrackTitle>
            <TrackArtist>{trackArtist}</TrackArtist>
          </TrackInfoContainer>
        </MainSection>

        {/* Контролы воспроизведения */}
        <PlaybackControls>
          <ControlButton
            onClick={onPrevious}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            ⏮
          </ControlButton>
          <MainPlayControl
            onClick={onPlayPause}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            {isPlaying ? '❚❚' : '▶'}
          </MainPlayControl>
          <ControlButton
            onClick={onNext}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            ⏭
          </ControlButton>
        </PlaybackControls>

        {/* Прогресс бар */}
        <ProgressSection>
          <ProgressContainer onClick={handleProgressClick}>
            <ProgressBarFill progress={progress} />
            <ProgressHandle progress={progress} />
          </ProgressContainer>
          <TimeDisplay>
            <span>{currentTime}</span>
            <span>{duration}</span>
          </TimeDisplay>
        </ProgressSection>

        {/* Рекомендации */}
        <RecommendationsSection>
          <RecommendationsTitle>РЕКОМЕНДАЦИИ</RecommendationsTitle>

          <TrackCard
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
            onClick={onTrackSelect}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          >
            <TrackCardImage
              key={`rec-${recommendationTrack.id}-${recommendationTrack.cover_path}`}
              src={apiClient.getCoverUrl(recommendationTrack)}
              alt={recommendationTrack.title}
            />
            <TrackCardInfo>
              <TrackCardTitle>{recommendationTrack.title}</TrackCardTitle>
              <TrackCardArtist>{recommendationTrack.artist}</TrackCardArtist>
            </TrackCardInfo>
            <PlayButton
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
            />
          </TrackCard>
        </RecommendationsSection>
      </ContentWrapper>
    </MainContainer>
  );
};

export default PlayerLayout;
