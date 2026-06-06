import styled, { keyframes } from 'styled-components';
import { motion } from 'framer-motion';
import { desktopPanelPlacement, panelSurfaceFrame } from '../panels/panelSurface.styles';

export const PanelShell = styled(motion.aside)`
  position: fixed;
  right: ${(p) => p.$offset || '20px'};
  ${desktopPanelPlacement}
  ${panelSurfaceFrame}
  z-index: 95;
  overflow: hidden;
  padding: 0;
  transition: right 0.3s ease;
  display: flex;
  flex-direction: column;

  @media (min-width: 1024px) {
    width: var(--panel-rail-width, clamp(380px, 29vw, 430px));
  }
`;

export const MobileShell = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  padding: 20px 18px 18px;
`;

export const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
  padding: 0 2px;
  touch-action: none;
`;

export const HeaderTitleBlock = styled.div`
  min-width: 0;
  flex: 1;
`;

export const NowPlayingEyebrow = styled.div`
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.45);
  margin-bottom: 4px;
`;

export const NowPlayingTitle = styled.h3`
  margin: 0;
  color: #fff;
  font-family: 'Unbounded', sans-serif;
  font-weight: 600;
  font-size: 18px;
  letter-spacing: -0.01em;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  @media (min-width: 1024px) {
    font-size: 19px;
  }
`;

export const CloseIconButton = styled.button`
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s ease, transform 0.15s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.16);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.75);
    outline-offset: 2px;
  }
`;

export const Tabs = styled.div`
  display: flex;
  gap: 4px;
  padding: 4px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 999px;
  margin: 14px 0 14px;
  touch-action: none;
`;

export const Tab = styled.button`
  flex: 1;
  min-height: 34px;
  border: none;
  border-radius: 999px;
  background: ${(p) => (p.$active ? '#fff' : 'transparent')};
  color: ${(p) => (p.$active ? '#000' : 'rgba(255, 255, 255, 0.78)')};
  font-family: 'Unbounded', sans-serif;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease;
  -webkit-tap-highlight-color: transparent;

  &:hover {
    background: ${(p) => (p.$active ? '#fff' : 'rgba(255, 255, 255, 0.08)')};
    color: ${(p) => (p.$active ? '#000' : '#fff')};
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.75);
    outline-offset: 2px;
  }
`;

export const MetaLine = styled.div`
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.4);
  letter-spacing: 0.04em;
  margin: 2px 2px 10px;
  touch-action: none;
`;

export const ScrollArea = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  margin: 0 -6px;
  padding: 2px 6px 6px;
  scrollbar-width: none;
  -ms-overflow-style: none;
  overscroll-behavior: contain;
  touch-action: pan-y;
  -webkit-overflow-scrolling: touch;

  &::-webkit-scrollbar {
    width: 0;
    height: 0;
  }
`;

export const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

export const Row = styled(motion.button)`
  display: grid;
  grid-template-columns: 24px 46px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 14px;
  background: ${(p) => (p.$active ? 'rgba(255, 255, 255, 0.1)' : 'transparent')};
  color: #fff;
  cursor: pointer;
  text-align: left;
  font: inherit;
  transition: background 0.15s ease, border-color 0.15s ease;
  -webkit-tap-highlight-color: transparent;

  &:hover {
    background: rgba(255, 255, 255, 0.07);
  }

  &:focus-visible {
    outline: none;
    border-color: rgba(255, 255, 255, 0.35);
    background: rgba(255, 255, 255, 0.08);
  }

  @media (max-width: 520px) {
    grid-template-columns: 20px 44px minmax(0, 1fr) auto;
    gap: 10px;
    padding: 7px 8px;
  }
`;

export const IndexCell = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.4);
  font-variant-numeric: tabular-nums;
`;

export const Cover = styled.div`
  position: relative;
  width: 46px;
  height: 58px;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.08);
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.35);

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  @media (max-width: 520px) {
    width: 44px;
    height: 55px;
  }
`;

export const Info = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

export const TrackName = styled.span`
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const ArtistName = styled.span`
  font-size: 12px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.55);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const barsKF = keyframes`
  0% { transform: scaleY(0.35); opacity: 0.55; }
  50% { transform: scaleY(1); opacity: 1; }
  100% { transform: scaleY(0.35); opacity: 0.55; }
`;

export const PlayingBars = styled.span`
  display: inline-flex;
  align-items: flex-end;
  justify-content: center;
  gap: 2px;
  width: 14px;
  height: 14px;

  span {
    width: 3px;
    height: 100%;
    background: #fff;
    border-radius: 2px;
    transform-origin: bottom;
    animation: ${barsKF} 0.9s ease-in-out infinite;
  }
  span:nth-child(2) { animation-delay: 0.14s; }
  span:nth-child(3) { animation-delay: 0.28s; }
`;

export const TrailingCell = styled.div`
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 24px;
  color: rgba(255, 255, 255, 0.5);
`;

export const Empty = styled.div`
  padding: 26px 8px;
  color: rgba(255, 255, 255, 0.45);
  text-align: center;
  font-size: 13px;
  font-weight: 500;
`;

export const FooterBar = styled.div`
  display: flex;
  justify-content: flex-end;
  padding: 8px 2px 0;
`;

export const FooterButton = styled.button`
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: transparent;
  color: rgba(255, 255, 255, 0.75);
  font-family: 'Unbounded', sans-serif;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 7px 14px;
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.06);
    color: #fff;
    border-color: rgba(255, 255, 255, 0.24);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.75);
    outline-offset: 2px;
  }
`;
