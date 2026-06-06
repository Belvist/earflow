import React from 'react';
import { motion } from 'framer-motion';
import styled from 'styled-components';
import useMiniPlayStyle, { MINI_PLAY_STYLE } from '../../hooks/useMiniPlayStyle';
import MiniPlayButtonIos from './MiniPlayButtonIos';
import MiniPlayButtonAdaptive from './MiniPlayButtonAdaptive';
import { requestDeviceTiltPermission } from './useDeviceTiltGlare';

const SheetPlayShell = styled(motion.button)`
  width: 72px;
  height: 72px;
  border: none;
  padding: 0;
  margin: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;

  & .ef-mini-play-ios-svg,
  & .ef-mini-play-adaptive-svg {
    display: block;
  }

  @media (min-height: 700px) {
    width: 78px;
    height: 78px;
  }

  @media (min-height: 800px) {
    width: 84px;
    height: 84px;
  }
`;

/**
 * Expanded player sheet play/pause — respects listener miniPlayStyle pref.
 */
export default function PlayerSheetPlayButton({
  isPlaying = false,
  isLoading = false,
  onClick,
  whileTap,
}) {
  const { style: playStyle } = useMiniPlayStyle();
  const iconSize = 72;

  const handleClick = (e) => {
    if (playStyle === MINI_PLAY_STYLE.METALLIC) {
      requestDeviceTiltPermission();
    }
    onClick?.(e);
  };

  return (
    <SheetPlayShell
      type="button"
      onClick={handleClick}
      whileTap={whileTap}
      aria-label={isPlaying ? 'Пауза' : 'Воспроизведение'}
      aria-busy={isLoading || undefined}
      data-play-style={playStyle}
    >
      {/* Keep play/pause visible even while buffering; buffering is shown on progress bar. */}
      {playStyle === MINI_PLAY_STYLE.METALLIC ? (
        <MiniPlayButtonIos isPlaying={isPlaying} size={iconSize} emphasis="high" />
      ) : (
        <MiniPlayButtonAdaptive
          isPlaying={isPlaying}
          size={iconSize - 2}
          iconColor="rgba(255, 255, 255, 0.94)"
        />
      )}
    </SheetPlayShell>
  );
}
