import styled from 'styled-components';
import { COVER_ASPECT_RATIO } from '../../styles/mediaCover';

export { TagRow, Tag } from './HomeDesktopHeroV3.styles';

/** Mobile hero: 4:5, full row width — edges align with tabs / «Для вас» list */
export const HeroSection = styled.section`
  position: relative;
  width: 100%;
  max-width: 100%;
  aspect-ratio: ${COVER_ASPECT_RATIO};
  height: auto;
  border-radius: 18px;
  overflow: hidden;
  margin-bottom: 22px;
  background: rgb(20, 20, 20);
  border: 1px solid rgba(255, 255, 255, 0.08);
`;

export const BgTransform = styled.div`
  position: absolute;
  inset: 0;
  will-change: transform;
  transform: translate3d(0, 0, 0);
  pointer-events: none;
`;

export const BgCover = styled.img`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
  transform: translate3d(0, 0, 0);
  will-change: transform;
`;

export const BgPlaceholder = styled.div`
  position: absolute;
  inset: 0;
  background: linear-gradient(145deg, rgb(32, 32, 32), rgb(14, 14, 14));
  pointer-events: none;
`;

export const BgDim = styled.div`
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    rgba(0, 0, 0, 0.35) 0%,
    rgba(0, 0, 0, 0.55) 45%,
    rgba(0, 0, 0, 0.88) 100%
  );
  pointer-events: none;
`;

/** Swipe cover stack — excludes waveform strip at bottom */
export const SwipeSurface = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 46px;
  z-index: 2;
  touch-action: pan-y;
  cursor: ${(p) => (p.$swipeable ? 'grab' : 'default')};

  &:active {
    cursor: ${(p) => (p.$swipeable ? 'grabbing' : 'default')};
  }
`;

export const Content = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 46px;
  z-index: 3;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 16px 16px 10px;
  pointer-events: none;
`;

export const MetaRow = styled.div`
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  pointer-events: none;
`;

export const TextBlock = styled.div`
  flex: 1;
  min-width: 0;
  pointer-events: auto;
`;

export const HeroTitleLink = styled.button`
  width: 100%;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  text-align: left;
  font-family: 'Unbounded', sans-serif;
  font-size: clamp(15px, 4.2vw, 18px);
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: #fff;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;

  &:hover {
    color: rgba(255, 255, 255, 0.92);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.35);
    outline-offset: 2px;
    border-radius: 6px;
  }
`;

export const HeroArtistWrap = styled.div`
  margin: 6px 0 0;
  font-family: 'Unbounded', sans-serif;
  font-size: 11px;
  font-weight: 400;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.62);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const HeroTagsWrap = styled.div`
  margin-top: 8px;
  pointer-events: none;
`;

export const PlayButton = styled.button`
  flex-shrink: 0;
  width: 56px;
  height: 56px;
  border: none;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #0a0a0a;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  pointer-events: auto;

  &:active {
    transform: scale(0.96);
  }
`;

export const WaveformWrap = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 4;
  padding: 0 12px 12px;
  pointer-events: auto;
`;
