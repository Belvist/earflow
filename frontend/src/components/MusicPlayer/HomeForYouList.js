import React, { useMemo } from 'react';
import styled from 'styled-components';
import { FaPlay } from 'react-icons/fa';
import apiClient from '../../api/client';
import { usePlayerDispatch } from '../../context/PlayerContext';
import { COVER_ASPECT_RATIO } from '../../styles/mediaCover';
import { HomeRailSection, HomeSectionTitle } from './HomeDesktopShell.styles';

const SectionHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  width: 100%;
`;

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Row = styled.li``;

const RowBtn = styled.button`
  width: 100%;
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr) 40px;
  align-items: center;
  gap: 12px;
  padding: 8px 4px;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  border-radius: 12px;

  &:active {
    background: rgba(255, 255, 255, 0.06);
  }
`;

const Thumb = styled.div`
  width: 52px;
  aspect-ratio: ${COVER_ASPECT_RATIO};
  border-radius: 8px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
`;

const ThumbImg = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
`;

const Meta = styled.div`
  min-width: 0;
`;

const RowTitle = styled.div`
  font-family: 'Unbounded', sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const RowArtist = styled.div`
  margin-top: 3px;
  font-family: 'Unbounded', sans-serif;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const PlayCircle = styled.span`
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.22);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  justify-self: end;
`;

function pickForYouTracks(tracks, currentTrackIndex, limit = 8) {
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

export default function HomeForYouList({
  tracks,
  currentTrackIndex,
  title = 'Для вас',
  limit = 8,
}) {
  const { handleTrackSelect } = usePlayerDispatch();
  const items = useMemo(
    () => pickForYouTracks(tracks, currentTrackIndex, limit),
    [tracks, currentTrackIndex, limit],
  );

  if (!items.length) return null;

  return (
    <HomeRailSection data-testid="home-for-you-list">
      <SectionHead>
        <HomeSectionTitle as="h3">{title}</HomeSectionTitle>
      </SectionHead>
      <List>
        {items.map((track) => {
          const id = track?.id ?? track?.song_id;
          const cover = apiClient.getCoverUrl(track);
          return (
            <Row key={String(id)}>
              <RowBtn
                type="button"
                onClick={() => {
                  void handleTrackSelect(track);
                }}
              >
                <Thumb>
                  {cover ? <ThumbImg src={cover} alt="" loading="lazy" decoding="async" /> : null}
                </Thumb>
                <Meta>
                  <RowTitle>{track?.title || 'Без названия'}</RowTitle>
                  <RowArtist>{track?.artist || ''}</RowArtist>
                </Meta>
                <PlayCircle aria-hidden="true">
                  <FaPlay size={11} style={{ marginLeft: 2 }} />
                </PlayCircle>
              </RowBtn>
            </Row>
          );
        })}
      </List>
    </HomeRailSection>
  );
}
