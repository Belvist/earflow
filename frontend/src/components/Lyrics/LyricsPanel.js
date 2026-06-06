import React, { memo } from 'react';
import styled, { keyframes } from 'styled-components';
import { motion, AnimatePresence } from 'framer-motion';
import { FaTimes, FaAlignLeft } from 'react-icons/fa';
import { useLyricsData } from '../../hooks/useLyrics';
import { useLyricsSync } from '../../hooks/useLyricsSync';
import { useLyricsPlaybackTime } from '../../hooks/useLyricsPlaybackTime';
import { usePlayerState } from '../../context/PlayerContext';
import { useAutoScroll } from './useAutoScroll';
import LyricLineContent from './LyricLineContent';

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
`;

const Overlay = styled(motion.div)`
  position: fixed;
  top: 0;
  right: 0;
  width: 420px;
  height: calc((var(--app-vh, 1vh) * 100) - 90px);
  background: linear-gradient(180deg,
    rgba(0, 0, 0, 0.97) 0%,
    rgba(10, 10, 10, 0.98) 50%,
    rgba(0, 0, 0, 0.99) 100%
  );
  backdrop-filter: blur(30px);
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  z-index: 50;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: -10px 0 50px rgba(0, 0, 0, 0.5);

  @media (max-width: 1024px) { width: 360px; }
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
`;

const Title = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  color: white;
  font-family: 'Unbounded', sans-serif;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.02em;
  svg { color: #4ade80; font-size: 18px; }
`;

const CloseBtn = styled(motion.button)`
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s ease;
  &:hover { background: rgba(255, 255, 255, 0.2); }
`;

const Scroller = styled.div`
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: var(--lyrics-center-pad, 30px) 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-height: 0;
  position: relative;

  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 4px;
  }
`;

const Line = styled(motion.div)`
  font-family: 'Unbounded', sans-serif;
  font-size: 18px;
  font-weight: ${p => p.$isCurrent ? '700' : '400'};
  line-height: 1.5;
  color: ${p => {
    if (p.$isCurrent) return 'rgba(255, 255, 255, 0.95)';
    if (p.$isPast) return 'rgba(255, 255, 255, 0.3)';
    return 'rgba(255, 255, 255, 0.45)';
  }};
  transition: color 0.2s ease, font-weight 0.2s ease;
  cursor: pointer;
  padding: 8px 16px;
  border-radius: 12px;
  &:hover {
    background: rgba(255, 255, 255, 0.05);
    color: ${p => p.$isCurrent ? 'white' : 'rgba(255, 255, 255, 0.65)'};
  }
`;

const ProgressBar = styled.div`
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  width: ${p => p.$progress * 100}%;
  background: linear-gradient(90deg,
    rgba(255, 255, 255, 0.15) 0%,
    rgba(255, 255, 255, 0.05) 100%
  );
  border-radius: 12px;
  transition: width 0.1s linear;
  pointer-events: none;
`;

const LineWrap = styled.div`
  position: relative;
`;

const EmptyState = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: rgba(255, 255, 255, 0.4);
  text-align: center;
  padding: 40px;
`;

const EmptyIcon = styled.div`
  font-size: 32px;
  opacity: 0.3;
  animation: ${pulse} 3s ease-in-out infinite;
`;

const EmptyText = styled.p`
  font-family: 'Unbounded', sans-serif;
  font-size: 12.5px;
  margin: 0;
`;

const LoadingWrap = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const LoadingDots = styled.div`
  display: flex;
  gap: 8px;
  span {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: white;
    animation: ${pulse} 1.4s ease-in-out infinite;
    &:nth-child(2) { animation-delay: 0.2s; }
    &:nth-child(3) { animation-delay: 0.4s; }
  }
`;

const LyricsPanel = memo(({ isOpen, onClose, songId, currentTime, onSeek }) => {
  const playerState = usePlayerState();
  const { loading, hasLyrics, lyrics } = useLyricsData(songId);
  const lines = lyrics?.lines || [];
  const liveTime = useLyricsPlaybackTime(playerState, currentTime);
  const { currentLineIndex, currentWordIndex, lineProgress } = useLyricsSync(lines, liveTime);
  const visibleLines = lines;

  const { containerRef, ACTIVE_ATTR } = useAutoScroll(currentLineIndex, 'scrollIntoView', liveTime);

  const handleLineClick = (line) => {
    if (!onSeek) return;
    const s = Number(line?.startTime);
    if (!Number.isFinite(s) || s < 0) return;
    onSeek(s);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <Overlay
          initial={{ x: '100%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        >
          <Header>
            <Title>
              <FaAlignLeft />
              Текст песни
            </Title>
            <CloseBtn
              onClick={onClose}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
            >
              <FaTimes />
            </CloseBtn>
          </Header>

          {loading ? (
            <LoadingWrap>
              <LoadingDots>
                <span />
                <span />
                <span />
              </LoadingDots>
            </LoadingWrap>
          ) : !hasLyrics ? (
            <EmptyState>
              <EmptyIcon>🎵</EmptyIcon>
              <EmptyText>Текст песни<br />пока недоступен</EmptyText>
            </EmptyState>
          ) : (
            <Scroller ref={containerRef}>
              {visibleLines.map((line, index) => {
                const isCurrent = index === currentLineIndex;
                const isPast = index < currentLineIndex;

                return (
                  <LineWrap
                    key={`${Number(line?.startTime) || index}:${String(line?.text || '')}`}
                    {...(isCurrent ? { [ACTIVE_ATTR]: '' } : {})}
                  >
                    {isCurrent && <ProgressBar $progress={lineProgress} />}
                    <Line
                      $isCurrent={isCurrent}
                      $isPast={isPast}
                      onClick={() => handleLineClick(line)}
                    >
                      <LyricLineContent
                        line={line}
                        isCurrent={isCurrent}
                        currentWordIndex={currentWordIndex}
                      />
                    </Line>
                  </LineWrap>
                );
              })}
            </Scroller>
          )}
        </Overlay>
      )}
    </AnimatePresence>
  );
});

LyricsPanel.displayName = 'LyricsPanel';

export default LyricsPanel;
