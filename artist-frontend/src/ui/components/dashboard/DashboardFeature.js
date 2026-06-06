import React, { useMemo } from 'react';
import styled from 'styled-components';
import { FaPlay, FaPlus, FaArrowRight, FaFire } from 'react-icons/fa';

import { safeText, formatCompactNumber, coverUrlFromPath } from './formatters';

function pickTopTrack(tracks, metaTopTrackId) {
  const list = Array.isArray(tracks) ? tracks : [];
  if (list.length === 0) return null;

  const targetId = safeText(metaTopTrackId).trim();
  if (targetId) {
    const hit = list.find((t) => safeText(t?.id) === targetId);
    if (hit) return hit;
  }

  let best = null;
  let bestPlays = -1;
  for (const t of list) {
    const plays = Number(t?.plays ?? t?.play_count ?? t?.playCount ?? 0);
    if (Number.isFinite(plays) && plays > bestPlays) {
      best = t;
      bestPlays = plays;
    }
  }
  return best || list[0];
}

export default function DashboardFeature({ tracks, meta, onUploadClick, onOpenTrack }) {
  const topTrack = useMemo(() => pickTopTrack(tracks, meta?.topTrack?.id), [tracks, meta]);
  const coverUrl = useMemo(() => (topTrack ? coverUrlFromPath(topTrack.cover_path || topTrack.coverPath) : ''), [topTrack]);
  const title = safeText(topTrack?.title).trim();
  const playsRaw = Number(topTrack?.plays ?? topTrack?.play_count ?? topTrack?.playCount);
  const plays = Number.isFinite(playsRaw) && playsRaw > 0 ? playsRaw : 0;

  return (
    <Grid>
      <TopTrack>
        <CardHeader>
          <EyebrowRow>
            <FaFire size={11} aria-hidden="true" />
            Самый популярный трек
          </EyebrowRow>
        </CardHeader>

        {topTrack ? (
          <TrackRow>
            <Cover>
              {coverUrl ? <CoverImg src={coverUrl} alt="" /> : <CoverFallback aria-hidden="true"><FaPlay size={14} /></CoverFallback>}
            </Cover>
            <TrackInfo>
              <TrackTitle title={title}>{title || 'Без названия'}</TrackTitle>
              <TrackStats>
                {plays > 0 ? (
                  <StatPill>
                    <FaPlay size={9} aria-hidden="true" />
                    {formatCompactNumber(plays)}
                  </StatPill>
                ) : (
                  <StatMuted>Ещё нет прослушиваний</StatMuted>
                )}
              </TrackStats>
            </TrackInfo>
            {typeof onOpenTrack === 'function' ? (
              <OpenButton type="button" onClick={() => onOpenTrack(topTrack)} aria-label="Открыть трек">
                <FaArrowRight size={12} aria-hidden="true" />
              </OpenButton>
            ) : null}
          </TrackRow>
        ) : (
          <EmptyBody>
            <EmptyTitle>Пока нет треков</EmptyTitle>
            <EmptySub>Загрузите первый трек — он появится здесь</EmptySub>
          </EmptyBody>
        )}
      </TopTrack>

      <UploadCta>
        <CtaEyebrow>Новый релиз</CtaEyebrow>
        <CtaTitle>Загрузите трек или альбом</CtaTitle>
        <CtaDesc>WAV или FLAC, обложка 4:5, мастер до 500 МБ. Публикация — сразу после модерации.</CtaDesc>
        <CtaButton type="button" onClick={onUploadClick}>
          <FaPlus size={12} aria-hidden="true" />
          Загрузить
        </CtaButton>
      </UploadCta>
    </Grid>
  );
}

const Grid = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
  gap: 14px;

  @media (max-width: 860px) {
    grid-template-columns: 1fr;
  }
`;

const Card = styled.div`
  padding: 18px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.04);
  border: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
`;

const TopTrack = styled(Card)``;

const CardHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
`;

const EyebrowRow = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);

  svg {
    color: rgba(255, 255, 255, 0.82);
  }
`;

const TrackRow = styled.div`
  display: grid;
  grid-template-columns: 68px minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  min-width: 0;
`;

const Cover = styled.div`
  width: 68px;
  height: 85px;
  border-radius: 12px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.05);
  border: 0;
  display: flex;
  align-items: center;
  justify-content: center;
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
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.35);
`;

const TrackInfo = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const TrackTitle = styled.div`
  font-size: 14px;
  font-weight: 800;
  color: #fff;
  line-height: 1.2;
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
`;

const TrackStats = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
`;

const StatPill = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  font-size: 11px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
`;

const StatMuted = styled.span`
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
`;

const OpenButton = styled.button`
  appearance: none;
  width: 36px;
  height: 36px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  border: 0;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
  -webkit-tap-highlight-color: transparent;

  &:hover {
    background: rgba(255, 255, 255, 0.14);
    border-color: rgba(255, 255, 255, 0.28);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.7);
    outline-offset: 2px;
  }
`;

const EmptyBody = styled.div`
  padding: 8px 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const EmptyTitle = styled.div`
  font-size: 15px;
  font-weight: 800;
  color: rgba(255, 255, 255, 0.9);
`;

const EmptySub = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
`;

const UploadCta = styled(Card)`
  background: #080808;
  justify-content: space-between;
`;

const CtaEyebrow = styled.div`
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
`;

const CtaTitle = styled.div`
  font-size: 15px;
  font-weight: 900;
  color: #fff;
  letter-spacing: -0.01em;
  line-height: 1.2;
`;

const CtaDesc = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  line-height: 1.5;
`;

const CtaButton = styled.button`
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 44px;
  padding: 0 22px;
  border-radius: 999px;
  border: 0;
  background: #fff;
  color: #000;
  font-family: inherit;
  font-weight: 800;
  font-size: 11px;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: transform 0.15s ease;
  -webkit-tap-highlight-color: transparent;
  align-self: flex-start;

  &:hover {
    transform: scale(1.02);
  }

  &:active {
    transform: scale(0.98);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.85);
    outline-offset: 3px;
  }
`;
