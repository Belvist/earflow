import React, { useMemo, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { FaPlay, FaPause } from 'react-icons/fa';
import apiClient from '../../api/client';
import { usePlayer } from '../../context/PlayerContext';
import CachedCoverImage from '../CachedCoverImage';

const Section = styled.section`
  max-width: 980px;
  margin: 0 auto;
  padding: 14px 10px 0;
  font-family: 'Unbounded', sans-serif;

  @media (min-width: 521px) {
    padding: 32px 16px 0;
  }
`;

const HeaderRow = styled.div`
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
`;

const Title = styled.h2`
  margin: 0;
  font-size: 13px;
  font-weight: 900;
  letter-spacing: -0.02em;
  color: #fff;

  @media (min-width: 521px) {
    font-size: 22px;
  }
`;

const SeeAll = styled.button`
  background: transparent;
  border: none;
  padding: 6px 10px;
  margin: -6px -10px;
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.65);
  font-family: 'Unbounded', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;
  -webkit-tap-highlight-color: transparent;

  &:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.05);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.85);
    outline-offset: 2px;
  }
`;

const Toggle = styled.button`
  margin-top: 14px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 999px;
  padding: 8px 16px;
  color: rgba(255, 255, 255, 0.75);
  font-family: 'Unbounded', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  -webkit-tap-highlight-color: transparent;

  &:hover {
    background: rgba(255, 255, 255, 0.06);
    color: #fff;
    border-color: rgba(255, 255, 255, 0.26);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.85);
    outline-offset: 2px;
  }
`;

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const Row = styled.div`
  display: grid;
  grid-template-columns: 28px 48px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 14px;
  padding: 8px 10px;
  border-radius: 10px;
  color: #fff;
  cursor: pointer;
  transition: background 0.15s ease;
  background: ${(p) => (p.$active ? 'rgba(255,255,255,0.08)' : 'transparent')};
  -webkit-tap-highlight-color: transparent;

  &:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.85);
    outline-offset: 2px;
  }

  @media (max-width: 520px) {
    grid-template-columns: 18px 38px minmax(0, 1fr) auto;
    gap: 8px;
    padding: 4px 6px;
  }
`;

const IndexCell = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.4);
  font-variant-numeric: tabular-nums;

  @media (max-width: 520px) {
    font-size: 10px;
  }

  ${Row}:hover & {
    color: transparent;
  }
`;

const PlayOverlay = styled.span`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  border-radius: inherit;
  color: #fff;
  opacity: ${(p) => (p.$force ? 1 : 0)};
  transition: opacity 0.12s ease;
  pointer-events: none;

  ${Row}:hover & {
    opacity: 1;
  }
`;

const CoverCell = styled.div`
  position: relative;
  width: 48px;
  height: 60px;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.05);

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  @media (max-width: 520px) {
    width: 36px;
    height: 45px;
    border-radius: 6px;
  }
`;

const bars = keyframes`
  0% { transform: scaleY(0.35); opacity: 0.55; }
  50% { transform: scaleY(1); opacity: 1; }
  100% { transform: scaleY(0.35); opacity: 0.55; }
`;

const PlayingBars = styled.div`
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 3px;
  width: 14px;
  height: 14px;

  span {
    width: 3px;
    height: 100%;
    background: #fff;
    border-radius: 2px;
    transform-origin: bottom;
    animation: ${bars} 0.85s ease-in-out infinite;
  }
  span:nth-child(2) { animation-delay: 0.12s; }
  span:nth-child(3) { animation-delay: 0.24s; }
`;

const TitleCol = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const TrackTitle = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  @media (max-width: 520px) {
    font-size: 12px;
  }
`;

const TrackSubtitle = styled.div`
  font-size: 12px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.55);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  @media (max-width: 520px) {
    font-size: 10px;
  }
`;

const Plays = styled.div`
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.5);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;

  @media (max-width: 520px) {
    display: none;
  }
`;

const Duration = styled.div`
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.5);
  font-variant-numeric: tabular-nums;

  @media (max-width: 520px) {
    font-size: 10px;
  }
`;

const DEFAULT_VISIBLE = 5;
const EXPANDED_VISIBLE = 10;

function formatCompactNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  try {
    return new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  } catch {
    return String(Math.round(n));
  }
}

function formatDuration(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return '';
  const total = Math.round(n);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function getPlayCount(track) {
  const v = track && (track.play_count ?? track.playCount);
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function getDurationSeconds(track) {
  if (!track) return 0;
  const ds = Number(track.duration_seconds ?? track.durationSeconds);
  if (Number.isFinite(ds) && ds > 0) return ds;
  const raw = track.duration;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === 'string') {
    const parts = raw.split(':').map((x) => Number.parseInt(x, 10));
    if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) {
      return parts[0] * 60 + parts[1];
    }
    if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
  }
  return 0;
}

export default function ArtistPopularSection({ tracks, onSeeAll, onPlayTrack }) {
  const [expanded, setExpanded] = useState(false);
  const player = usePlayer();

  const visibleCount = expanded ? EXPANDED_VISIBLE : DEFAULT_VISIBLE;
  const visibleTracks = useMemo(() => {
    const arr = Array.isArray(tracks) ? tracks : [];
    return arr.slice(0, visibleCount);
  }, [tracks, visibleCount]);

  const totalAvailable = Array.isArray(tracks) ? tracks.length : 0;
  const canShowMore = totalAvailable > DEFAULT_VISIBLE;

  const currentTrackId = player?.currentTrack?.id;
  const isPlaying = !!player?.isPlaying;

  if (visibleTracks.length === 0) return null;

  return (
    <Section>
      <HeaderRow>
        <Title>Популярное</Title>
        {typeof onSeeAll === 'function' && (
          <SeeAll type="button" onClick={onSeeAll}>
            Все треки
          </SeeAll>
        )}
      </HeaderRow>

      <List role="list">
        {visibleTracks.map((track, idx) => {
          const id = track?.id;
          const active = id != null && String(id) === String(currentTrackId);
          const cover = apiClient.getCoverUrl(track);
          const plays = getPlayCount(track);
          const duration = getDurationSeconds(track);
          const title = (track && typeof track.title === 'string') ? track.title : 'Без названия';
          const album = (track && typeof track.album === 'string') ? track.album.trim() : '';

          return (
            <Row
              key={`pop:${id ?? idx}`}
              $active={active}
              role="button"
              tabIndex={0}
              aria-label={album ? `Играть ${title} — ${album}` : `Играть ${title}`}
              aria-current={active ? 'true' : undefined}
              onClick={() => onPlayTrack?.(id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onPlayTrack?.(id);
                }
              }}
            >
              <IndexCell>
                {active && isPlaying ? (
                  <PlayingBars aria-label="Сейчас играет">
                    <span />
                    <span />
                    <span />
                  </PlayingBars>
                ) : (
                  idx + 1
                )}
              </IndexCell>

              <CoverCell>
                {cover
                  ? <CachedCoverImage src={cover} alt="" />
                  : <div aria-hidden="true" />}
                <PlayOverlay $force={active} aria-hidden="true">
                  {active && isPlaying ? <FaPause size={14} /> : <FaPlay size={12} />}
                </PlayOverlay>
              </CoverCell>

              <TitleCol>
                <TrackTitle title={title}>{title}</TrackTitle>
                {album && <TrackSubtitle title={album}>{album}</TrackSubtitle>}
              </TitleCol>

              <Plays>{plays > 0 ? formatCompactNumber(plays) : ''}</Plays>
              <Duration>{formatDuration(duration)}</Duration>
            </Row>
          );
        })}
      </List>

      {canShowMore && (
        <Toggle type="button" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Свернуть' : 'Показать больше'}
        </Toggle>
      )}
    </Section>
  );
}
