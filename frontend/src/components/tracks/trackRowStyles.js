import styled, { css, keyframes } from 'styled-components';

// Единый визуальный стандарт трек-ряда (альбом / плейлист / профиль).
// Страницы оборачивают в свой элемент (button / Reorder.Item / div),
// применяя общий css `${trackRowStyles}`.

export const trackRowStyles = css`
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  padding: 7px 8px;
  margin: 0;
  border: none;
  border-radius: 10px;
  font-family: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  width: 100%;
  text-align: left;
  color: #fff;
  transition: background 0.2s;
  background: ${(p) => (p.$active ? 'rgba(255,255,255,0.09)' : 'transparent')};

  &:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  &:active {
    background: rgba(255, 255, 255, 0.1);
  }

  @media (min-width: 641px) {
    gap: 14px;
    min-height: 56px;
    padding: 8px 12px;
  }
`;

export const TrackRowNumber = styled.div`
  flex-shrink: 0;
  width: 20px;
  text-align: center;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);

  @media (min-width: 641px) {
    width: 24px;
    font-size: 13px;
  }
`;

export const TrackRowIndicator = styled.div`
  flex-shrink: 0;
  width: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.9);

  @media (min-width: 641px) {
    width: 24px;
  }
`;

const trackRowBars = keyframes`
  0% { transform: scaleY(0.35); opacity: 0.55; }
  50% { transform: scaleY(1); opacity: 1; }
  100% { transform: scaleY(0.35); opacity: 0.55; }
`;

export const TrackRowPlayingBars = styled.div`
  width: 16px;
  height: 14px;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 2px;

  span {
    width: 3px;
    height: 100%;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.92);
    transform-origin: bottom;
    animation: ${trackRowBars} 0.85s ease-in-out infinite;
  }

  span:nth-child(2) {
    animation-delay: 0.12s;
  }

  span:nth-child(3) {
    animation-delay: 0.24s;
  }
`;

export const TrackRowCover = styled.div`
  flex-shrink: 0;
  width: 40px;
  height: 50px;
  border-radius: 6px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.06);

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  @media (min-width: 641px) {
    width: 48px;
    height: 60px;
    border-radius: 8px;
  }
`;

export const TrackRowInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

export const TrackRowTitle = styled.div`
  font-size: 12px;
  font-weight: 500;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  @media (min-width: 641px) {
    font-size: 14px;
  }
`;

export const TrackRowSubtitle = styled.div`
  margin-top: 2px;
  font-size: 10px;
  font-weight: 300;
  color: rgba(255, 255, 255, 0.5);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  @media (min-width: 641px) {
    font-size: 11px;
  }
`;

export const TrackRowDuration = styled.div`
  flex-shrink: 0;
  margin-left: 8px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);

  @media (min-width: 641px) {
    margin-left: 12px;
    font-size: 12px;
  }
`;

export const TrackRowActionButton = styled.button`
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  min-width: 34px;
  margin-left: 8px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.03);
  border: none;
  color: ${(p) => (p.$kind === 'liked' ? '#fff' : 'rgba(255,255,255,0.72)')};
  font-size: 14px;
  padding: 0;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    background 0.15s ease,
    transform 0.15s ease,
    color 0.15s ease;
  -webkit-tap-highlight-color: transparent;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  &:active {
    transform: scale(0.94);
  }
`;

export const formatTrackDuration = (s) => {
  const total = Number(s);
  if (!Number.isFinite(total) || total <= 0) return '0:00';
  const m = Math.floor(total / 60);
  const sec = Math.floor(total % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};
