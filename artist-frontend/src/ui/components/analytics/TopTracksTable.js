import React, { useMemo } from 'react';
import styled from 'styled-components';
import { FaHeart, FaListUl, FaPlay, FaUsers } from 'react-icons/fa';

import { coverUrlFromPath, formatCompactNumber } from '../dashboard/formatters';

function normalizeCoverForClient(raw) {
  if (!raw) return '';
  return coverUrlFromPath(raw);
}

function metricValue(track, keys) {
  for (const key of keys) {
    const n = Number(track?.[key]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

export default function TopTracksTable({ tracks }) {
  const items = useMemo(() => {
    if (!Array.isArray(tracks)) return [];
    return tracks.slice(0, 20);
  }, [tracks]);

  if (items.length === 0) {
    return (
      <Wrap>
        <Header>
          <Title>Топ треков</Title>
        </Header>
        <EmptyState>Данные о треках появятся после первых прослушиваний</EmptyState>
      </Wrap>
    );
  }

  return (
    <Wrap>
      <Header>
        <TitleBlock>
          <Title>Топ треков</Title>
          <Sub>{items.length} {items.length === 1 ? 'трек' : 'треков'} в рейтинге</Sub>
        </TitleBlock>
      </Header>

      <TableHead>
        <HeadCell $center>#</HeadCell>
        <HeadCell>Трек</HeadCell>
        <HeadCellIcon title="Прослушивания"><FaPlay size={10} /></HeadCellIcon>
        <HeadCellIcon title="Уникальные слушатели"><FaUsers size={10} /></HeadCellIcon>
        <HeadCellIcon title="Лайки"><FaHeart size={10} /></HeadCellIcon>
        <HeadCellIcon title="Добавления в плейлисты"><FaListUl size={10} /></HeadCellIcon>
      </TableHead>

      <List>
        {items.map((track, idx) => {
          const cover = normalizeCoverForClient(track.coverPath || track.cover_path);
          const streams = metricValue(track, ['streamCount', 'plays']);
          const listeners = metricValue(track, ['uniqueListeners']);
          const likes = metricValue(track, ['likes', 'likesCount']);
          const playlistAdds = metricValue(track, ['playlistAdds']);

          return (
            <Row key={track.id || idx}>
              <RankCell>{idx + 1}</RankCell>
              <TrackCell>
                <Cover>
                  {cover ? <CoverImg src={cover} alt="" loading="lazy" /> : <CoverFallback />}
                </Cover>
                <TrackMeta>
                  <TrackTitle title={track.title}>{track.title || 'Без названия'}</TrackTitle>
                  {track.album ? <TrackAlbum>{track.album}</TrackAlbum> : null}
                </TrackMeta>
              </TrackCell>
              <MetricCell>{formatCompactNumber(streams)}</MetricCell>
              <MetricCell>{formatCompactNumber(listeners)}</MetricCell>
              <MetricCell>{formatCompactNumber(likes)}</MetricCell>
              <MetricCell>{formatCompactNumber(playlistAdds)}</MetricCell>
            </Row>
          );
        })}
      </List>
    </Wrap>
  );
}

const Wrap = styled.section`
  padding: 22px;
  border-radius: 28px;
  background: #080808;
  border: 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: 0;

  @media (max-width: 720px) {
    padding: 18px;
    border-radius: 22px;
  }
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
`;

const TitleBlock = styled.div`
  min-width: 0;
`;

const Title = styled.h2`
  margin: 0;
  color: #fff;
  font-size: 21px;
  font-weight: 950;
  letter-spacing: -0.045em;
  line-height: 1;
`;

const Sub = styled.div`
  margin-top: 7px;
  color: rgba(255, 255, 255, 0.46);
  font-size: 12px;
  font-weight: 750;
`;

const TableHead = styled.div`
  display: grid;
  grid-template-columns: 44px minmax(190px, 1fr) 78px 78px 66px 66px;
  gap: 10px;
  align-items: center;
  padding: 0 12px 2px;

  @media (max-width: 720px) {
    grid-template-columns: 34px minmax(0, 1fr) 58px 58px;
    padding: 0 4px 2px;
  }
`;

const HeadCell = styled.div`
  color: rgba(255, 255, 255, 0.34);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.12em;
  line-height: 1;
  text-transform: uppercase;
  text-align: ${(p) => (p.$center ? 'center' : 'left')};
`;

const HeadCellIcon = styled.div`
  display: flex;
  justify-content: flex-end;
  color: rgba(255, 255, 255, 0.32);

  @media (max-width: 720px) {
    &:nth-child(n+5) {
      display: none;
    }
  }
`;

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const Row = styled.div`
  display: grid;
  grid-template-columns: 44px minmax(190px, 1fr) 78px 78px 66px 66px;
  gap: 10px;
  align-items: center;
  min-height: 66px;
  padding: 8px 12px;
  border-radius: 18px;
  border: 0;
  transition: background 0.15s ease;

  &:hover {
    background: #101010;
  }

  @media (max-width: 720px) {
    grid-template-columns: 34px minmax(0, 1fr) 58px 58px;
    padding: 8px 4px;

    & > *:nth-child(n+5) {
      display: none;
    }
  }
`;

const RankCell = styled.div`
  color: rgba(255, 255, 255, 0.5);
  font-size: 13px;
  font-weight: 900;
  text-align: center;
  font-variant-numeric: tabular-nums;
`;

const TrackCell = styled.div`
  display: flex;
  align-items: center;
  gap: 13px;
  min-width: 0;
`;

const Cover = styled.div`
  width: 44px;
  height: 44px;
  border-radius: 12px;
  overflow: hidden;
  background: #181818;
  border: 0;
  flex-shrink: 0;
`;

const CoverImg = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
`;

const CoverFallback = styled.div`
  width: 100%;
  height: 100%;
  background: #202020;
`;

const TrackMeta = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const TrackTitle = styled.div`
  color: #fff;
  font-size: 14px;
  font-weight: 900;
  letter-spacing: -0.025em;
  line-height: 1.1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const TrackAlbum = styled.div`
  color: rgba(255, 255, 255, 0.45);
  font-size: 11px;
  font-weight: 700;
  line-height: 1.1;
  overflow: hidden;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
`;

const MetricCell = styled.div`
  color: rgba(255, 255, 255, 0.88);
  font-size: 13px;
  font-weight: 900;
  text-align: right;
  font-variant-numeric: tabular-nums;
`;

const EmptyState = styled.div`
  min-height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.46);
  font-size: 13px;
  font-weight: 700;
  text-align: center;
`;