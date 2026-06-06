import styled, { keyframes } from 'styled-components';
import { HOME_HERO_CARD_BG } from '../../styles/homeSurface';

const barPulse = keyframes`
  0%, 100% { transform: scaleY(0.4); opacity: 0.4; }
  50% { transform: scaleY(1); opacity: 0.95; }
`;

export const HeroSection = styled.section`
  position: relative;
  width: 100%;
  margin: 0 0 26px;
  padding: 22px 24px;
  border-radius: 20px;
  overflow: hidden;
  background: ${HOME_HERO_CARD_BG};
  border: 1px solid rgba(255, 255, 255, 0.08);
`;

export const HeroInner = styled.div`
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr) 72px;
  gap: 24px;
  align-items: center;

  @media (min-width: 1100px) {
    grid-template-columns: 220px minmax(0, 1fr) 80px;
    gap: 28px;
    padding-right: 4px;
  }
`;

export const DayLabel = styled.span`
  display: block;
  margin-bottom: 10px;
  font-family: 'Unbounded', sans-serif;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.45);
`;

export const CoverFrame = styled.div`
  position: relative;
  width: 200px;
  aspect-ratio: 4 / 5;
  height: auto;
  flex-shrink: 0;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  cursor: ${(p) => (p.$clickable ? 'pointer' : p.$swipeable ? 'grab' : 'default')};
  user-select: none;
  will-change: transform;

  @media (min-width: 1100px) {
    width: 220px;
    border-radius: 16px;
  }

  &:active {
    cursor: ${(p) => (p.$swipeable ? 'grabbing' : p.$clickable ? 'pointer' : 'default')};
  }
`;

export const CoverImage = styled.img.attrs({ loading: 'eager', decoding: 'async', fetchPriority: 'high' })`
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
`;

export const CoverPlaceholder = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1a1a1a;
  color: rgba(255, 255, 255, 0.25);
  font-size: 2.5rem;
`;

export const MetaColumn = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

export const HeroTitle = styled.h2`
  margin: 0;
  color: #fff;
  font-family: 'Unbounded', sans-serif;
  font-size: clamp(1.5rem, 2.4vw, 2.35rem);
  font-weight: 600;
  text-transform: uppercase;
  line-height: 1.08;
  letter-spacing: -0.02em;
`;

export const HeroArtist = styled.p`
  margin: 0;
  color: rgba(255, 255, 255, 0.62);
  font-family: 'Unbounded', sans-serif;
  font-size: 0.8rem;
  font-weight: 300;
  text-transform: uppercase;
`;

export const TagRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 2px;
`;

export const Tag = styled.span`
  padding: 5px 10px;
  border-radius: 999px;
  font-size: 10px;
  font-family: 'Unbounded', sans-serif;
  color: rgba(255, 255, 255, 0.78);
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.06);
`;

export const WaveformRow = styled.div`
  position: relative;
  display: grid;
  grid-template-columns: repeat(var(--wave-bars, 128), minmax(0, 1fr));
  align-items: end;
  gap: 1px;
  width: 100%;
  max-width: ${(p) => (p.$fullWidth ? '100%' : '520px')};
  height: 40px;
  margin-top: 6px;
  box-sizing: border-box;
  opacity: ${(p) => (p.$active ? 1 : 0.72)};
  cursor: pointer;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;

  &::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: var(--wave-progress, 0%);
    width: 2px;
    margin-left: -1px;
    background: rgba(255, 255, 255, 0.95);
    border-radius: 1px;
    pointer-events: none;
    opacity: ${(p) => (p.$scrubbing ? 1 : 0)};
    transition: ${(p) => (p.$scrubbing ? 'none' : 'opacity 0.12s ease')};
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.35);
    outline-offset: 4px;
    border-radius: 6px;
  }
`;

export const WaveBar = styled.span`
  width: 100%;
  min-width: 0;
  height: ${(p) => p.$h}%;
  align-self: end;
  border-radius: 999px;
  background: ${(p) => (p.$past ? 'rgba(255, 255, 255, 0.92)' : 'rgba(255, 255, 255, 0.28)')};
  transform-origin: center bottom;
  animation: ${(p) => (p.$animate ? barPulse : 'none')} ${(p) => p.$dur || '1s'} ease-in-out infinite;
  animation-delay: ${(p) => p.$delay || '0ms'};
  transition: ${(p) => (p.$scrubbing ? 'none' : 'background 0.12s ease, height 0.15s ease')};
  pointer-events: none;
`;

export const PlayColumn = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
`;

export const PlayButton = styled.button`
  width: 64px;
  height: 64px;
  border: none;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #0c0c0c;
  background: #fff;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
  flex-shrink: 0;
  transition: transform 0.15s ease;

  &:hover {
    transform: scale(1.05);
  }

  svg {
    width: 24px;
    height: 24px;
  }

  @media (min-width: 1100px) {
    width: 72px;
    height: 72px;
  }
`;
