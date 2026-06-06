/**
 * PlaylistSection Modal Styles
 * Стили для модального окна плейлиста
 */

import styled from 'styled-components';
import { motion } from 'framer-motion';

// ============================================
// Modal Overlay
// ============================================

export const ModalOverlay = styled(motion.div)`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.92);
  backdrop-filter: blur(10px);
  z-index: 100;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0;
  
  @media (min-width: 768px) {
    align-items: center;
    padding: 20px;
  }
`;

// ============================================
// Modal Content
// ============================================

export const ModalContent = styled(motion.div)`
  background: rgba(18, 18, 18, 0.99);
  border-radius: 24px 24px 0 0;
  width: 100%;
  /* Учитываем высоту плеер-бара на мобильных */
  max-height: calc(90vh - var(--player-bar-height-safe, 72px));
  margin-bottom: var(--player-bar-height-safe, 72px);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-bottom: none;
  position: relative;
  
  @media (min-width: 768px) {
    max-width: 550px;
    max-height: 80vh;
    margin-bottom: 0;
    border-radius: 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
`;

// ============================================
// Modal Header
// ============================================

export const ModalHeader = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 20px 16px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  
  @media (min-width: 768px) {
    gap: 20px;
    padding: 24px;
  }
`;

export const ModalCover = styled.img`
  width: 80px;
  height: 100px;
  object-fit: cover;
  border-radius: 10px;
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  
  @media (min-width: 768px) {
    width: 100px;
    height: 125px;
    border-radius: 12px;
  }
`;

export const ModalInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

export const ModalTitle = styled.h2`
  font-size: 16px;
  font-weight: 600;
  font-family: 'Unbounded', sans-serif;
  color: white;
  margin: 0 0 6px;
  line-height: 1.3;
  
  @media (min-width: 768px) {
    font-size: 20px;
    margin: 0 0 8px;
  }
`;

export const ModalMeta = styled.p`
  font-size: 13px;
  font-family: 'Unbounded', sans-serif;
  color: rgba(255, 255, 255, 0.5);
  margin: 0;
`;

// ============================================
// Modal Actions
// ============================================

export const ModalActions = styled.div`
  display: flex;
  gap: 10px;
  margin-top: 12px;
  
  @media (min-width: 768px) {
    gap: 12px;
    margin-top: 16px;
  }
`;

export const ModalButton = styled.button`
  padding: 8px 16px;
  border-radius: 18px;
  border: none;
  font-size: 11px;
  font-family: 'Unbounded', sans-serif;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 6px;
  
  @media (min-width: 768px) {
    padding: 10px 20px;
    border-radius: 20px;
    font-size: 12px;
    gap: 8px;
  }
  
  &.primary {
    background: white;
    color: black;
    
    &:hover {
      transform: scale(1.02);
    }
    
    &:active {
      transform: scale(0.98);
    }
  }
  
  &.secondary {
    background: rgba(255, 255, 255, 0.1);
    color: white;
    
    &:hover {
      background: rgba(255, 255, 255, 0.15);
    }
    
    &:active {
      background: rgba(255, 255, 255, 0.2);
    }
  }
`;

export const CloseButton = styled.button`
  position: absolute;
  top: 12px;
  right: 12px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.1);
  color: white;
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  z-index: 10;
  
  @media (min-width: 768px) {
    top: 16px;
    right: 16px;
    width: 36px;
    height: 36px;
    font-size: 20px;
  }
  
  &:hover {
    background: rgba(255, 255, 255, 0.2);
  }
  
  &:active {
    transform: scale(0.95);
  }
`;

// ============================================
// Track List
// ============================================

export const TrackList = styled.div`
  flex: 1;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  padding: 12px 12px 80px;
  -webkit-overflow-scrolling: touch;
  
  @media (min-width: 768px) {
    padding: 16px 20px 24px;
  }
`;

export const TrackItem = styled(motion.div)`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 8px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.2s ease;
  
  @media (min-width: 768px) {
    gap: 14px;
    padding: 12px;
  }
  
  &:hover {
    background: rgba(255, 255, 255, 0.06);
  }
  
  &:active {
    background: rgba(255, 255, 255, 0.08);
  }
`;

// Анимации для элементов списка
export const trackItemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: (i) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.03,
      duration: 0.2,
      ease: 'easeOut'
    }
  }),
  exit: { opacity: 0, y: -10, transition: { duration: 0.15 } }
};

export const TrackNumber = styled.span`
  width: 20px;
  font-size: 12px;
  font-family: 'Unbounded', sans-serif;
  color: rgba(255, 255, 255, 0.4);
  text-align: center;
  flex-shrink: 0;
  
  @media (min-width: 768px) {
    width: 24px;
    font-size: 13px;
  }
`;

export const TrackCover = styled.img`
  width: 40px;
  height: 50px;
  object-fit: cover;
  border-radius: 6px;
  flex-shrink: 0;
  
  @media (min-width: 768px) {
    width: 44px;
    height: 55px;
  }
`;

export const TrackDetails = styled.div`
  flex: 1;
  min-width: 0;
`;

export const TrackName = styled.div`
  font-size: 13px;
  font-weight: 500;
  font-family: 'Unbounded', sans-serif;
  color: white;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  
  @media (min-width: 768px) {
    font-size: 14px;
  }
`;

export const TrackArtist = styled.div`
  font-size: 11px;
  font-family: 'Unbounded', sans-serif;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  
  @media (min-width: 768px) {
    font-size: 12px;
  }
`;

// ============================================
// Toast Notification
// ============================================

export const Toast = styled(motion.div)`
  position: fixed;
  bottom: 100px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(255, 255, 255, 0.95);
  color: black;
  padding: 12px 24px;
  border-radius: 30px;
  font-size: 13px;
  font-family: 'Unbounded', sans-serif;
  font-weight: 500;
  z-index: 200;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
`;
