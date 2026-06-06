import React, { useMemo } from 'react';
import styled, { keyframes } from 'styled-components';
import { FaPlay, FaChevronLeft } from 'react-icons/fa';
import apiClient from '../api/client';
import { usePlayer } from '../context/PlayerContext';
import CachedCoverImage from './CachedCoverImage';

const Section = styled.section`
  padding: 22px 16px 0;
  max-width: 980px;
  margin: 0 auto;
`;

const HeaderRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 16px;
`;

const TitleWrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const ArtistBadge = styled.div`
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.4);
  letter-spacing: 0.05em;
`;

const Title = styled.div`
  font-size: ${p => p.$large ? '24px' : '12px'};
  font-weight: 900;
  letter-spacing: 0.02em;
  color: rgba(255, 255, 255, 0.88);
  text-transform: uppercase;
`;

const Filters = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const Select = styled.select`
  height: 36px;
  padding: 0 12px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.92);
  font-family: 'Unbounded', sans-serif;
  font-size: 12px;
  outline: none;
`;

const Tracks = styled.div`
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const Indicator = styled.div`
  width: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  @media (min-width: 768px) {
    width: 24px;
  }
`;

const bars = keyframes`
  0% { transform: scaleY(0.35); opacity: 0.55; }
  50% { transform: scaleY(1); opacity: 1; }
  100% { transform: scaleY(0.35); opacity: 0.55; }
`;

const PlayingBars = styled.div`
  width: 18px;
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
    animation: ${bars} 0.85s ease-in-out infinite;
  }

  span:nth-child(2) { animation-delay: 0.12s; }
  span:nth-child(3) { animation-delay: 0.24s; }
`;

const TrackRow = styled.button`
  width: 100%;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  margin: 0 -8px;
  border-radius: 10px;
  border: none;
  font-family: 'Unbounded', sans-serif;
  background: ${p => p.$active ? 'rgba(255,255,255,0.08)' : 'transparent'};
  color: #fff;
  cursor: pointer;
  transition: background 0.15s ease;
  -webkit-tap-highlight-color: transparent;

  &:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  &:active {
    background: rgba(255, 255, 255, 0.1);
  }

  @media (min-width: 768px) {
    gap: 12px;
    padding: 10px;
    margin: 0 -10px;
  }
`;

const TrackNum = styled.div`
  width: 18px;
  text-align: center;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
  flex-shrink: 0;

  @media (min-width: 768px) {
    width: 24px;
    font-size: 12px;
  }
`;

const TrackCover = styled.div`
  width: 40px;
  height: 50px;
  border-radius: 5px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.05);
  flex-shrink: 0;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  @media (min-width: 768px) {
    width: 48px;
    height: 60px;
    border-radius: 6px;
  }
`;

const TrackInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const TrackTitle = styled.div`
  font-size: 12px;
  font-weight: 400;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #fff;

  @media (min-width: 768px) {
    font-size: 13px;
  }
`;

const TrackMeta = styled.div`
  margin-top: 2px;
  font-size: 11px;
  font-weight: 300;
  color: rgba(255, 255, 255, 0.45);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const TrackBadge = styled.div`
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  color: rgba(255, 255, 255, 0.4);
`;

const ShowAllButton = styled.button`
  width: 100%;
  margin-top: 16px;
  padding: 14px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  color: rgba(255, 255, 255, 0.8);
  font-family: 'Unbounded', sans-serif;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.2);
    color: #fff;
  }
`;

const Empty = styled.div`
  padding: 18px 0;
  color: rgba(255, 255, 255, 0.65);
`;

const BackButton = styled.button`
  background: none;
  border: none;
  color: #fff;
  font-size: 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  margin-right: 12px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.05);
  transition: all 0.2s;

  &:hover {
    background: rgba(255, 255, 255, 0.1);
  }
`;

function safeText(v) {
  return (v ?? '').toString().trim();
}

function getYearValue(t) {
  const y = t && (t.year ?? t.release_year ?? t.releaseYear);
  const n = parseInt(String(y ?? ''), 10);
  return Number.isFinite(n) ? n : null;
}

export default function ArtistTracksSection({
  tracks,
  artistName,
  sort,
  year,
  years,
  onSortChange,
  onYearChange,
  onPlayTrack,
  showAll,
  onToggleShowAll
}) {
  const player = usePlayer();
  const view = Array.isArray(tracks) ? tracks : [];

  const yearOptions = useMemo(() => {
    const items = Array.isArray(years) ? years : [];
    const cleaned = items.filter((y) => Number.isFinite(Number(y))).map((y) => Number(y));
    cleaned.sort((a, b) => b - a);
    return cleaned;
  }, [years]);

  const isLimited = !showAll;
  const limitedView = isLimited ? view.slice(0, 6) : view;

  return (
    <Section>
      <HeaderRow>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {showAll && (
            <BackButton onClick={() => onToggleShowAll()}>
              <FaChevronLeft size={16} />
            </BackButton>
          )}
          <TitleWrapper>
            {showAll && <ArtistBadge>{artistName}</ArtistBadge>}
            <Title $large={showAll}>
              {showAll ? 'Все треки' : 'Популярные треки'}
            </Title>
          </TitleWrapper>
        </div>
        {!showAll && (
          <Filters>
            <Select value={sort} onChange={(e) => onSortChange(e.target.value)} aria-label="Сортировка">
              <option value="popular">Популярные</option>
              <option value="new">Новые</option>
            </Select>
            <Select
              value={year ? String(year) : ''}
              onChange={(e) => onYearChange(e.target.value ? parseInt(e.target.value, 10) : null)}
              aria-label="Год"
            >
              <option value="">Все годы</option>
              {yearOptions.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </Select>
          </Filters>
        )}
      </HeaderRow>

      {view.length === 0 ? (
        <Empty>Треков нет</Empty>
      ) : (
        <Tracks>
          {limitedView.map((t, index) => {
            const isActive = String(player.currentTrack?.id ?? '') === String(t?.id ?? '');
            const isPlaying = isActive && !!player.isPlaying;
            return (
              <TrackRow key={t.id} onClick={() => onPlayTrack(t.id)} $active={isActive}>
                {isActive ? (
                  <Indicator>
                    {isPlaying ? (
                      <PlayingBars aria-label="Играет">
                        <span />
                        <span />
                        <span />
                      </PlayingBars>
                    ) : (
                      <FaPlay size={10} aria-label="Выбрано" />
                    )}
                  </Indicator>
                ) : (
                  <TrackNum>{index + 1}</TrackNum>
                )}
                <TrackCover>
                  <CachedCoverImage src={apiClient.getCoverUrl(t)} alt="" />
                </TrackCover>
                <TrackInfo>
                  <TrackTitle title={safeText(t.title)}>{safeText(t.title) || 'Без названия'}</TrackTitle>
                  <TrackMeta title={safeText(t.album)}>
                    {safeText(t.album) || artistName}
                    {getYearValue(t) ? ` • ${getYearValue(t)}` : ''}
                  </TrackMeta>
                </TrackInfo>
                <TrackBadge>
                  {!isActive && <FaPlay size={10} />}
                </TrackBadge>
              </TrackRow>
            );
          })}

          {isLimited && view.length > 6 && (
            <ShowAllButton onClick={() => onToggleShowAll()}>
              Показать все {view.length} треков
            </ShowAllButton>
          )}
        </Tracks>
      )}
    </Section>
  );
}
