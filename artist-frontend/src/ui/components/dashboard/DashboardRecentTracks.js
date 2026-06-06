import React, { useMemo } from 'react';
import styled, { keyframes } from 'styled-components';
import { FaArrowRight, FaPlay, FaCircleNotch } from 'react-icons/fa';

import { safeText, formatCompactNumber, formatDateShort, coverUrlFromPath } from './formatters';

function normalize(track) {
  if (!track || typeof track !== 'object') return null;
  return {
    id: safeText(track.id),
    title: safeText(track.title),
    coverPath: safeText(track.cover_path || track.coverPath),
    plays: Number(track.plays ?? track.play_count ?? track.playCount) || 0,
    isAvailable: track.is_available === true,
    createdAt: safeText(track.created_at ?? track.createdAt),
  };
}

export default function DashboardRecentTracks({ tracks, loading, onSeeAll }) {
  const items = useMemo(() => {
    const list = Array.isArray(tracks) ? tracks : [];
    return list.slice(0, 5).map(normalize).filter(Boolean);
  }, [tracks]);

  const total = Array.isArray(tracks) ? tracks.length : 0;

  return (
    <Wrap>
      <Header>
        <Heading>
          <Title>Последние треки</Title>
          <Sub>{total > 0 ? `Всего ${formatCompactNumber(total)}` : 'Каталог пуст'}</Sub>
        </Heading>
        {typeof onSeeAll === 'function' ? (
          <SeeAll type="button" onClick={onSeeAll}>
            Все треки
            <FaArrowRight size={11} aria-hidden="true" />
          </SeeAll>
        ) : null}
      </Header>

      {loading ? (
        <LoadingRow>
          <SpinIcon><FaCircleNotch size={14} /></SpinIcon>
          Загрузка
        </LoadingRow>
      ) : null}

      {!loading && items.length === 0 ? (
        <EmptyRow>Ещё нет треков. Загрузите первый через кнопку выше.</EmptyRow>
      ) : null}

      {!loading && items.length > 0 ? (
        <List>
          {items.map((t) => {
            const cover = coverUrlFromPath(t.coverPath);
            return (
              <Row key={t.id || t.title}>
                <Cover>
                  {cover ? <CoverImg src={cover} alt="" /> : <CoverFallback aria-hidden="true"><FaPlay size={10} /></CoverFallback>}
                </Cover>
                <Meta>
                  <RowTitle title={t.title}>{t.title || 'Без названия'}</RowTitle>
                  <RowSub>
                    <StatusDot $active={t.isAvailable} aria-hidden="true" />
                    <span>{t.isAvailable ? 'Опубликован' : 'Черновик'}</span>
                    <Dot aria-hidden="true" />
                    <span>{formatDateShort(t.createdAt)}</span>
                  </RowSub>
                </Meta>
                <PlaysCell>
                  {t.plays > 0 ? (
                    <PlaysValue>
                      <FaPlay size={9} aria-hidden="true" />
                      {formatCompactNumber(t.plays)}
                    </PlaysValue>
                  ) : (
                    <PlaysMuted>—</PlaysMuted>
                  )}
                </PlaysCell>
              </Row>
            );
          })}
        </List>
      ) : null}
    </Wrap>
  );
}

const Wrap = styled.div`
  padding: 18px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.04);
  border: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  flex-wrap: wrap;
`;

const Heading = styled.div`
  min-width: 0;
`;

const Title = styled.h2`
  margin: 0;
  font-size: 13px;
  font-weight: 900;
  color: #fff;
  letter-spacing: -0.01em;
`;

const Sub = styled.div`
  margin-top: 4px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
`;

const SeeAll = styled.button`
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 999px;
  border: 0;
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
  font-family: inherit;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
  -webkit-tap-highlight-color: transparent;

  &:hover {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.28);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.7);
    outline-offset: 2px;
  }
`;

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const Row = styled.div`
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) 72px;
  gap: 12px;
  align-items: center;
  padding: 8px 10px;
  border-radius: 12px;
  border: 0;
  transition: background 0.15s ease;
  min-width: 0;

  &:hover {
    background: #101010;
  }

  @media (max-width: 520px) {
    grid-template-columns: 40px minmax(0, 1fr) auto;
    gap: 10px;
    padding: 8px;
  }
`;

const Cover = styled.div`
  width: 44px;
  height: 55px;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.06);
  border: 0;
  display: flex;
  align-items: center;
  justify-content: center;

  @media (max-width: 520px) {
    width: 40px;
    height: 50px;
    border-radius: 7px;
  }
`;

const CoverImg = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
`;

const CoverFallback = styled.div`
  color: rgba(255, 255, 255, 0.3);
`;

const Meta = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const RowTitle = styled.div`
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const RowSub = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.55);
  min-width: 0;

  > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const StatusDot = styled.span`
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: ${(p) => (p.$active ? 'rgba(110, 240, 140, 0.95)' : 'rgba(255, 255, 255, 0.35)')};
  flex-shrink: 0;
`;

const Dot = styled.span`
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.25);
  flex-shrink: 0;
`;

const PlaysCell = styled.div`
  text-align: right;
  min-width: 0;
`;

const PlaysValue = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.85);

  svg {
    color: rgba(255, 255, 255, 0.6);
  }
`;

const PlaysMuted = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.35);
`;

const EmptyRow = styled.div`
  padding: 14px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  color: rgba(255, 255, 255, 0.55);
  font-size: 12px;
  text-align: center;
`;

const spinAnim = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

const LoadingRow = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  padding: 10px 4px;
`;

const SpinIcon = styled.span`
  display: inline-flex;
  svg {
    animation: ${spinAnim} 0.9s linear infinite;
    color: rgba(255, 255, 255, 0.7);
  }
`;
