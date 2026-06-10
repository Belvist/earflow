import styled, { css } from 'styled-components';
import { motion } from 'framer-motion';
import { MINI_BAR_VARIANT } from '../../utils/miniBarVariant';
import {
  portraitCoverThumbByHeight,
} from '../../styles/mediaCover';

import {
  FLOATING_PROGRESS_HEIGHT_PX,
  FLOATING_SHELL_RADIUS_PX,
} from './miniPlayButtonVisual';

const CLASSIC_COVER_HEIGHT_PX = 38;
const FLOATING_COVER_HEIGHT_PX = 36;

export const MobilePartyBadge = styled(motion.div)`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 12px;
  background: linear-gradient(
    135deg,
    rgba(29, 185, 84, 0.22) 0%,
    rgba(29, 185, 84, 0.08) 100%
  );
  border: 1px solid rgba(29, 185, 84, 0.25);
  color: white;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;

  &::before {
    content: "🎉";
    font-size: 12px;
  }
`;

export const MiniPlayerShell = styled(motion.div)`
  position: fixed;
  box-sizing: border-box;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: ${(p) => p.$accentBg || 'rgba(18, 12, 14, 0.96)'};
  border: none;
  box-shadow: none;
  outline: none;
  z-index: 9998;
  cursor: pointer;
  touch-action: none;
  overscroll-behavior: contain;
  isolation: isolate;
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
  transform: translate3d(0, 0, 0);
  will-change: transform, opacity;
  backface-visibility: hidden;
  transition: background 420ms ease;

  ${(p) => (p.$variant === MINI_BAR_VARIANT.CLASSIC ? css`
    height: var(--mobile-mini-player-height, 64px);
    max-height: var(--mobile-mini-player-height, 64px);
    left: 0;
    right: 0;
    width: 100%;
    max-width: 100vw;
    bottom: calc(var(--mobile-bottom-nav-height, 48px) + env(safe-area-inset-bottom, 0px));
    border-radius: 0;
  ` : css`
    height: var(--mobile-mini-player-height, 56px);
    max-height: var(--mobile-mini-player-height, 56px);
    left: max(var(--mobile-chrome-side-inset, 10px), env(safe-area-inset-left, 0px));
    right: max(var(--mobile-chrome-side-inset, 10px), env(safe-area-inset-right, 0px));
    width: auto;
    max-width: calc(100vw - (var(--mobile-chrome-side-inset, 10px) * 2));
    bottom: calc(
      var(--mobile-bottom-nav-height, 48px)
      + var(--mobile-mini-player-float-gap, 0px)
      + env(safe-area-inset-bottom, 0px)
    );
    border-radius: ${FLOATING_SHELL_RADIUS_PX}px;
  `)}

  html.keyboard-open & {
    display: none;
    opacity: 0;
    pointer-events: none;
    transform: translate3d(0, calc(100% + 12px), 0);
  }

  @media (min-width: 768px) {
    display: none;
  }
`;

export const MiniPlayerContent = styled.div`
  display: flex;
  align-items: center;
  flex: 1;
  min-height: 0;
  min-width: 0;
  gap: 10px;
  box-sizing: border-box;
  position: relative;
  z-index: 2;
  width: 100%;
  height: 100%;

  padding: 0 14px;
  height: 100%;
`;

export const MiniPlayerMainRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-width: 0;
  min-height: 0;
  gap: 8px;
  width: 100%;
  height: 100%;
`;

/** Like + play — equal-size controls cluster. */
export const MiniControlsCluster = styled.div`
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 8px;
`;

/** Layout-only — no pointer events; keeps swipe lane wide (INV-SHEET-010). */
export const MiniLikeSlot = styled.div`
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  pointer-events: none;
`;

/** Same footprint as MiniPlayControl — heart icon scaled to match play visual weight. */
export const MiniLikeHit = styled(motion.button)`
  pointer-events: auto;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 0;
  margin: 0;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  color: ${(p) => (p.$active ? '#ff4757' : 'rgba(255, 255, 255, 0.72)')};
  border-radius: 50%;
  overflow: hidden;

  ${(p) => (p.$variant === MINI_BAR_VARIANT.CLASSIC ? css`
    width: 30px;
    height: 30px;
    min-width: 30px;
    min-height: 30px;
    max-width: 30px;
    max-height: 30px;

    svg {
      width: 16px;
      height: 16px;
    }
  ` : css`
    width: 42px;
    height: 42px;
    min-width: 42px;
    min-height: 42px;
    max-width: 42px;
    max-height: 42px;

    svg {
      width: 24px;
      height: 24px;
    }
  `)}

  svg {
    flex-shrink: 0;
    pointer-events: none;
  }

  &:active {
    transform: scale(0.94);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.35);
    outline-offset: 2px;
    border-radius: 50%;
  }
`;

export const MiniPlayControl = styled(motion.div)`
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  position: relative;
  z-index: 6;
  pointer-events: auto;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  box-shadow: none;
  border: none;
  padding: 0;
  -webkit-appearance: none;
  appearance: none;
  border-radius: ${(p) => (p.$playStyle === 'metallic' ? '50%' : '0')};
  background: transparent;

  &::before,
  &::after {
    display: none !important;
    content: none !important;
  }

  &[data-play-style='adaptive'] {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
    border-radius: 0 !important;
  }

  &[data-play-style='metallic'] {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
  }

  &:active {
    transform: scale(0.94);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.45);
    outline-offset: 2px;
    border-radius: ${(p) => (p.$playStyle === 'metallic' ? '50%' : '0')};
  }

  & .ef-mini-play-ios-svg,
  & .ef-mini-play-adaptive-svg {
    display: block;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  ${(p) => (p.$variant === MINI_BAR_VARIANT.CLASSIC ? css`
    width: 30px;
    height: 30px;
    min-width: 30px;
    min-height: 30px;
    box-shadow: none;
    background: transparent;
    border: none;
  ` : css`
    width: 42px;
    height: 42px;
    min-width: 42px;
    min-height: 42px;
    box-shadow: none;
    background: transparent;
    border: none;
    padding: 0;
  `)}
`;

export const MiniPlayInner = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  background: transparent;
  border: none;
  box-shadow: none;
  border-radius: ${(p) => (p.$playStyle === 'metallic' ? '50%' : '0')};
`;

export const ProgressBarMini = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  max-width: 100%;
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  overflow: hidden;
  isolation: isolate;
  pointer-events: none;
  z-index: 10;
  --progress: 0%;
  line-height: 0;
  transform: translateZ(0);

  ${(p) => (p.$variant === MINI_BAR_VARIANT.CLASSIC ? css`
    height: 2px;
    min-height: 2px;
    max-height: 2px;
    border-radius: 0;
    background: rgba(0, 0, 0, 0.35);
  ` : css`
    height: ${FLOATING_PROGRESS_HEIGHT_PX}px;
    min-height: ${FLOATING_PROGRESS_HEIGHT_PX}px;
    max-height: ${FLOATING_PROGRESS_HEIGHT_PX}px;
    background: linear-gradient(
      to top,
      rgba(0, 0, 0, 0.72) 0%,
      rgba(0, 0, 0, 0.38) 100%
    );
    border-radius: 0 0 var(--mini-shell-radius, ${FLOATING_SHELL_RADIUS_PX}px) var(--mini-shell-radius, ${FLOATING_SHELL_RADIUS_PX}px);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
  `)}
`;

export const ProgressFillMini = styled.div`
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  display: block;
  min-width: 0;
  max-width: 100%;
  border-radius: inherit;
  background: #ffffff;
  box-shadow:
    0 0 12px rgba(255, 255, 255, 0.65),
    0 0 2px rgba(255, 255, 255, 0.9);
  width: var(--progress, 0%);
  transition: none;
  transform: translateZ(0);
  opacity: 1;
`;

export const SwipeableTrackContainer = styled(motion.div)`
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  touch-action: none;
  overscroll-behavior: contain;
  user-select: none;
  transform: translateZ(0);
  will-change: transform, opacity;
`;

export const MiniTrackInfo = styled(motion.div)`
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
`;

export const MiniAlbumCover = styled.img`
  ${(p) => portraitCoverThumbByHeight(
  p.$variant === MINI_BAR_VARIANT.CLASSIC ? CLASSIC_COVER_HEIGHT_PX : FLOATING_COVER_HEIGHT_PX,
)}
  align-self: center;
`;

export const MiniCoverPlaceholder = styled.div`
  ${(p) => portraitCoverThumbByHeight(
  p.$variant === MINI_BAR_VARIANT.CLASSIC ? CLASSIC_COVER_HEIGHT_PX : FLOATING_COVER_HEIGHT_PX,
)}
  align-self: center;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.35);
  font-size: 13px;
  line-height: 1;
`;

export const MiniTrackDetails = styled.div`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-self: center;
  gap: 2px;
`;

export const MiniTrackTitle = styled.div`
  color: white;
  font-size: ${(p) => (p.$variant === MINI_BAR_VARIANT.CLASSIC ? '12px' : '11px')};
  font-family: "Unbounded", sans-serif;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.1;
`;

export const MiniTrackArtist = styled.div`
  color: rgba(255, 255, 255, 0.62);
  font-size: 9px;
  font-family: "Unbounded", sans-serif;
  font-weight: 400;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.1;
`;
