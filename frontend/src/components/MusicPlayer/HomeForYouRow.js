import React, { useRef, useCallback } from 'react';
import styled from 'styled-components';
import { FaPlay, FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import apiClient from '../../api/client';
import { usePlayerDispatch } from '../../context/PlayerContext';
import { COVER_ASPECT_RATIO } from '../../styles/mediaCover';
import useRailWheelScroll from '../../hooks/useRailWheelScroll';
import { HomeRailSection, HomeSectionTitle } from './HomeDesktopShell.styles';

const CARD_WIDTHS = {
  base: 136,
  lg: 156,
  xl: 168,
  xxl: 180,
  ultra: 196,
};

const SectionHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  width: 100%;
`;

const NavButtons = styled.div`
  display: flex;
  gap: 8px;
  flex-shrink: 0;
`;

const NavBtn = styled.button`
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;

  &:disabled {
    opacity: 0.35;
    cursor: default;
  }
`;

const Scroller = styled.div`
  display: flex;
  gap: 14px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  padding-bottom: 4px;
  scrollbar-width: none;
  touch-action: pan-x pan-y;
  overscroll-behavior-x: contain;
  overscroll-behavior-y: auto;
  width: 100%;

  &::-webkit-scrollbar {
    display: none;
  }

  @media (min-width: 1024px) {
    gap: 18px;
  }
`;

const Card = styled.button`
  flex: 0 0 ${CARD_WIDTHS.base}px;
  width: ${CARD_WIDTHS.base}px;
  scroll-snap-align: start;
  border: none;
  padding: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;

  @media (min-width: 1024px) {
    flex-basis: ${CARD_WIDTHS.lg}px;
    width: ${CARD_WIDTHS.lg}px;
  }

  @media (min-width: 1280px) {
    flex-basis: ${CARD_WIDTHS.xl}px;
    width: ${CARD_WIDTHS.xl}px;
  }

  @media (min-width: 1440px) {
    flex-basis: ${CARD_WIDTHS.xxl}px;
    width: ${CARD_WIDTHS.xxl}px;
  }

  @media (min-width: 1920px) {
    flex-basis: ${CARD_WIDTHS.ultra}px;
    width: ${CARD_WIDTHS.ultra}px;
  }
`;

const CoverWrap = styled.div`
  position: relative;
  width: 100%;
  aspect-ratio: ${COVER_ASPECT_RATIO};
  height: auto;
  flex-shrink: 0;
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 10px;
  background: rgba(255, 255, 255, 0.06);
`;

const CoverImg = styled.img`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
`;

const PlayOverlay = styled.span`
  position: absolute;
  right: 8px;
  bottom: 8px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.94);
  color: #111;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transform: scale(0.92);
  transition: opacity 0.15s ease, transform 0.15s ease;
  pointer-events: none;

  ${Card}:hover &,
  ${Card}:focus-visible & {
    opacity: 1;
    transform: scale(1);
  }
`;

const CardTitle = styled.div`
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const CardArtist = styled.div`
  color: rgba(255, 255, 255, 0.55);
  font-size: 11px;
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

function pickForYouTracks(tracks, currentTrackIndex, limit = 12) {
  const list = Array.isArray(tracks) ? tracks : [];
  if (!list.length) return [];
  if (list.length === 1) return [list[0]];
  const idx = Math.max(0, Math.min(list.length - 1, Number(currentTrackIndex) || 0));
  const out = [];
  for (let i = 1; i <= limit && out.length < limit; i += 1) {
    const t = list[(idx + i) % list.length];
    if (t) out.push(t);
  }
  return out;
}

export default function HomeForYouRow({ tracks, currentTrackIndex, title = 'Слушайте дальше' }) {
  const scrollerRef = useRef(null);
  const { handleTrackSelect } = usePlayerDispatch();
  const items = pickForYouTracks(tracks, currentTrackIndex);

  useRailWheelScroll(scrollerRef);

  const scrollBy = useCallback((dir) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * 340, behavior: 'smooth' });
  }, []);

  if (!items.length) return null;

  return (
    <HomeRailSection data-testid="home-for-you-row">
      <SectionHead>
        <HomeSectionTitle as="h3">{title}</HomeSectionTitle>
        <NavButtons>
          <NavBtn type="button" aria-label="Назад" onClick={() => scrollBy(-1)}>
            <FaChevronLeft size={12} />
          </NavBtn>
          <NavBtn type="button" aria-label="Вперёд" onClick={() => scrollBy(1)}>
            <FaChevronRight size={12} />
          </NavBtn>
        </NavButtons>
      </SectionHead>
      <Scroller ref={scrollerRef}>
        {items.map((track) => {
          const id = track?.id ?? track?.song_id;
          const cover = apiClient.getCoverUrl(track);
          return (
            <Card
              key={String(id)}
              type="button"
              onClick={() => {
                void handleTrackSelect(track);
              }}
            >
              <CoverWrap>
                {cover ? <CoverImg src={cover} alt="" loading="lazy" decoding="async" /> : null}
                <PlayOverlay aria-hidden="true">
                  <FaPlay size={11} style={{ marginLeft: 2 }} />
                </PlayOverlay>
              </CoverWrap>
              <CardTitle>{track?.title || 'Без названия'}</CardTitle>
              <CardArtist>{track?.artist || ''}</CardArtist>
            </Card>
          );
        })}
      </Scroller>
    </HomeRailSection>
  );
}
