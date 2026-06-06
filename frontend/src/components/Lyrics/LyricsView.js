import React, { memo } from 'react';
import styled, { keyframes } from 'styled-components';
import { motion } from 'framer-motion';
import { useLyricsData } from '../../hooks/useLyrics';
import { useLyricsSync } from '../../hooks/useLyricsSync';
import { useLyricsPlaybackTime } from '../../hooks/useLyricsPlaybackTime';
import { usePlayerState } from '../../context/PlayerContext';
import { useAutoScroll } from './useAutoScroll';
import LyricLineContent from './LyricLineContent';

const fadeSlide = keyframes`
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
`;

const Container = styled(motion.div)`
  width: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding: 0;
  overflow: hidden;
  position: relative;
  min-height: 0;
`;

const Scroller = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: var(--lyrics-center-pad, 40px) 20px;
  width: 100%;
  min-height: 0;
  position: relative;

  &::-webkit-scrollbar { display: none; }
  -ms-overflow-style: none;
  scrollbar-width: none;
`;

const Line = styled(motion.div)`
  font-family: 'Unbounded', sans-serif;
  font-size: 20px;
  font-weight: ${p => p.$isCurrent ? '700' : '400'};
  line-height: 1.6;
  text-align: center;
  color: ${p => {
    if (p.$isCurrent) return 'rgba(255, 255, 255, 0.95)';
    if (p.$isPast) return 'rgba(255, 255, 255, 0.25)';
    return 'rgba(255, 255, 255, 0.4)';
  }};
  padding: 8px 20px;
  max-width: 90%;
  transition: color 0.2s ease, font-weight 0.2s ease;
`;

const EmptyState = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: rgba(255, 255, 255, 0.4);
  text-align: center;
`;

const EmptyIcon = styled.div`
  font-size: 30px;
  opacity: 0.5;
`;

const EmptyText = styled.p`
  font-family: 'Unbounded', sans-serif;
  font-size: 12px;
  margin: 0;
`;

const LoadingDot = styled.span`
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: white;
  margin: 0 3px;
  animation: ${fadeSlide} 1.4s ease-in-out infinite;

  &:nth-child(2) { animation-delay: 0.2s; }
  &:nth-child(3) { animation-delay: 0.4s; }
`;

const LoadingWrap = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const LyricsView = memo(({ songId, currentTime, onSeek, className }) => {
  const playerState = usePlayerState();
  const { loading, hasLyrics, lyrics } = useLyricsData(songId);
  const lines = lyrics?.lines || [];
  const liveTime = useLyricsPlaybackTime(playerState, currentTime);
  const { currentLineIndex, currentWordIndex } = useLyricsSync(lines, liveTime);
  const visibleLines = lines;

  const { containerRef, ACTIVE_ATTR } = useAutoScroll(currentLineIndex, 'offset', liveTime);

  if (loading) {
    return (
      <Container className={className}>
        <LoadingWrap>
          <LoadingDot />
          <LoadingDot />
          <LoadingDot />
        </LoadingWrap>
      </Container>
    );
  }

  if (!hasLyrics) {
    return (
      <Container className={className}>
        <EmptyState>
          <EmptyIcon>🎵</EmptyIcon>
          <EmptyText>Текст недоступен</EmptyText>
        </EmptyState>
      </Container>
    );
  }

  return (
    <Container className={className}>
      <Scroller ref={containerRef}>
        {visibleLines.map((line, index) => {
          const isCurrent = index === currentLineIndex;
          const isPast = index < currentLineIndex;

          const handleClick = () => {
            if (!onSeek) return;
            const s = Number(line?.startTime);
            if (!Number.isFinite(s) || s < 0) return;
            onSeek(s);
          };

          return (
            <Line
              key={`${Number(line?.startTime) || index}:${String(line?.text || '')}`}
              {...(isCurrent ? { [ACTIVE_ATTR]: '' } : {})}
              $isCurrent={isCurrent}
              $isPast={isPast}
              onClick={handleClick}
            >
              <LyricLineContent
                line={line}
                isCurrent={isCurrent}
                currentWordIndex={currentWordIndex}
              />
            </Line>
          );
        })}
      </Scroller>
    </Container>
  );
});

LyricsView.displayName = 'LyricsView';

export default LyricsView;
