import styled, { keyframes, css } from "styled-components";
import { motion } from "framer-motion";
import { FaCircleNotch } from "react-icons/fa";
import ArtistLinks from "./ArtistLinks";
import { mobilePanelSurface } from "./panels/panelSurface.styles";

const spinAnim = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

export const SpinningIcon = styled(FaCircleNotch)`
  animation: ${spinAnim} 0.8s linear infinite;
`;

export const ModalOverlay = styled(motion.div)`
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  height: 100dvh;
  background: #000;
  z-index: var(--z-sheet, 10051);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* Safe area отступы для iPhone */
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  padding-left: env(safe-area-inset-left, 0px);
  padding-right: env(safe-area-inset-right, 0px);
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
  /* Keep auto during drag so iOS does not scroll the page through the sheet. */
  pointer-events: auto;
  /* GPU acceleration для плавности */
  -webkit-transform: translateZ(0);
  transform: translateZ(0);
  will-change: transform;
  /* Изоляция: pull behind overlay не bounce'ит страницу под ним */
  overscroll-behavior: none;
  contain: layout style paint;

  /* Fallback для браузеров без поддержки dvh */
  @supports not (height: 100dvh) {
    height: 100vh;
    height: -webkit-fill-available;
  }
`;

export const ContentLayer = styled(motion.div)`
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  width: 100%;
`;

/** Progress + transport pinned to bottom (Spotify-style), not under cover flex center. */
export const ControlsDock = styled.div`
  margin-top: auto;
  flex-shrink: 0;
  width: 100%;
  position: relative;
  z-index: 2;
  touch-action: none;
`;

export const ModalHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 16px 12px;
  flex-shrink: 0;
  position: relative;
  z-index: 2;
  touch-action: none;
`;

export const CloseButton = styled(motion.button)`
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: white;
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.12s ease, background 0.2s ease;

  &:active {
    transform: scale(0.95);
  }
`;

export const TrackListOverlay = styled(motion.div)`
  position: fixed;
  bottom: 0;
  left: 0;
  width: 100%;
  height: ${(props) => (props.$expanded ? "90vh" : "60vh")};
  ${mobilePanelSurface}
  z-index: 110;
  padding: 0;
  display: flex;
  flex-direction: column;
  touch-action: none;
  overscroll-behavior: none;
`;

export const DragHandle = styled.div`
  width: 100%;
  height: 44px;
  margin: 0 auto 4px;
  cursor: grab;
  touch-action: none;
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  position: relative;

  &:active {
    cursor: grabbing;
  }

  &::after {
    content: "";
    width: 40px;
    height: 4px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.3);
  }
`;

export const TrackListHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
`;

export const TrackListTitle = styled.h3`
  color: white;
  font-size: 16px;
  font-family: "Unbounded", sans-serif;
  font-weight: 600;
  letter-spacing: -0.02em;
  margin: 0;
`;

export const TrackListSubtitle = styled.p`
  color: rgba(255, 255, 255, 0.4);
  font-size: 12px;
  font-family: "Unbounded", sans-serif;
  margin: 4px 0 0;
`;

export const TrackList = styled.div`
  flex: 1;
  overflow-y: auto;
  padding-right: 4px;
  -webkit-overflow-scrolling: touch;
  min-height: 0;

  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 2px;
  }
`;

export const QueuePanelHost = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
`;

export const TrackListItem = styled(motion.div)`
  padding: 10px 12px;
  border-radius: 14px;
  background: ${(props) =>
    props.$active ? "rgba(255, 255, 255, 0.12)" : "transparent"};
  border: 1px solid
    ${(props) => (props.$active ? "rgba(255, 255, 255, 0.2)" : "transparent")};
  margin-bottom: 4px;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  transition: background 0.16s ease, border-color 0.16s ease;

  &:active {
    background: rgba(255, 255, 255, 0.08);
  }
`;

export const TrackListCover = styled.img`
  width: 48px;
  height: 60px;
  border-radius: 8px;
  object-fit: cover;
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
`;

export const TrackListCoverPlaceholder = styled.div`
  width: 48px;
  height: 60px;
  border-radius: 8px;
  background: linear-gradient(
    135deg,
    rgba(60, 60, 60, 0.8) 0%,
    rgba(30, 30, 30, 0.9) 100%
  );
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  &::after {
    content: "\uD83C\uDFB5";
    font-size: 18px;
    opacity: 0.4;
  }
`;

export const TrackListInfo = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

export const TrackListItemTitle = styled.div`
  color: white;
  font-size: 13px;
  font-family: "Unbounded", sans-serif;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.3;
`;

export const TrackListItemArtist = styled.div`
  color: rgba(255, 255, 255, 0.5);
  font-size: 12px;
  font-family: "Unbounded", sans-serif;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const TrackListItemIndex = styled.div`
  width: 24px;
  color: rgba(255, 255, 255, 0.3);
  font-size: 12px;
  font-family: "Unbounded", sans-serif;
  text-align: center;
  flex-shrink: 0;
`;

export const ModalTitle = styled.div`
  color: rgba(255, 255, 255, 0.8);
  font-size: 12px;
  font-family: "Unbounded", sans-serif;
  text-transform: uppercase;
  text-align: center;
  flex: 1;
`;

export const AlbumSection = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: ${(p) => (p.$lyricsMode ? "stretch" : "center")};
  justify-content: ${(p) => (p.$lyricsMode ? "flex-start" : "flex-start")};
  padding: ${(p) => (p.$lyricsMode ? "0" : "clamp(20px, 5vh, 36px) 16px 12px")};
  max-width: 100%;
  min-height: 0;
  overflow: hidden;
  position: relative;
  z-index: 2;
  touch-action: ${(p) => (p.$lyricsMode ? "auto" : "none")};

  @media (min-width: 768px) {
    max-height: ${(p) => (p.$lyricsMode ? "none" : "60vh")};
  }
`;

/** Cover + title block centered in the flex region above ControlsDock */
export const AlbumBody = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  max-width: 100%;
  flex-shrink: 0;
`;

export const AlbumCoverLarge = styled(motion.img)`
  aspect-ratio: 4 / 5;
  width: min(210px, 54vw, 34vh);
  height: min(262.5px, 67.5vw, 42.5vh);
  border-radius: 14px;
  object-fit: cover;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
  margin-bottom: 16px;
  user-select: none;
  -webkit-user-drag: none;
  pointer-events: none;
  flex-shrink: 0;

  @media (min-height: 700px) {
    width: min(240px, 60vw, 35vh);
    height: min(300px, 75vw, 43.75vh);
    margin-bottom: 18px;
  }

  @media (min-height: 800px) {
    width: min(268px, 66vw, 36vh);
    height: min(335px, 82.5vw, 45vh);
    margin-bottom: 22px;
    border-radius: 16px;
  }

  /* На больших экранах (десктоп) ограничиваем максимальные размеры */
  @media (min-width: 768px) {
    width: min(316px, 30vw, 36vh);
    height: min(395px, 37.5vw, 45vh);
    max-width: 340px;
    max-height: 425px;
  }
`;

export const TrackInfoSection = styled(motion.div)`
  text-align: center;
  margin-bottom: 12px;
  padding: 0 16px;
  flex-shrink: 0;
`;

export const marqueeAnimation = keyframes`
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
`;

export const TrackTitleContainer = styled.div`
  max-width: 100%;
  overflow: hidden;
  position: relative;
  margin-bottom: 4px;

  @media (min-height: 700px) {
    margin-bottom: 6px;
  }

  @media (min-height: 800px) {
    margin-bottom: 8px;
  }
`;

export const TrackTitleLarge = styled.div`
  color: white;
  font-size: 14px;
  font-family: "Unbounded", sans-serif;
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
  user-select: none;
  display: inline-block;

  ${(props) =>
    props.$shouldScroll &&
    css`
      animation: ${marqueeAnimation} ${props.$duration || 10}s linear infinite;
      padding-right: 50px;
    `}

  @media (min-height: 700px) {
    font-size: 15px;
  }

  @media (min-height: 800px) {
    font-size: 17px;
  }
`;

export const TrackArtistLarge = styled(ArtistLinks)`
  color: rgba(255, 255, 255, 0.7);
  font-size: 13px;
  font-family: "Unbounded", sans-serif;
  font-weight: 300;
`;

export const TrackArtistButton = styled(motion.div)`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  padding: 0;
  margin: 0;
  text-decoration: none;
  color: inherit;
  -webkit-tap-highlight-color: transparent;
`;

export const TrackReasonText = styled.div`
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
  font-family: "Unbounded", sans-serif;
  margin-top: 6px;
`;

export const ControlsSection = styled.div`
  margin-top: auto;
  padding: 16px 16px max(16px, env(safe-area-inset-bottom, 0px));
  flex-shrink: 0;
  position: relative;
  z-index: 2;

  @media (min-height: 700px) {
    padding: 20px 20px max(20px, env(safe-area-inset-bottom, 0px));
  }

  @media (min-height: 800px) {
    padding: 24px 26px max(24px, env(safe-area-inset-bottom, 0px));
  }

  /* На больших экранах центрируем и ограничиваем ширину */
  @media (min-width: 768px) {
    max-width: 500px;
    margin: 0 auto;
    width: 100%;
    padding: 0 30px 40px;
  }
`;

export const ProgressSection = styled.div`
  margin-bottom: 18px;

  @media (min-height: 700px) {
    margin-bottom: 22px;
  }

  @media (min-height: 800px) {
    margin-bottom: 26px;
  }
`;

export const ProgressBarContainer = styled.div`
  position: relative;
  width: 100%;
  padding: 12px 0;
  cursor: pointer;
  touch-action: none;
  -webkit-touch-callout: none;
  user-select: none;
  -webkit-user-select: none;

  /* Увеличенная область нажатия для мобильных,
	   но строго в пределах контейнера, чтобы не
	   перекрывать основные кнопки управления */
  &::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    pointer-events: none;
  }
`;

export const ProgressBar = styled.div`
  width: 100%;
  height: 4px;
  background: var(--color-progress-bar, rgba(255, 255, 255, 0.22));
  border-radius: 2px;
  position: relative;
  overflow: visible;

  /* GPU acceleration для плавности */
  transform: translateZ(0);
  will-change: transform;
`;

export const ProgressThumb = styled.div`
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  opacity: ${(props) => (props.$active ? 1 : 0.75)};
  transition: opacity 0.15s ease, transform 0.15s ease;
  pointer-events: none;
  left: var(--progress, 0%);
`;

const bufferingStripes = keyframes`
  0% { background-position: 0 0; }
  100% { background-position: 48px 0; }
`;

export const ProgressFill = styled.div`
  height: 100%;
  min-width: 0;
  background: var(
    --player-accent-gradient,
    linear-gradient(90deg, rgba(255, 255, 255, 0.9) 0%, white 100%)
  );
  border-radius: inherit;
  width: var(--progress, 0%);
  ${(props) => (props.$buffering ? css`
    background-image:
      linear-gradient(90deg, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0.95) 100%),
      repeating-linear-gradient(
        135deg,
        rgba(255,255,255,0.28) 0px,
        rgba(255,255,255,0.28) 8px,
        rgba(255,255,255,0.12) 8px,
        rgba(255,255,255,0.12) 16px
      );
    background-blend-mode: screen;
    background-size: auto, 48px 100%;
    animation: ${bufferingStripes} 0.8s linear infinite;
  ` : '')}
  /* Убираем transition при активном seeking для мгновенного отклика */
  transition: ${(props) => (props.$seeking ? "none" : "width 0.1s linear")};
  transform: translateZ(0);
  will-change: width;
`;

export const TimeDisplay = styled.div`
  display: flex;
  justify-content: space-between;
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
  font-family: "Unbounded", sans-serif;
`;

export const MainControls = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-bottom: 16px;

  @media (min-height: 700px) {
    gap: 14px;
    margin-bottom: 18px;
  }

  @media (min-height: 800px) {
    gap: 16px;
    margin-bottom: 22px;
  }
`;

// Кнопка лайк/дизлайк без фона - только иконка
export const LikeButton = styled(motion.button)`
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: transparent;
  border: none;
  color: ${(props) => (props.$active ? "#ff4757" : "rgba(255, 255, 255, 0.6)")};
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  transition: transform 0.12s ease, color 0.18s ease;
  flex-shrink: 0;

  &:active {
    transform: scale(0.9);
  }

  @media (min-height: 700px) {
    width: 46px;
    height: 46px;
    font-size: 22px;
  }

  @media (min-height: 800px) {
    width: 50px;
    height: 50px;
    font-size: 24px;
  }
`;

export const DislikeButton = styled(motion.button)`
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: transparent;
  border: none;
  color: ${(props) => (props.$active ? "#ffa502" : "rgba(255, 255, 255, 0.6)")};
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  transition: transform 0.12s ease, color 0.18s ease;
  flex-shrink: 0;

  &:active {
    transform: scale(0.9);
  }

  @media (min-height: 700px) {
    width: 46px;
    height: 46px;
    font-size: 22px;
  }

  @media (min-height: 800px) {
    width: 50px;
    height: 50px;
    font-size: 24px;
  }
`;

// Контейнер для меню (3 точки)
export const MoreMenuContainer = styled.div`
  position: relative;
`;

export const MoreMenuDropdown = styled(motion.div)`
  position: absolute;
  bottom: 100%;
  right: 0;
  margin-bottom: 8px;
  background: rgba(30, 30, 30, 0.98);
  border-radius: 12px;
  padding: 8px 0;
  min-width: 180px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.1);
  z-index: 100;
  backdrop-filter: blur(20px);
`;

export const MoreMenuItem = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: transparent;
  border: none;
  color: ${(props) => (props.$active ? "#fff" : "rgba(255, 255, 255, 0.8)")};
  font-size: 14px;
  font-family: "Unbounded", sans-serif;
  cursor: pointer;
  transition: background 0.2s;
  text-align: left;

  @media (hover: hover) and (pointer: fine) {
    &:hover {
      background: rgba(255, 255, 255, 0.1);
    }
  }

  svg {
    font-size: 16px;
    opacity: 0.8;
  }
`;

export const ControlButton = styled(motion.button)`
  width: 46px;
  height: 46px;
  border-radius: 50%;
  background: transparent;
  border: none;
  color: white;
  font-size: 19px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.12s ease, color 0.18s ease, opacity 0.18s ease;
  flex-shrink: 0;
  outline: none;

  &:active {
    transform: scale(0.95);
  }

  @media (min-height: 700px) {
    width: 50px;
    height: 50px;
    font-size: 20px;
  }

  @media (min-height: 800px) {
    width: 54px;
    height: 54px;
    font-size: 21px;
  }
`;

export const PlayPauseButtonLarge = styled(motion.button)`
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: white;
  border: none;
  color: black;
  font-size: 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.12s ease, background 0.2s ease;
  flex-shrink: 0;

  & > svg {
    display: block;
    width: 38%;
    height: 38%;
    transform: ${(props) =>
    props.$isPlaying ? "translateX(0)" : "translateX(2px)"};
    flex-shrink: 0;
  }

  &:active {
    transform: scale(0.95);
  }

  @media (min-height: 700px) {
    width: 58px;
    height: 58px;
    font-size: 21px;
  }

  @media (min-height: 800px) {
    width: 64px;
    height: 64px;
    font-size: 22px;
  }
`;

export const AdditionalControls = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  margin-top: 18px;
  position: relative;
  z-index: 10;
  pointer-events: auto;
`;

export const ActionButton = styled(motion.button)`
  width: 42px;
  height: 42px;
  border-radius: 999px;
  background: transparent;
  border: none;
  color: white;
  opacity: ${(props) => (props.$active ? 1 : 0.75)};
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  transition: transform 0.12s ease, opacity 0.18s ease, color 0.18s ease;
  flex-shrink: 0;
  outline: none;

  &:active {
    transform: scale(0.95);
  }

  @media (min-height: 700px) {
    width: 46px;
    height: 46px;
    font-size: 19px;
  }

  @media (min-height: 800px) {
    width: 50px;
    height: 50px;
    font-size: 20px;
  }
`;
