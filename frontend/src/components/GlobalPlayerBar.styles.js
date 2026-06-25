import styled, { keyframes, css } from "styled-components";
import { motion } from "framer-motion";
import {
  DESKTOP_PLAYER_BAR_BOTTOM_OFFSET_PX,
  DESKTOP_PLAYER_BAR_MAX_WIDTH_PX,
  DESKTOP_PLAYER_BAR_MIN_WIDTH_PX,
  DESKTOP_PLAYER_BAR_RADIUS_PX,
  DESKTOP_PLAYER_BAR_SHELL_HEIGHT_PX,
  DESKTOP_PLAYER_BAR_WIDTH_PERCENT,
} from "./desktopPlayerBarTokens";

const deviceSyncTone = {
  connected: '#32d74b',
  standby: '#64d2ff',
  connecting: '#ffd60a',
  reconnecting: '#ffd60a',
  disconnected: 'rgba(255,255,255,0.45)',
  error: '#ff453a',
  disabled: 'rgba(255,255,255,0.35)',
};

/** Compact desktop device-sync entry point. Text lives in title/aria-label, not in the track row. */
export const DeviceSyncStatusDot = styled(motion.button)`
  display: none;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-left: 0;
  border-radius: 999px;
  color: ${p => deviceSyncTone[p.$state] || deviceSyncTone.disconnected};
  background: rgba(0, 0, 0, 0.18);
  border: 1px solid rgba(255, 255, 255, 0.16);
  box-shadow: none;
  padding: 0;
  cursor: pointer;
  flex-shrink: 0;
  line-height: 0;
  outline: none;
  transition: background 0.18s ease, border-color 0.18s ease, transform 0.18s ease;

  &::before {
    content: "";
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: currentColor;
    box-shadow: 0 0 8px currentColor;
  }

  &:hover {
    background: rgba(255, 255, 255, 0.105);
    border-color: rgba(255, 255, 255, 0.18);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.78);
    outline-offset: 2px;
  }

  @media (min-width: 768px) {
    display: inline-flex;
  }
`;

export const DeviceSyncPanelBody = styled.div`
  width: 100%;
  min-height: 0;
  overflow-y: auto;
  box-sizing: border-box;
  padding: 20px 18px 18px;
`;

export const PartyBadge = styled(motion.button)`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 20px;
  border: none;
  background: linear-gradient(
    135deg,
    rgba(29, 185, 84, 0.22) 0%,
    rgba(29, 185, 84, 0.08) 100%
  );
  border: 1px solid rgba(29, 185, 84, 0.25);
  color: white;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  margin-left: 12px;
  white-space: nowrap;

  &:hover {
    transform: scale(1.05);
    box-shadow: 0 4px 12px rgba(29, 185, 84, 0.18);
  }

  &::before {
    content: "🎉";
    font-size: 14px;
  }

  @media (max-width: 1024px) {
    padding: 4px 10px;
    font-size: 11px;
  }
`;

/** Full-width dock — centers the floating pill; no hit target outside the pill. */
export const PlayerBarDock = styled.div`
  position: fixed;
  bottom: ${DESKTOP_PLAYER_BAR_BOTTOM_OFFSET_PX}px;
  left: 0;
  right: 0;
  z-index: 50;
  display: none;
  justify-content: center;
  align-items: flex-end;
  pointer-events: none;
  padding: 0 max(16px, env(safe-area-inset-left, 0px))
    max(0px, env(safe-area-inset-bottom, 0px))
    max(16px, env(safe-area-inset-right, 0px));
  box-sizing: border-box;

  @media (min-width: 768px) {
    display: flex;
  }
`;

export const PlayerBar = styled(motion.div)`
  pointer-events: auto;
  width: ${DESKTOP_PLAYER_BAR_WIDTH_PERCENT}%;
  min-width: min(${DESKTOP_PLAYER_BAR_MIN_WIDTH_PX}px, 94vw);
  max-width: min(${DESKTOP_PLAYER_BAR_MAX_WIDTH_PX}px, 94vw);
  box-sizing: border-box;
  background: ${(p) => p.$accentBg || "rgba(14, 14, 16, 0.96)"};
  padding: 0;
  border-radius: ${DESKTOP_PLAYER_BAR_RADIUS_PX}px;
  overflow: hidden;
  transition: background 0.45s ease;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow:
    0 10px 40px rgba(0, 0, 0, 0.55),
    0 2px 12px rgba(0, 0, 0, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
  backdrop-filter: saturate(1.12);
  -webkit-backdrop-filter: saturate(1.12);
`;

export const DislikeButtonBar = styled(motion.button)`
  padding: 2px 4px;
  border-radius: 6px;
  border: none;
  color: white;
  background: transparent;
  opacity: ${(props) => (props.$active ? 1 : 0.85)};
  font-size: 10px;
  font-family: "Unbounded", sans-serif;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  transition: all 0.2s ease;
  flex-shrink: 0;
  outline: none;

  &:active {
    transform: scale(0.95);
  }

  @media (min-width: 900px) {
    min-width: 26px;
    height: 26px;
    font-size: 11px;
    padding: 2px 5px;
    border-radius: 7px;
  }

  @media (min-width: 1200px) {
    min-width: 28px;
    height: 28px;
    font-size: 12px;
    padding: 3px 6px;
    border-radius: 8px;
  }
`;

export const PlayerBarContent = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: ${DESKTOP_PLAYER_BAR_SHELL_HEIGHT_PX}px;
  margin: 0 auto;
`;

export const ProgressSection = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px 0;
  width: 100%;
  box-sizing: border-box;
  pointer-events: auto;

  @media (min-width: 1200px) {
    padding: 9px 18px 0;
    gap: 12px;
  }
`;

export const ProgressBar = styled.div`
  flex: 1;
  height: 3px;
  background: var(--color-progress-bar, rgba(255, 255, 255, 0.2));
  border-radius: var(--player-progress-radius, 3px);
  cursor: pointer;
  position: relative;
  transition: all 0.2s ease;
  user-select: none;
  -webkit-user-select: none;
  -ms-user-select: none;
  touch-action: none;

  &:hover {
    height: 4px;
    background: rgba(255, 255, 255, 0.3);
  }
`;

const bufferingPulse = keyframes`
  0% { opacity: 0.45; }
  50% { opacity: 0.9; }
  100% { opacity: 0.45; }
`;

export const ProgressFill = styled.div`
  height: 100%;
  background: var(
    --player-accent-gradient,
    linear-gradient(90deg, #ffffff 0%, #e0e0e0 100%)
  );
  border-radius: inherit;
  width: var(--progress, 0%);
  transition: ${(props) => (props.$seeking ? "none" : "width 0.1s linear")};
  position: relative;
  animation: ${(props) =>
    props.$buffering
      ? css`
          ${bufferingPulse} 1s ease-in-out infinite
        `
      : "none"};

  &::after {
    content: "";
    position: absolute;
    right: -6px;
    top: 50%;
    transform: translateY(-50%);
    width: 10px;
    height: 10px;
    background: white;
    border-radius: 50%;
    opacity: 0;
    transition: opacity 0.2s ease;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  ${ProgressBar}:hover &::after {
    opacity: 1;
  }
`;

export const TimeDisplay = styled.div`
  color: rgba(255, 255, 255, 0.7);
  font-size: 10px;
  font-family: "Unbounded", sans-serif;
  font-weight: 400;
  min-width: 32px;
  text-align: center;

  @media (min-width: 1024px) {
    font-size: 10px;
    min-width: 36px;
  }
`;

export const MainPlayerSection = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 14px 12px;
  gap: 10px;
  overflow: visible;
  min-width: 0;
  max-width: 100%;

  @media (min-width: 1200px) {
    padding: 7px 18px 14px;
    gap: 12px;
  }
`;

export const LeftSection = styled.div`
  display: flex;
  align-items: center;
  align-self: center;
  flex: 1 1 0;
  min-width: 0;
  max-width: 38%;
  overflow: hidden;
`;

export const CenterSection = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  min-width: 0;
`;

export const RightSection = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex: 1 1 0;
  min-width: 0;
  max-width: 42%;
  gap: 2px;
  padding-right: 2px;
  overflow: visible;
  flex-wrap: nowrap;

  @media (min-width: 1200px) {
    gap: 4px;
    padding-right: 4px;
  }
`;

export const TrackInfoMini = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  min-height: 0;
`;

export const AlbumCoverMini = styled.img`
  height: 40px;
  aspect-ratio: 4 / 5;
  border-radius: 5px;
  object-fit: cover;
  flex-shrink: 0;
  align-self: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  cursor: pointer;
  outline: none;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  &:hover {
    opacity: 0.92;
  }
  &:active {
    opacity: 0.86;
  }

  @media (min-width: 1024px) {
    height: 42px;
    border-radius: 6px;
  }

  @media (min-width: 1440px) {
    height: 44px;
    border-radius: 6px;
  }
`;

/** Высота как у обложки — две строки центрируются по вертикали рядом с картинкой */
export const TrackDetailsMini = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  min-height: 40px;

  @media (min-width: 1024px) {
    min-height: 42px;
  }

  @media (min-width: 1440px) {
    min-height: 44px;
  }
`;

export const TrackTitleMini = styled.div`
  color: white;
  font-size: 11px;
  font-family: "Unbounded", sans-serif;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.2;

  @media (min-width: 1024px) {
    font-size: 12px;
  }
`;

export const TrackArtistMini = styled.div`
  color: rgba(255, 255, 255, 0.7);
  font-size: 9px;
  font-family: "Unbounded", sans-serif;
  font-weight: 300;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.2;

  @media (min-width: 1024px) {
    font-size: 10px;
  }
`;

export const PlayerControlsBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;

  @media (min-width: 1200px) {
    gap: 12px;
  }
`;

export const ControlButton = styled(motion.button)`
  background: transparent;
  border: none;
  color: white;
  border-radius: 50%;
  width: 26px;
  height: 26px;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
  flex-shrink: 0;
  outline: none;

  &:hover {
    opacity: 0.85;
    transform: scale(1.05);
  }

  &:active {
    transform: scale(0.95);
  }

  @media (min-width: 900px) {
    width: 28px;
    height: 28px;
    font-size: 13px;
  }

  @media (min-width: 1200px) {
    width: 30px;
    height: 30px;
    font-size: 13px;
  }
`;

export const ModeControlButton = styled(ControlButton)`
  position: relative;
  opacity: ${(props) => (props.$active ? 1 : 0.55)};
`;

export const ModeDot = styled.span`
  position: absolute;
  left: 50%;
  bottom: 2px;
  transform: translateX(-50%);
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.95);
  box-shadow: 0 0 10px rgba(255, 255, 255, 0.35);
  pointer-events: none;
`;

export const ModeOneBadge = styled.span`
  position: absolute;
  right: 7px;
  bottom: 7px;
  font-size: 8px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
  pointer-events: none;
`;

export const PlayPauseButton = styled(motion.button)`
  background: transparent;
  border: none;
  color: white;
  border-radius: 50%;
  width: 32px;
  height: 32px;
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  flex-shrink: 0;

  & > svg {
    display: block;
    width: 1em;
    height: 1em;
    transform: ${(props) =>
    props.$isPlaying ? "translateX(0)" : "translateX(1px)"};
    flex-shrink: 0;
  }

  &:hover {
    opacity: 0.88;
    transform: scale(1.06);
  }

  &:active {
    transform: scale(0.94);
  }

  @media (min-width: 1200px) {
    width: 34px;
    height: 34px;
    font-size: 17px;
  }
`;

export const VolumeSlider = styled.input`
  width: 56px;
  min-width: 28px;
  flex-shrink: 1;
  appearance: none;
  height: 3px;
  background: linear-gradient(
    to right,
    rgba(255, 255, 255, 0.8) 0%,
    rgba(255, 255, 255, 0.8) ${(props) => props.$percent || 0}%,
    rgba(255, 255, 255, 0.2) ${(props) => props.$percent || 0}%,
    rgba(255, 255, 255, 0.2) 100%
  );
  border-radius: 2px;
  cursor: pointer;
  transition: width 0.2s ease;

  @media (min-width: 900px) {
    width: 72px;
    height: 4px;
  }

  @media (min-width: 1200px) {
    width: 88px;
  }

  &::-webkit-slider-thumb {
    appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: white;
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
  }

  &::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: white;
    border: none;
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
  }

  &:hover {
    &::-webkit-slider-thumb {
      transform: scale(1.1);
    }
  }

  @media (min-width: 1024px) {
    width: 88px;
  }

  @media (min-width: 1200px) {
    width: 96px;
  }

  @media (min-width: 1440px) {
    width: 108px;
  }
`;

export const EqToggle = styled(motion.button)`
  padding: 2px 4px;
  border-radius: 6px;
  background: transparent;
  border: none;
  color: white;
  opacity: ${(props) => (props.$active ? 1 : 0.85)};
  font-size: 10px;
  font-family: "Unbounded", sans-serif;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  transition: all 0.2s ease;
  flex-shrink: 0;
  outline: none;
  position: relative;

  &:active {
    transform: scale(0.95);
  }

  @media (min-width: 900px) {
    min-width: 26px;
    height: 26px;
    font-size: 11px;
    padding: 2px 5px;
    border-radius: 7px;
  }

  @media (min-width: 1200px) {
    min-width: 28px;
    height: 28px;
    font-size: 12px;
    padding: 3px 6px;
    border-radius: 8px;
  }
`;

export const LikeButtonBar = styled(motion.button)`
  padding: 2px 4px;
  border-radius: 6px;
  border: none;
  color: white;
  background: transparent;
  opacity: ${(props) => (props.$active ? 1 : 0.85)};
  font-size: 10px;
  font-family: "Unbounded", sans-serif;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  transition: all 0.2s ease;
  flex-shrink: 0;
  outline: none;

  &:active {
    transform: scale(0.95);
  }

  @media (min-width: 900px) {
    min-width: 26px;
    height: 26px;
    font-size: 11px;
    padding: 2px 5px;
    border-radius: 7px;
  }

  @media (min-width: 1200px) {
    min-width: 28px;
    height: 28px;
    font-size: 12px;
    padding: 3px 6px;
    border-radius: 8px;
  }
`;

export const RecommendationsPanel = styled(motion.div)`
  position: fixed;
  top: 72px;
  right: ${(props) => props.$offset || "20px"};
  bottom: calc(var(--desktop-player-bar-height, 118px) + 12px);
  width: 360px;
  max-width: 90vw;
  background: radial-gradient(
    circle at top left,
    rgba(255, 255, 255, 0.12),
    rgba(0, 0, 0, 0.96)
  );
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border-radius: 24px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  z-index: 90;
  overflow-y: auto;
  padding: 18px 16px 22px;
  box-shadow: 0 0 40px rgba(0, 0, 0, 0.7);
  scrollbar-width: none;
  -ms-overflow-style: none;
  transition: right 0.3s ease;

  &::-webkit-scrollbar {
    width: 0;
    height: 0;
  }

  @media (min-width: 1024px) {
    width: 420px;
  }
`;

export const RecommendationsHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding: 0 10px;
`;

export const RecommendationsTitle = styled.h3`
  color: white;
  font-size: 15px;
  font-family: "Unbounded", sans-serif;
  font-weight: 400;
  text-transform: uppercase;
  line-height: 1.15;

  @media (min-width: 768px) {
    font-size: 16px;
  }
`;

export const CloseButton = styled.button`
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: white;
  font-size: 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
  margin-left: 8px;

  @media (hover: hover) and (pointer: fine) {
    &:hover {
      background: rgba(255, 255, 255, 0.2);
      transform: scale(1.1);
    }
  }
`;

export const RecommendationsList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

export const RecommendationCard = styled(motion.div)`
  background: ${(props) =>
    props.$active ? "rgba(255, 255, 255, 0.12)" : "transparent"};
  border-radius: 10px;
  padding: 5px 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid
    ${(props) => (props.$active ? "rgba(255, 255, 255, 0.2)" : "transparent")};

  @media (hover: hover) and (pointer: fine) {
    &:hover {
      background: rgba(255, 255, 255, 0.08);
    }
  }
`;

export const RecommendationIndex = styled.div`
  width: 20px;
  color: rgba(255, 255, 255, 0.3);
  font-size: 11px;
  font-family: "Unbounded", sans-serif;
  text-align: center;
  flex-shrink: 0;
`;

export const RecommendationImage = styled.img`
  width: 34px;
  aspect-ratio: 4 / 5;
  height: auto;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);

  @media (min-width: 1024px) {
    width: 36px;
  }
`;

export const RecommendationInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

export const RecommendationTitle = styled.h4`
  color: white;
  font-size: 12px;
  font-family: "Unbounded", sans-serif;
  font-weight: 500;
  margin-bottom: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.3;

  @media (min-width: 1024px) {
    font-size: 13px;
  }
`;

export const RecommendationArtist = styled.p`
  color: rgba(255, 255, 255, 0.6);
  font-size: 10px;
  font-family: "Unbounded", sans-serif;
  font-weight: 300;
  text-transform: uppercase;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  @media (min-width: 768px) {
    font-size: 11px;
  }
`;
