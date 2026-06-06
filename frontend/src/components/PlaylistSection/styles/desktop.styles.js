/**
 * PlaylistSection Desktop Styles
 * Стили только для десктопной версии (768px+)
 */

import styled from "styled-components";
import { motion } from "framer-motion";
import { portraitCoverBox } from "../../../styles/mediaCover";

// ============================================
// Container Styles
// ============================================

export const SectionContainer = styled.section`
  position: relative;
  z-index: 3;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  /* Уменьшен верхний отступ для минимального зазора с плеером */
  padding: ${(p) => {
    if (p.$homeDesktopAlign) return p.$compactTop ? '14px 0 34px' : '20px 0 38px';
    return p.$compactTop ? '14px 0 34px' : '20px 0 38px';
  }};
  background: transparent;

  @media (min-width: 1024px) {
    padding: ${(p) => {
      if (p.$homeDesktopAlign) return p.$compactTop ? '14px 0 34px' : '28px 0 36px';
      return p.$compactTop ? '14px 30px 34px' : '28px 30px 36px';
    }};
  }

  @media (min-width: 1440px) {
    padding: ${(p) => {
      if (p.$homeDesktopAlign) return p.$compactTop ? '16px 0 36px' : '30px 0 38px';
      return p.$compactTop ? '16px 34px 36px' : '30px 34px 38px';
    }};
  }
`;

export const SectionHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;

  @media (min-width: 1024px) {
    margin-bottom: 20px;
  }

  @media (min-width: 1440px) {
    margin-bottom: 22px;
  }
`;

export const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
`;

export const HeaderRight = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

export const SectionTitle = styled.h2`
  font-size: 13.5px;
  font-weight: 600;
  font-family: "Unbounded", sans-serif;
  color: white;
  letter-spacing: -0.02em;
  margin: 0;

  @media (min-width: 1024px) {
    font-size: 14px;
  }

  @media (min-width: 1440px) {
    font-size: 15px;
  }

  @media (min-width: 1920px) {
    font-size: 16px;
  }
`;

// ============================================
// Navigation Arrows
// ============================================

export const NavArrow = styled.button`
  display: flex;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: white;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.2);
    transform: scale(1.05);
  }

  &:active:not(:disabled) {
    transform: scale(0.95);
  }

  &:disabled {
    opacity: 0.3;
    cursor: default;
  }

  @media (min-width: 1024px) {
    width: 40px;
    height: 40px;
  }

  @media (min-width: 1440px) {
    width: 44px;
    height: 44px;
  }

  svg {
    width: 14px;
    height: 14px;

    @media (min-width: 1024px) {
      width: 16px;
      height: 16px;
    }

    @media (min-width: 1440px) {
      width: 18px;
      height: 18px;
    }
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
  gap: 14px;
  padding-bottom: 14px;
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

  @media (min-width: 1024px) {
    gap: 18px;
  }

  @media (min-width: 1280px) {
    gap: 20px;
  }

  @media (min-width: 1440px) {
    gap: 22px;
  }
`;

// ============================================
// Featured Card (Открытия недели) - Desktop
// ============================================

export const FeaturedCard = styled(motion.div)`
  width: 136px;
  flex-shrink: 0;
  position: relative;
  cursor: pointer;
  overflow: hidden;
  background: transparent;
  transition: none;
  scroll-snap-align: start;

  &:hover {
    .playlist-overlay {
      opacity: 1;
    }

    .play-button {
      opacity: 1;
    }
  }

  @media (min-width: 1024px) {
    width: 156px;
  }

  @media (min-width: 1280px) {
    width: 168px;
  }

  @media (min-width: 1440px) {
    width: 180px;
  }

  @media (min-width: 1920px) {
    width: 196px;
  }
`;

export const FeaturedInfo = styled.div`
  padding: 8px 0 0;
  text-align: left;
`;

export const FeaturedTitle = styled.h3`
  font-size: 11px;
  font-weight: 700;
  font-family: "Unbounded", sans-serif;
  color: white;
  margin: 0;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  @media (min-width: 1024px) {
    font-size: 11.5px;
  }

  @media (min-width: 1440px) {
    font-size: 12px;
  }
`;

// ============================================
// Regular Playlist Card - Desktop
// ============================================

export const PlaylistCard = styled(motion.div)`
  width: 136px;
  flex-shrink: 0;
  position: relative;
  cursor: pointer;
  overflow: hidden;
  background: transparent;
  transition: none;
  scroll-snap-align: start;

  &:hover {
    .playlist-overlay {
      opacity: 1;
    }

    .play-button {
      opacity: 1;
    }
  }

  @media (min-width: 1024px) {
    width: 156px;
  }

  @media (min-width: 1280px) {
    width: 168px;
  }

  @media (min-width: 1440px) {
    width: 180px;
  }

  @media (min-width: 1920px) {
    width: 196px;
  }
`;

export const PlaylistCoverWrapper = styled.div`
  position: relative;
  width: 100%;
  ${portraitCoverBox}
  padding-top: 0;
  overflow: hidden;
  border-radius: 12px;

  @media (min-width: 1024px) {
    border-radius: 14px;
  }
`;

export const PlaylistCover = styled.img`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.4s ease;
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
    content: "🎵";
    font-size: 32px;
    opacity: 0.4;
  }
`;

export const PlaylistOverlay = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: linear-gradient(180deg, transparent 40%, rgba(0, 0, 0, 0.8) 100%);
  opacity: 0;
  transition: opacity 0.3s ease;
  pointer-events: none;
`;

export const PlayButton = styled(motion.button)`
  position: absolute;
  bottom: 8px;
  right: 8px;
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 50%;
  border: none;
  background: white;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.18s ease, background 0.18s ease;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  cursor: pointer;
  pointer-events: auto;
  z-index: 2;

  svg {
    width: 13px;
    height: 13px;
    fill: black;
    transform: translateX(1px);
  }

  @media (min-width: 1440px) {
    width: 34px;
    height: 34px;
    bottom: 10px;
    right: 10px;

    svg {
      width: 14px;
      height: 14px;
    }
  }
`;

export const PlaylistInfo = styled.div`
  padding: 8px 0 0;
`;

export const PlaylistTitle = styled.h3`
  font-size: 12px;
  font-weight: 500;
  font-family: "Unbounded", sans-serif;
  color: white;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  @media (min-width: 1024px) {
    font-size: 12.5px;
  }

  @media (min-width: 1440px) {
    font-size: 13px;
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
  padding: 80px 20px;
  color: rgba(255, 255, 255, 0.4);
  text-align: center;
`;

export const EmptyIcon = styled.div`
  font-size: 34px;
  margin-bottom: 20px;
`;

export const EmptyText = styled.p`
  font-size: 12px;
  font-family: "Unbounded", sans-serif;
`;
