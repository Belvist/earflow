import styled, { css } from 'styled-components';
import { motion } from 'framer-motion';
import { desktopPanelPlacement, mobilePanelSurface, panelSurfaceFrame } from '../../panels/panelSurface.styles';
import { portraitCoverThumb } from '../../../styles/mediaCover';
import { fontDisplay, fontUi } from './theme';

// Overlay для мобильного bottom sheet
export const MobileOverlay = styled(motion.div)`
  display: none;

  @media (max-width: 768px) {
    display: block;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 1000;
  }
`;

export const DrawerPanel = styled(motion.div)`
  position: ${(props) => (props.$embedded ? 'relative' : 'fixed')};
  font-family: ${fontUi};
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
  width: ${(props) => (props.$embedded ? '100%' : 'auto')};
  height: ${(props) => (props.$embedded ? '100%' : 'auto')};
  -webkit-tap-highlight-color: transparent;

  @media (min-width: 769px) {
    right: 20px;
    ${desktopPanelPlacement}
    ${panelSurfaceFrame}
    z-index: 95;
  }

  @media (min-width: 1024px) {
    width: var(--panel-rail-width, clamp(380px, 29vw, 430px));
  }

  @media (max-width: 768px) {
    ${(props) =>
    props.$embedded
      ? css`
            position: relative;
            inset: auto;
            width: 100%;
            height: auto;
            max-height: none;
            min-height: 0;
            overflow: visible;
            background: transparent;
            border: 0;
            box-shadow: none;
            backdrop-filter: none;
            -webkit-backdrop-filter: none;
            z-index: auto;
          `
      : css`
    left: max(8px, env(safe-area-inset-left, 0px));
    right: max(8px, env(safe-area-inset-right, 0px));
    bottom: var(--player-bar-height-safe, calc(72px + env(safe-area-inset-bottom, 0px)));
    /* Нижний лист: не съедать весь экран, оставлять контекст плееру + safe area */
    height: calc(100dvh - var(--player-bar-height, 72px) - env(safe-area-inset-bottom, 0px) - 12px);
    max-height: calc(100dvh - var(--player-bar-height, 72px) - env(safe-area-inset-bottom, 0px) - 12px);
    min-height: 0;
    ${mobilePanelSurface}
            z-index: 1001;
          `}
  }
`;

/** Сепаратор-«ручка» для bottom sheet: достаточная зона визуально (не хэндл на весь row — overlay ловит клик) */
export const SheetHandle = styled.div`
  width: 48px;
  height: 5px;
  background: rgba(255, 255, 255, 0.28);
  border-radius: 3px;
  margin: 10px auto 6px;
  flex-shrink: 0;
  touch-action: none;
  pointer-events: none;
  user-select: none;
`;

export const DrawerHeaderArea = styled.div`
  flex-shrink: 0;
  padding: 20px 18px 0;

  @media (max-width: 768px) {
    padding: 2px 14px 0;
  }
`;

export const DrawerBody = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 18px calc(22px + env(safe-area-inset-bottom, 0px));
  scrollbar-width: none;
  -ms-overflow-style: none;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-y;

  &::-webkit-scrollbar {
    width: 0;
    height: 0;
  }

  @media (max-width: 768px) {
    padding: 8px 14px calc(24px + env(safe-area-inset-bottom, 0px));
  }

  ${(props) =>
    props.$embedded
      ? css`
          overflow-y: auto;
          flex: 1 1 auto;
          min-height: 0;
          padding-bottom: calc(20px + env(safe-area-inset-bottom, 0px));
          position: relative;
          z-index: 1;
        `
      : ''}
`;

export const DrawerHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0;
  padding: 0 2px 8px;
`;

export const DrawerTitle = styled.h3`
  color: #fff;
  font-size: 18px;
  font-family: ${fontDisplay};
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.2;
  margin: 0;
  text-transform: none;

  @media (min-width: 768px) {
    font-size: 18px;
  }
`;

export const CloseButton = styled.button`
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  border: none;
  color: #fff;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s ease, color 0.2s ease;
  touch-action: manipulation;

  @media (max-width: 768px) {
    width: 44px;
    height: 44px;
    min-width: 44px;
    min-height: 44px;
    font-size: 20px;
  }

  &:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
  }
`;

export const TabsContainer = styled.div`
  display: flex;
  gap: 4px;
  margin: 14px 0 14px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  padding: 4px;
  border-radius: 999px;
`;

export const Tab = styled.button`
  flex: 1;
  min-height: 34px;
  padding: 7px 10px;
  border-radius: 999px;
  border: none;
  font-size: 11.5px;
  font-weight: 700;
  font-family: ${fontUi};
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.2s ease;
  background: ${(props) => (props.$active ? '#fff' : 'transparent')};
  color: ${(props) => (props.$active ? '#000' : 'rgba(255, 255, 255, 0.78)')};
  touch-action: manipulation;

  @media (max-width: 768px) {
    min-height: 44px;
    padding: 10px 12px;
  }

  &:hover {
    background: ${(props) => (props.$active ? '#fff' : 'rgba(255, 255, 255, 0.08)')};
    color: ${(props) => (props.$active ? '#000' : '#fff')};
  }
`;

export const Description = styled.p`
  color: rgba(255, 255, 255, 0.48);
  font-size: 12px;
  line-height: 1.45;
  margin: 0 0 16px 0;
`;

export const FormGroup = styled.div`
  margin-bottom: 12px;
`;

export const Label = styled.label`
  display: block;
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.42);
  margin-bottom: 6px;
  text-transform: none;
  letter-spacing: 0.01em;
`;

export const Input = styled.input`
  width: 100%;
  min-height: 40px;
  box-sizing: border-box;
  padding: 9px 11px;
  border-radius: 9px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: white;
  font-size: 13px;
  font-family: ${fontUi};
  transition: all 0.2s;
  touch-action: manipulation;

  @media (max-width: 768px) {
    min-height: 44px;
  }

  &::placeholder {
    color: rgba(255, 255, 255, 0.3);
  }

  &:focus {
    outline: none;
    border-color: rgba(255, 255, 255, 0.25);
    background: rgba(255, 255, 255, 0.08);
  }
`;

export const CodeInput = styled(Input)`
  text-align: center;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-family: ${fontDisplay};
`;

export const SubmitButton = styled.button`
  width: 100%;
  padding: 10px 12px;
  min-height: 40px;
  border-radius: 999px;
  border: none;
  background: #fff;
  color: #0a0a0a;
  font-size: 13px;
  font-weight: 600;
  font-family: ${fontUi};
  letter-spacing: -0.01em;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s, opacity 0.2s;
  margin-top: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  touch-action: manipulation;
  box-sizing: border-box;

  @media (max-width: 768px) {
    min-height: 44px;
  }

  &:hover:not(:disabled) {
    box-shadow: 0 4px 16px rgba(255, 255, 255, 0.12);
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`;

export const ErrorMessage = styled.div`
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 8px 11px;
  color: rgba(255, 255, 255, 0.78);
  font-size: 12px;
  margin-bottom: 12px;
  line-height: 1.45;
  font-family: ${fontUi};
`;

export const Spinner = styled.div`
  width: 14px;
  height: 14px;
  border: 2px solid rgba(0, 0, 0, 0.12);
  border-top-color: #111;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`;

// ACTIVE PARTY
export const PartyInfo = styled.div`
  text-align: center;
  padding: 12px 12px 14px;
  margin-bottom: 14px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 12px;
  border: 1px solid transparent;
`;

export const PartyName = styled.h4`
  font-size: 15px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
  margin: 0 0 6px 0;
  font-family: ${fontDisplay};
  letter-spacing: -0.02em;
  line-height: 1.25;
  word-break: break-word;
`;

export const PartyStatus = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.52);
  font-weight: 500;
`;

export const StatusDot = styled.span`
  width: 7px;
  height: 7px;
  background: ${(props) => (props.$connected ? '#fff' : 'rgba(255, 255, 255, 0.35)')};
  border-radius: 50%;
  box-shadow: ${(props) => (props.$connected ? '0 0 8px rgba(255, 255, 255, 0.35)' : 'none')};
  animation: ${(props) => (props.$connected ? 'pulse 2s infinite' : 'none')};

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.55;
    }
  }
`;

export const RoleBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  margin-top: 8px;
  background: ${(props) =>
    props.$isHost ? '#fff' : 'rgba(255, 255, 255, 0.07)'};
  color: ${(props) => (props.$isHost ? '#000' : 'rgba(255, 255, 255, 0.65)')};
`;

export const InviteCodeBox = styled.div`
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid transparent;
  border-radius: 12px;
  padding: 14px 12px;
  text-align: center;
  margin-bottom: 14px;
`;

export const InviteCodeLabel = styled.div`
  font-size: 10px;
  color: rgba(255, 255, 255, 0.38);
  margin-bottom: 8px;
  text-transform: none;
  letter-spacing: 0.04em;
  font-weight: 600;
`;

export const InviteCode = styled.div`
  font-size: 19px;
  font-weight: 600;
  font-family: ${fontDisplay};
  color: rgba(255, 255, 255, 0.96);
  letter-spacing: 0.12em;
  font-variant-numeric: tabular-nums;
  user-select: all;
  -webkit-user-select: all;
  word-break: break-all;
  line-height: 1.35;
`;

export const InviteCodeMuted = styled(InviteCode)`
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.04em;
  opacity: 0.6;
  user-select: none;
  -webkit-user-select: none;
`;

export const CopyButton = styled.button`
  margin-top: 10px;
  min-height: 40px;
  padding: 8px 16px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.88);
  font-size: 12px;
  font-weight: 600;
  font-family: ${fontUi};
  letter-spacing: 0.02em;
  text-transform: none;
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease;
  box-sizing: border-box;
  touch-action: manipulation;
  width: 100%;
  max-width: 100%;

  @media (min-width: 400px) {
    width: auto;
    min-width: 160px;
  }

  @media (max-width: 768px) {
    min-height: 44px;
  }

  &:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.22);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.35);
    outline-offset: 2px;
  }
`;

export const InviteError = styled.div`
  margin-top: 10px;
  font-size: 12px;
  line-height: 1.45;
  color: rgba(255, 255, 255, 0.75);
  font-family: ${fontUi};
`;

export const RetryButton = styled(CopyButton)``;

export const Section = styled.div`
  margin-bottom: 18px;
`;

export const SectionTitle = styled.h3`
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.5);
  margin: 0 0 10px 0;
  font-family: ${fontUi};
  letter-spacing: 0.02em;
  text-transform: none;
`;

export const ParticipantsList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

export const Participant = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  min-height: 40px;
  box-sizing: border-box;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 10px;
  border: 1px solid transparent;

  @media (max-width: 768px) {
    min-height: 48px;
    padding: 10px 12px;
  }
`;

export const ParticipantAvatar = styled.div`
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: ${(props) => (props.$isHost ? '#fff' : 'rgba(255, 255, 255, 0.08)')};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  color: ${(props) => (props.$isHost ? '#000' : 'white')};
  flex-shrink: 0;
`;

export const ParticipantInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

export const ParticipantName = styled.div`
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
  line-height: 1.2;
  word-break: break-word;
`;

export const ParticipantRole = styled.div`
  font-size: 10px;
  color: rgba(255, 255, 255, 0.38);
  margin-top: 1px;
`;

export const QueueSection = styled.div`
  max-height: min(32vh, 200px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-y;

  @media (max-width: 768px) {
    max-height: min(44dvh, 300px);
  }
`;

export const QueueItem = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  min-height: 48px;
  box-sizing: border-box;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid transparent;
  border-radius: 10px;
  transition: background 0.18s ease, border-color 0.18s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.07);
    border-color: rgba(255, 255, 255, 0.06);
  }
`;

export const QueueCover = styled.img`
  ${portraitCoverThumb(34)}
  border-radius: 7px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
`;

export const QueueInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

export const QueueTitle = styled.div`
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.94);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const QueueMeta = styled.div`
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const QueueRemoveButton = styled.button`
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  min-width: 32px;
  min-height: 32px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.55);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  font-family: ${fontUi};
  touch-action: manipulation;

  @media (max-width: 768px) {
    width: 40px;
    height: 40px;
    min-width: 40px;
    min-height: 40px;
  }

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.9);
    border-color: rgba(255, 255, 255, 0.2);
  }

  &:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
`;

export const AddCurrentTrackButton = styled.button`
  width: 100%;
  min-height: 40px;
  padding: 10px 12px;
  box-sizing: border-box;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.88);
  font-size: 12px;
  font-weight: 600;
  font-family: ${fontUi};
  letter-spacing: 0.01em;
  text-transform: none;
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease;
  touch-action: manipulation;
  position: relative;
  z-index: 2;

  @media (max-width: 768px) {
    min-height: 44px;
  }

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.2);
  }

  &:disabled {
    opacity: 0.38;
    cursor: not-allowed;
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.3);
    outline-offset: 2px;
  }
`;

export const LeaveButton = styled.button`
  width: 100%;
  min-height: 40px;
  padding: 10px 12px;
  box-sizing: border-box;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.72);
  font-size: 12px;
  font-weight: 600;
  font-family: ${fontUi};
  letter-spacing: 0.01em;
  text-transform: none;
  cursor: pointer;
  margin-top: 6px;
  position: relative;
  z-index: 2;
  transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease;
  touch-action: manipulation;

  @media (max-width: 768px) {
    min-height: 44px;
  }

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.2);
    color: rgba(255, 255, 255, 0.9);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.25);
    outline-offset: 2px;
  }
`;

/* Макет «Время пати»: карточка с названием, две кнопки-капсулы, «сейчас играет» */
export const SessionHeroTitle = styled.div`
  font-size: 20px;
  font-weight: 700;
  font-family: ${fontDisplay};
  color: rgba(255, 255, 255, 0.98);
  letter-spacing: -0.03em;
  line-height: 1.15;
  margin: 0 0 12px 0;
  text-align: left;

  @media (min-width: 768px) {
    font-size: 21px;
  }
`;

export const PartyNameCard = styled.div`
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  margin-bottom: 12px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 22px;
  border: 1px solid transparent;
`;

export const PartyNameTextCol = styled.div`
  flex: 1;
  min-width: 0;
  text-align: left;
`;

export const PartyNameLine = styled.div`
  font-size: 15px;
  font-weight: 600;
  font-family: ${fontDisplay};
  color: rgba(255, 255, 255, 0.96);
  line-height: 1.3;
  word-break: break-word;
  margin: 0 0 4px 0;
`;

export const PartyStatusInline = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  font-weight: 500;
`;

export const StatusDotLg = styled.span`
  width: 9px;
  height: 9px;
  flex-shrink: 0;
  border-radius: 50%;
  margin-top: 2px;
  background: ${(props) => (props.$connected ? '#fff' : 'rgba(255, 255, 255, 0.35)')};
  box-shadow: ${(props) => (props.$connected ? '0 0 10px rgba(255, 255, 255, 0.35)' : 'none')};
`;

export const SharePillRow = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 10px;
  width: 100%;
  position: relative;
  z-index: 2;
`;

export const SharePillButton = styled.button`
  min-width: 0;
  min-height: 72px;
  padding: 12px 10px 14px;
  box-sizing: border-box;
  border-radius: 18px;
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.88);
  font-size: 11px;
  font-weight: 600;
  font-family: ${fontUi};
  line-height: 1.25;
  text-transform: lowercase;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease;
  touch-action: manipulation;
  text-align: center;
  display: flex;
  align-items: stretch;
  justify-content: flex-end;
  flex-direction: column;

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.08);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.3);
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  @media (max-width: 768px) {
    min-height: 64px;
  }
`;

export const MutedCodeHint = styled.div`
  font-size: 13px;
  font-weight: 600;
  font-family: ${fontDisplay};
  color: rgba(255, 255, 255, 0.55);
  letter-spacing: 0.04em;
  text-align: center;
  margin-bottom: 12px;
  line-height: 1.35;
  user-select: all;
  -webkit-user-select: all;
  font-variant-numeric: tabular-nums;
`;

export const SubtleSectionLabel = styled.div`
  font-size: 10px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.38);
  text-transform: lowercase;
  letter-spacing: 0.08em;
  margin: 0 0 8px 0;
`;

export const ParticipantsPanel = styled.div`
  min-height: 104px;
  padding: 10px;
  margin-bottom: 16px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid transparent;
  box-sizing: border-box;
`;

export const NowPlayingBar = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  margin-bottom: 16px;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 10px;
  border: 1px solid transparent;
`;

export const NowPlayingCover = styled.img`
  ${portraitCoverThumb(40)}
  border-radius: 9px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
`;

export const NowPlayingText = styled.div`
  flex: 1;
  min-width: 0;
`;

export const NowPlayingTitle = styled.div`
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const NowPlayingArtist = styled.div`
  font-size: 10px;
  color: rgba(255, 255, 255, 0.42);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const RoleRow = styled.div`
  margin: 0 0 12px 0;
  text-align: left;
`;

export const EndSessionPill = styled.button`
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  box-sizing: border-box;
  border-radius: 999px;
  border: 1px solid rgba(170, 60, 60, 0.45);
  background: rgba(120, 42, 42, 0.78);
  color: rgba(255, 240, 240, 0.96);
  font-size: 12px;
  font-weight: 600;
  font-family: ${fontUi};
  text-transform: lowercase;
  letter-spacing: 0.04em;
  cursor: pointer;
  margin-top: 6px;
  position: relative;
  z-index: 2;
  transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease;
  touch-action: manipulation;

  &:hover:not(:disabled) {
    background: rgba(145, 48, 48, 0.88);
    border-color: rgba(255, 120, 120, 0.35);
    color: rgba(255, 200, 200, 0.98);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 120, 120, 0.45);
    outline-offset: 2px;
  }
`;

export const Spacer8 = styled.div`
  height: 8px;
  flex-shrink: 0;
`;

export const EmptyQueueHint = styled(QueueMeta)`
  text-align: center;
  padding: 10px 0;
  white-space: normal;
`;
