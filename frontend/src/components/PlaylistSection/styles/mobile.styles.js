/**
 * PlaylistSection Mobile Styles
 * Стили только для мобильной версии (до 768px)
 */

import styled from 'styled-components';
import { motion } from 'framer-motion';
import { portraitCoverBox } from '../../../styles/mediaCover';

// ============================================
// Container Styles
// ============================================

export const SectionContainer = styled.section`
  position: relative;
  z-index: 3;
  width: 100%;
  padding: ${p => (p.$compactTop ? '14px 12px 28px' : '22px 12px 32px')};
  background: transparent;
  
  @media (min-width: 480px) {
    padding: ${p => (p.$compactTop ? '14px 14px 30px' : '22px 14px 32px')};
  }
`;

export const SectionHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  
  @media (min-width: 480px) {
    margin-bottom: 18px;
  }
`;

export const SectionTitle = styled.h2`
  font-size: 12.5px;
  font-weight: 600;
  font-family: 'Unbounded', sans-serif;
  color: white;
  letter-spacing: -0.02em;
  margin: 0;
  
  @media (min-width: 480px) {
    font-size: 13.5px;
  }
`;

// ============================================
// Scroll Container
// ============================================

export const ScrollContainer = styled.div`
  position: relative;
  width: 100%;
  overflow: hidden;
`;

export const ScrollWrapper = styled.div`
  display: flex;
  overflow-x: auto;
  scroll-behavior: smooth;
  scrollbar-width: none;
  -ms-overflow-style: none;
  -webkit-overflow-scrolling: touch;
  gap: 12px;
  margin-left: -12px;
  margin-right: -12px;
  width: calc(100% + 24px);
  padding: 0 12px 12px;
  box-sizing: border-box;
  scroll-padding-inline: 12px;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  touch-action: pan-x pan-y;
  overscroll-behavior-x: contain;
  overscroll-behavior-y: auto;
  
  &::-webkit-scrollbar {
    display: none;
  }
  
  &:active {
    cursor: grabbing;
    scroll-behavior: auto;
  }
  
  @media (min-width: 480px) {
    gap: 14px;
  }
`;

// ============================================
// Featured Card (Открытия недели) - Mobile
// ============================================

export const FeaturedCard = styled(motion.div)`
  width: 118px;
  flex-shrink: 0;
  position: relative;
  cursor: pointer;
  overflow: hidden;
  background: transparent;
  transition: transform 0.2s ease;
  scroll-snap-align: start;
  
  &:active {
    transform: scale(0.98);
  }
  
  @media (min-width: 480px) {
    width: 132px;
  }
`;

export const FeaturedInfo = styled.div`
  padding: 8px 0 0;
  text-align: left;
`;

export const FeaturedTitle = styled.h3`
  font-size: 10.5px;
  font-weight: 700;
  font-family: 'Unbounded', sans-serif;
  color: white;
  margin: 0;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  
  @media (min-width: 480px) {
    font-size: 11px;
  }
`;

// ============================================
// Regular Playlist Card - Mobile
// ============================================

export const PlaylistCard = styled(motion.div)`
  width: 118px;
  flex-shrink: 0;
  position: relative;
  cursor: pointer;
  overflow: hidden;
  background: transparent;
  transition: transform 0.2s ease;
  scroll-snap-align: start;
  
  &:active {
    transform: scale(0.98);
  }
  
  @media (min-width: 480px) {
    width: 132px;
  }
`;

export const PlaylistCoverWrapper = styled.div`
  position: relative;
  width: 100%;
  ${portraitCoverBox}
  padding-top: 0;
  overflow: hidden;
  border-radius: 10px;

  @media (min-width: 480px) {
    border-radius: 12px;
  }
`;

export const PlaylistCover = styled.img`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
`;

export const PlaylistCoverPlaceholder = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: linear-gradient(
    135deg,
    rgba(60, 60, 60, 0.8) 0%,
    rgba(30, 30, 30, 0.9) 100%
  );
  display: flex;
  align-items: center;
  justify-content: center;
  
  &::after {
    content: '🎵';
    font-size: 28px;
    opacity: 0.4;
  }
`;

export const PlaylistInfo = styled.div`
  padding: 6px 0 0;
`;

export const PlaylistTitle = styled.h3`
  font-size: 10.5px;
  font-weight: 500;
  font-family: 'Unbounded', sans-serif;
  color: white;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  
  @media (min-width: 480px) {
    font-size: 11px;
  }
`;

// ============================================
// Empty State
// ============================================

export const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 50px 16px;
  color: rgba(255, 255, 255, 0.4);
  text-align: center;
`;

export const EmptyIcon = styled.div`
  font-size: 30px;
  margin-bottom: 14px;
`;

export const EmptyText = styled.p`
  font-size: 11px;
  font-family: 'Unbounded', sans-serif;
`;
