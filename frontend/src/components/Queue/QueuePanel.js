/**
 * QueuePanel - Панель очереди воспроизведения
 */

import React, { memo, useCallback } from 'react';
import styled from 'styled-components';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FaTimes,
  FaPlay,
  FaTrash,
  FaRandom,
  FaRedo,
  FaMusic,
  FaListUl
} from 'react-icons/fa';
import { REPEAT_MODES } from '../../hooks/useQueue';
import { QUEUE_SOURCES } from '../../context/player/constants';

function resolveQueueTitle(queueName, queueSource) {
  const name = typeof queueName === 'string' ? queueName.trim() : '';
  if (name) return name;

  switch (queueSource) {
    case QUEUE_SOURCES.AUTO:
      return 'Рекомендации';
    case QUEUE_SOURCES.LIKED:
      return 'Нравится';
    case QUEUE_SOURCES.LIBRARY:
      return 'Мои треки';
    case QUEUE_SOURCES.CUSTOM:
      return 'Очередь';
    default:
      return 'Очередь';
  }
}

const Panel = styled(motion.div)`
  position: fixed;
  right: 0;
  top: 0;
  bottom: 0;
  width: 100%;
  max-width: 380px;
  background: #121212;
  border-left: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  flex-direction: column;
  z-index: 100;
  
  @media (max-width: 768px) {
    max-width: 100%;
  }
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
`;

const HeaderTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  
  h2 {
    font-size: 16px;
    font-weight: 600;
    color: white;
    margin: 0;
  }
  
  span {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.5);
  }
`;

const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const IconButton = styled.button`
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: ${props => props.$active ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.1)'};
  border: none;
  color: ${props => props.$active ? '#4ade80' : 'white'};
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
  
  &:hover {
    background: rgba(255, 255, 255, 0.2);
  }
  
  svg {
    font-size: 14px;
  }
`;

const CloseButton = styled(IconButton)`
  background: transparent;
  
  &:hover {
    background: rgba(255, 255, 255, 0.1);
  }
`;

const NowPlaying = styled.div`
  padding: 16px 20px;
  background: rgba(255, 255, 255, 0.05);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
`;

const NowPlayingLabel = styled.div`
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 12px;
`;

const CurrentTrack = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const CurrentCover = styled.div`
  width: 56px;
  height: 70px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;
  flex-shrink: 0;
  
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`;

const CurrentInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const CurrentTitle = styled.div`
  font-size: 15px;
  font-weight: 600;
  color: white;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
`;

const CurrentArtist = styled.div`
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const QueueSection = styled.div`
  padding: 12px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
`;

const SectionTitle = styled.div`
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 8px;
`;

const QueueList = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 0 0 80px 0;
  
  &::-webkit-scrollbar {
    width: 4px;
  }
  
  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 2px;
  }
`;

const QueueItem = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 20px;
  cursor: pointer;
  transition: background 0.2s;
  background: ${props => props.$isPlaying ? 'rgba(255, 255, 255, 0.1)' : 'transparent'};
  
  &:hover {
    background: rgba(255, 255, 255, 0.08);
  }
`;

const QueuePosition = styled.div`
  width: 24px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.4);
  text-align: center;
`;

const QueueCover = styled.div`
  width: 44px;
  height: 55px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.3);
  
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`;

const QueueInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const QueueTitle = styled.div`
  font-size: 14px;
  color: ${props => props.$isPlaying ? '#4ade80' : 'white'};
  font-weight: ${props => props.$isPlaying ? '600' : '400'};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const QueueArtist = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const QueueDuration = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
`;

const RemoveButton = styled.button`
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: all 0.2s;
  
  ${QueueItem}:hover & {
    opacity: 1;
  }
  
  &:hover {
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }
  
  svg {
    font-size: 12px;
  }
`;

const EmptyQueue = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
  color: rgba(255, 255, 255, 0.5);
  
  svg {
    font-size: 32px;
    margin-bottom: 16px;
    opacity: 0.3;
  }
  
  p {
    font-size: 14px;
    margin: 0;
    max-width: 200px;
  }
`;

const RepeatIcon = styled.div`
  position: relative;
  
  ${props => props.$mode === 'one' && `
    &::after {
      content: '1';
      position: absolute;
      font-size: 8px;
      font-weight: bold;
      bottom: -2px;
      right: -4px;
    }
  `}
`;

const QueuePanel = memo(({
  isOpen,
  onClose,
  queue = [],
  currentIndex = 0,
  currentTrack,
  queueSource = null,
  queueName = '',
  shuffleEnabled = false,
  repeatMode = REPEAT_MODES.OFF,
  onJumpToTrack,
  onRemoveFromQueue,
  onToggleShuffle,
  onToggleRepeat,
  onClearQueue
}) => {
  const handleJump = useCallback((index) => {
    onJumpToTrack?.(index);
  }, [onJumpToTrack]);

  const handleRemove = useCallback((e, position) => {
    e.stopPropagation();
    onRemoveFromQueue?.(position);
  }, [onRemoveFromQueue]);

  const upcomingTracks = queue.slice(currentIndex + 1);

  return (
    <AnimatePresence>
      {isOpen && (
        <Panel
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        >
          <Header>
            <HeaderTitle>
              <FaListUl />
              <h2>{resolveQueueTitle(queueName, queueSource)}</h2>
              <span>{queue.length} треков</span>
            </HeaderTitle>
            <HeaderActions>
              <IconButton
                $active={shuffleEnabled}
                onClick={onToggleShuffle}
                title={shuffleEnabled ? 'Выключить перемешивание' : 'Включить перемешивание'}
              >
                <FaRandom />
              </IconButton>
              <IconButton
                $active={repeatMode !== REPEAT_MODES.OFF}
                onClick={onToggleRepeat}
                title={
                  repeatMode === REPEAT_MODES.OFF ? 'Включить повтор' :
                    repeatMode === REPEAT_MODES.ALL ? 'Повтор одного' : 'Выключить повтор'
                }
              >
                <RepeatIcon $mode={repeatMode}>
                  <FaRedo />
                </RepeatIcon>
              </IconButton>
              <CloseButton onClick={onClose}>
                <FaTimes />
              </CloseButton>
            </HeaderActions>
          </Header>

          {currentTrack && (
            <NowPlaying>
              <NowPlayingLabel>Сейчас играет</NowPlayingLabel>
              <CurrentTrack>
                <CurrentCover>
                  {currentTrack.cover ? (
                    <img
                      src={currentTrack.cover}
                      alt=""
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  ) : (
                    <FaMusic style={{ color: 'rgba(255,255,255,0.3)' }} />
                  )}
                </CurrentCover>
                <CurrentInfo>
                  <CurrentTitle>{currentTrack.title}</CurrentTitle>
                  <CurrentArtist>{currentTrack.artist}</CurrentArtist>
                </CurrentInfo>
              </CurrentTrack>
            </NowPlaying>
          )}

          {upcomingTracks.length > 0 && (
            <QueueSection>
              <SectionTitle>Далее в очереди</SectionTitle>
            </QueueSection>
          )}

          <QueueList>
            {queue.length === 0 ? (
              <EmptyQueue>
                <FaMusic />
                <p>Очередь пуста. Добавьте треки для воспроизведения.</p>
              </EmptyQueue>
            ) : (
              queue.map((track, index) => {
                const isPlaying = index === currentIndex;

                return (
                  <QueueItem
                    key={`${track.id}-${index}`}
                    $isPlaying={isPlaying}
                    onClick={() => handleJump(index)}
                  >
                    <QueuePosition>
                      {isPlaying ? <FaPlay style={{ fontSize: 10 }} /> : index + 1}
                    </QueuePosition>
                    <QueueCover>
                      {track.cover ? (
                        <img
                          src={track.cover}
                          alt=""
                          onError={(e) => { e.target.style.display = 'none'; }}
                        />
                      ) : (
                        <FaMusic />
                      )}
                    </QueueCover>
                    <QueueInfo>
                      <QueueTitle $isPlaying={isPlaying}>{track.title}</QueueTitle>
                      <QueueArtist>{track.artist}</QueueArtist>
                    </QueueInfo>
                    <QueueDuration>{track.duration || '--:--'}</QueueDuration>
                    {!isPlaying && (
                      <RemoveButton
                        onClick={(e) => handleRemove(e, index)}
                        title="Удалить из очереди"
                      >
                        <FaTrash />
                      </RemoveButton>
                    )}
                  </QueueItem>
                );
              })
            )}
          </QueueList>
        </Panel>
      )}
    </AnimatePresence>
  );
});

QueuePanel.displayName = 'QueuePanel';

export default QueuePanel;
