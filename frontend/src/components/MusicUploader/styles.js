/**
 * MusicUploader Styles
 *
 * Styled components для загрузчика.
 * Адаптивный дизайн для mobile/tablet/desktop.
 *
 * @module MusicUploader/styles
 */

import styled, { keyframes, css } from "styled-components";

// ============================================================================
// Animations
// ============================================================================

export const spin = keyframes`
  to { transform: rotate(360deg); }
`;

export const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
`;

export const slideIn = keyframes`
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
`;

// ============================================================================
// Container
// ============================================================================

export const Container = styled.div`
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-radius: ${(p) => (p.$compact ? "16px" : "20px")};
  border: 1px solid rgba(255, 255, 255, 0.06);
  padding: ${(p) => (p.$compact ? "16px" : "24px")};

  @media (min-width: 768px) {
    padding: ${(p) => (p.$compact ? "20px" : "32px")};
  }
`;

// ============================================================================
// Header
// ============================================================================

export const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 12px;
`;

export const Title = styled.h3`
  display: flex;
  align-items: center;
  gap: 10px;
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  margin: 0;

  svg {
    font-size: 20px;
    opacity: 0.8;
  }

  @media (min-width: 768px) {
    font-size: 18px;
    svg {
      font-size: 22px;
    }
  }
`;

export const HeaderStats = styled.div`
  display: flex;
  gap: 6px;
`;

export const StatBadge = styled.span`
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;

  ${(p) =>
    p.$type === "success" &&
    css`
      background: rgba(76, 217, 100, 0.15);
      color: #4cd964;
    `}

  ${(p) =>
    p.$type === "error" &&
    css`
      background: rgba(255, 59, 48, 0.15);
      color: #ff3b30;
    `}
  
  ${(p) =>
    p.$type === "pending" &&
    css`
      background: rgba(255, 255, 255, 0.1);
      color: rgba(255, 255, 255, 0.7);
    `}
`;

// ============================================================================
// Drop Zone
// ============================================================================

export const DropZone = styled.div`
  position: relative;
  border: 2px dashed
    ${(p) => (p.$isDragOver ? "#fff" : "rgba(255, 255, 255, 0.15)")};
  border-radius: 16px;
  padding: ${(p) => (p.$compact ? "32px 20px" : "48px 24px")};
  text-align: center;
  cursor: pointer;
  transition: all 0.2s ease;
  background: ${(p) =>
    p.$isDragOver ? "rgba(255, 255, 255, 0.05)" : "transparent"};
  -webkit-tap-highlight-color: transparent;

  &:hover {
    border-color: rgba(255, 255, 255, 0.3);
    background: rgba(255, 255, 255, 0.02);
  }

  &:active {
    transform: scale(0.99);
  }

  @media (min-width: 768px) {
    padding: ${(p) => (p.$compact ? "40px 32px" : "64px 48px")};
  }
`;

export const DropZoneIcon = styled.div`
  font-size: 30px;
  color: ${(p) => (p.$isDragOver ? "#fff" : "rgba(255, 255, 255, 0.4)")};
  margin-bottom: 16px;
  transition: all 0.2s ease;

  ${(p) =>
    p.$isDragOver &&
    css`
      transform: scale(1.2);
    `}

  @media (min-width: 768px) {
    font-size: 36px;
  }
`;

export const DropZoneText = styled.p`
  color: rgba(255, 255, 255, 0.8);
  font-size: 12.5px;
  margin: 0 0 8px;

  @media (min-width: 768px) {
    font-size: 13.5px;
  }
`;

export const DropZoneHint = styled.p`
  color: rgba(255, 255, 255, 0.4);
  font-size: 12px;
  margin: 0;
`;

export const DropZoneContent = styled.div`
  pointer-events: none;
`;

export const DropIcon = styled.div`
  font-size: 30px;
  color: ${(p) => (p.$isDragging ? "#fff" : "rgba(255, 255, 255, 0.4)")};
  margin-bottom: 16px;
  transition: all 0.2s ease;

  ${(p) =>
    p.$isDragging &&
    css`
      transform: scale(1.2);
    `}

  @media (min-width: 768px) {
    font-size: 36px;
  }
`;

export const DropText = styled.p`
  color: rgba(255, 255, 255, 0.8);
  font-size: 12.5px;
  margin: 0 0 8px;

  @media (min-width: 768px) {
    font-size: 13.5px;
  }
`;

export const DropHint = styled.p`
  color: rgba(255, 255, 255, 0.4);
  font-size: 12px;
  margin: 0;
`;

export const FileInput = styled.input`
  display: none;
`;

// ============================================================================
// Queue
// ============================================================================

export const Queue = styled.div`
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  overflow: hidden;
`;

export const QueueSection = styled.div`
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  overflow: hidden;
`;

export const QueueHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
`;

export const QueueTitle = styled.h4`
  display: flex;
  align-items: center;
  gap: 8px;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  margin: 0;
`;

export const QueueSize = styled.span`
  color: rgba(255, 255, 255, 0.4);
  font-size: 12px;
  font-weight: 400;
`;

export const QueueActions = styled.div`
  display: flex;
  gap: 8px;
`;

export const ActionButton = styled.button`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: ${(p) => (p.$small ? "6px 12px" : "10px 16px")};
  background: ${(p) =>
    p.$danger ? "rgba(255, 59, 48, 0.1)" : "rgba(255, 255, 255, 0.06)"};
  border: none;
  border-radius: 8px;
  color: ${(p) => (p.$danger ? "#ff3b30" : "rgba(255, 255, 255, 0.7)")};
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s ease;
  -webkit-tap-highlight-color: transparent;

  &:hover {
    background: ${(p) =>
      p.$danger ? "rgba(255, 59, 48, 0.2)" : "rgba(255, 255, 255, 0.1)"};
  }
`;

export const QueueList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 300px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;

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

export const QueueItem = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.04);
  animation: ${slideIn} 0.2s ease;

  ${(p) =>
    p.$status === "success" &&
    css`
      border-color: rgba(76, 217, 100, 0.2);
      background: rgba(76, 217, 100, 0.05);
    `}

  ${(p) =>
    p.$status === "error" &&
    css`
      border-color: rgba(255, 59, 48, 0.2);
      background: rgba(255, 59, 48, 0.05);
    `}
  
  ${(p) =>
    p.$status === "uploading" &&
    css`
      border-color: rgba(255, 255, 255, 0.1);
    `}
`;

export const ItemIcon = styled.div`
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 14px;

  ${(p) =>
    p.$status === "success" &&
    css`
      background: rgba(76, 217, 100, 0.15);
      color: #4cd964;
    `}

  ${(p) =>
    p.$status === "error" &&
    css`
      background: rgba(255, 59, 48, 0.15);
      color: #ff3b30;
    `}
  
  ${(p) =>
    (p.$status === "pending" || p.$status === "cancelled") &&
    css`
      background: rgba(255, 255, 255, 0.08);
      color: rgba(255, 255, 255, 0.5);
    `}
  
  ${(p) =>
    p.$status === "uploading" &&
    css`
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
    `}
`;

export const Spinner = styled.div`
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-top-color: #fff;
  border-radius: 50%;
  animation: ${spin} 0.8s linear infinite;
`;

export const ItemInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

export const ItemName = styled.div`
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const ItemMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  color: rgba(255, 255, 255, 0.4);
  font-size: 11px;
`;

export const ItemError = styled.span`
  color: #ff3b30;
`;

export const ItemProgress = styled.span`
  color: rgba(255, 255, 255, 0.7);
`;

export const ProgressBar = styled.div`
  height: 3px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  margin-top: 8px;
  overflow: hidden;
`;

export const ProgressFill = styled.div`
  height: 100%;
  background: linear-gradient(90deg, #fff 0%, rgba(255, 255, 255, 0.7) 100%);
  border-radius: 2px;
  transition: width 0.2s ease;
`;

export const ItemActions = styled.div`
  display: flex;
  gap: 4px;
  flex-shrink: 0;
`;

export const ItemButton = styled.button`
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: ${(p) =>
    p.$danger ? "rgba(255, 59, 48, 0.1)" : "rgba(255, 255, 255, 0.06)"};
  border: none;
  color: ${(p) => (p.$danger ? "#ff3b30" : "rgba(255, 255, 255, 0.6)")};
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  -webkit-tap-highlight-color: transparent;

  &:hover {
    background: ${(p) =>
      p.$danger ? "rgba(255, 59, 48, 0.2)" : "rgba(255, 255, 255, 0.1)"};
    color: ${(p) => (p.$danger ? "#ff3b30" : "#fff")};
  }
`;

export const QueueFooter = styled.div`
  margin-top: 16px;
  display: flex;
  gap: 12px;
`;

export const UploadButton = styled.button`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 14px 24px;
  background: ${(p) => (p.$secondary ? "rgba(255, 255, 255, 0.1)" : "#fff")};
  border: none;
  border-radius: 12px;
  color: ${(p) => (p.$secondary ? "#fff" : "#000")};
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s ease;
  -webkit-tap-highlight-color: transparent;

  &:hover:not(:disabled) {
    opacity: 0.9;
    filter: brightness(1.05);
  }

  &:active:not(:disabled) {
    transform: translateY(0);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

// ============================================================================
// Modal
// ============================================================================

export const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 1000;
`;

export const Modal = styled.div`
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: calc(100% - 32px);
  max-width: 400px;
  background: #1a1a1a;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  z-index: 1001;
  overflow: hidden;
`;

export const ModalHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
`;

export const ModalTitle = styled.h3`
  display: flex;
  align-items: center;
  gap: 10px;
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  margin: 0;

  svg {
    color: #0088cc;
    font-size: 20px;
  }
`;

export const ModalClose = styled.button`
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.06);
  border: none;
  color: rgba(255, 255, 255, 0.6);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }
`;

export const ModalBody = styled.div`
  padding: 24px 20px;
`;

export const ModalStep = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin-bottom: 20px;

  &:last-of-type {
    margin-bottom: 0;
  }
`;

export const StepNumber = styled.div`
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(0, 136, 204, 0.15);
  color: #0088cc;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
`;

export const StepText = styled.p`
  color: rgba(255, 255, 255, 0.8);
  font-size: 14px;
  line-height: 1.5;
  margin: 4px 0 0;

  strong {
    color: #0088cc;
  }
`;

export const ModalNote = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-top: 24px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 12px;

  svg {
    color: rgba(255, 255, 255, 0.4);
    font-size: 16px;
    flex-shrink: 0;
    margin-top: 2px;
  }

  span {
    color: rgba(255, 255, 255, 0.5);
    font-size: 12px;
    line-height: 1.5;
  }
`;

export const ModalFooter = styled.div`
  padding: 16px 20px 20px;
`;

export const ModalButton = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 14px 24px;
  background: #0088cc;
  border: none;
  border-radius: 12px;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s ease;

  svg {
    font-size: 18px;
  }

  &:hover {
    background: #0077b5;
  }

  &:active {
    transform: scale(0.98);
  }
`;

// ============================================================================
// Additional Queue Components (used by index.js)
// ============================================================================

export const QueueBadge = styled.span`
  padding: 2px 8px;
  background: ${(p) =>
    p.$color ? `${p.$color}20` : "rgba(255, 255, 255, 0.1)"};
  color: ${(p) => p.$color || "#fff"};
  border-radius: 10px;
  font-size: 11px;
  font-weight: 500;
  margin-left: 8px;
`;

export const QueueActionBtn = styled.button`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: ${(p) =>
    p.$danger ? "rgba(255, 59, 48, 0.1)" : "rgba(255, 255, 255, 0.06)"};
  border: none;
  border-radius: 8px;
  color: ${(p) => (p.$danger ? "#ff3b30" : "rgba(255, 255, 255, 0.7)")};
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s ease;
  -webkit-tap-highlight-color: transparent;

  &:hover {
    background: ${(p) =>
      p.$danger ? "rgba(255, 59, 48, 0.2)" : "rgba(255, 255, 255, 0.1)"};
  }
`;

export const QueueItemIcon = styled.div`
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 14px;
  background: rgba(255, 255, 255, 0.08);

  .spin {
    animation: ${spin} 0.8s linear infinite;
  }
`;

export const QueueItemInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

export const QueueItemName = styled.div`
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const QueueItemMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  color: rgba(255, 255, 255, 0.4);
  font-size: 11px;
`;

export const QueueItemError = styled.span`
  color: #ff3b30;
`;

export const QueueItemActions = styled.div`
  display: flex;
  gap: 4px;
  flex-shrink: 0;
`;

export const QueueItemBtn = styled.button`
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: ${(p) =>
    p.$danger ? "rgba(255, 59, 48, 0.1)" : "rgba(255, 255, 255, 0.06)"};
  border: none;
  color: ${(p) => (p.$danger ? "#ff3b30" : "rgba(255, 255, 255, 0.6)")};
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  -webkit-tap-highlight-color: transparent;

  &:hover {
    background: ${(p) =>
      p.$danger ? "rgba(255, 59, 48, 0.2)" : "rgba(255, 255, 255, 0.1)"};
    color: ${(p) => (p.$danger ? "#ff3b30" : "#fff")};
  }
`;

export const UploadButtonRow = styled.div`
  margin-top: 16px;
  display: flex;
  gap: 12px;
`;

// Override ProgressFill with $progress and $color props
export const ProgressFillStyled = styled.div`
  height: 100%;
  width: ${(p) => p.$progress || 0}%;
  background: ${(p) =>
    p.$color ||
    "linear-gradient(90deg, #fff 0%, rgba(255, 255, 255, 0.7) 100%)"};
  border-radius: 2px;
  transition: width 0.2s ease;
`;
