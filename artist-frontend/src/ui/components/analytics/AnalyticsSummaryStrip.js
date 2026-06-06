import React, { useMemo } from 'react';
import styled from 'styled-components';
import { FaHeart, FaHeadphones, FaMusic, FaUsers } from 'react-icons/fa';

import { formatCompactNumber } from '../dashboard/formatters';

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function MetricCard({ icon, label, value, sub, $featured }) {
  return (
    <Card $featured={$featured}>
      <CardTop>
        <IconBox aria-hidden="true">{icon}</IconBox>
        <CardLabel>{label}</CardLabel>
      </CardTop>
      <CardValue>{value}</CardValue>
      {sub ? <CardSub>{sub}</CardSub> : null}
    </Card>
  );
}

export default function AnalyticsSummaryStrip({ meta, dailyTrend }) {
  const periodPlays = useMemo(() => {
    if (!Array.isArray(dailyTrend)) return 0;
    return dailyTrend.reduce((s, d) => s + (Number(d.plays) || 0), 0);
  }, [dailyTrend]);

  const totalPlays = useMemo(() => positiveNumber(meta?.totalPlaysAllTime || meta?.totalPlays), [meta]);
  const uniqueMonthly = useMemo(() => positiveNumber(meta?.uniqueListenersMonthly), [meta]);
  const uniqueAllTime = useMemo(() => positiveNumber(meta?.uniqueListenersAllTime), [meta]);
  const likes = useMemo(() => positiveNumber(meta?.likesCount), [meta]);
  const trackCount = useMemo(() => positiveNumber(meta?.trackCount), [meta]);
  const albumCount = useMemo(() => positiveNumber(meta?.albumCount), [meta]);

  return (
    <Grid>
      <MetricCard
        icon={<FaHeadphones size={15} />}
        label="За период"
        value={formatCompactNumber(periodPlays)}
        sub="прослушиваний"
        $featured
      />
      <MetricCard
        icon={<FaHeadphones size={15} />}
        label="Всего"
        value={formatCompactNumber(totalPlays)}
        sub="за всё время"
      />
      <MetricCard
        icon={<FaUsers size={15} />}
        label="Аудитория"
        value={formatCompactNumber(uniqueMonthly)}
        sub={`${formatCompactNumber(uniqueAllTime)} всего`}
      />
      <MetricCard
        icon={<FaHeart size={15} />}
        label="Реакции"
        value={formatCompactNumber(likes)}
        sub="лайков"
      />
      <MetricCard
        icon={<FaMusic size={15} />}
        label="Каталог"
        value={String(trackCount)}
        sub={`${albumCount} ${albumCount === 1 ? 'альбом' : 'альбомов'}`}
      />
    </Grid>
  );
}

const Grid = styled.section`
  display: grid;
  grid-template-columns: minmax(220px, 1.28fr) repeat(4, minmax(150px, 1fr));
  gap: 12px;

  @media (max-width: 1100px) {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  @media (max-width: 720px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @media (max-width: 480px) {
    grid-template-columns: 1fr;
  }
`;

const Card = styled.article`
  min-height: 126px;
  padding: 18px;
  border-radius: 22px;
  background: ${(p) => (p.$featured ? '#101010' : '#080808')};
  border: 0;
  box-shadow: none;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-width: 0;
  transition: background 0.16s ease;

  &:hover {
    background: #121212;
  }
`;

const CardTop = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
`;

const IconBox = styled.div`
  width: 34px;
  height: 34px;
  border-radius: 12px;
  background: #181818;
  border: 0;
  color: rgba(255, 255, 255, 0.92);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
`;

const CardLabel = styled.div`
  color: rgba(255, 255, 255, 0.54);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.13em;
  line-height: 1.15;
  text-transform: uppercase;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const CardValue = styled.div`
  margin-top: 18px;
  color: #fff;
  font-size: clamp(30px, 4vw, 46px);
  font-weight: 950;
  letter-spacing: -0.075em;
  line-height: 0.9;
  font-variant-numeric: tabular-nums;
`;

const CardSub = styled.div`
  margin-top: 10px;
  color: rgba(255, 255, 255, 0.46);
  font-size: 11px;
  font-weight: 750;
  line-height: 1.25;
`;