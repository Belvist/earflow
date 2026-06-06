import React from 'react';
import styled from 'styled-components';
import { FaHeadphones, FaHeart, FaUsers } from 'react-icons/fa';

import { formatCompactNumber } from './formatters';

function StatTile({ icon, label, value, sub }) {
  return (
    <Tile>
      <IconBox aria-hidden="true">{icon}</IconBox>
      <Body>
        <Label>{label}</Label>
        <Value>{value}</Value>
        {sub ? <Sub>{sub}</Sub> : null}
      </Body>
    </Tile>
  );
}

export default function DashboardStats({ meta }) {
  const monthlyPlaysRaw = Number(meta?.monthlyPlays);
  const totalPlaysAllTimeRaw = Number(meta?.totalPlaysAllTime);
  const uniqueListenersMonthlyRaw = Number(meta?.uniqueListenersMonthly);
  const likesCountRaw = Number(meta?.likesCount);

  const monthlyPlays = Number.isFinite(monthlyPlaysRaw) && monthlyPlaysRaw > 0 ? monthlyPlaysRaw : 0;
  const totalPlaysAllTime = Number.isFinite(totalPlaysAllTimeRaw) && totalPlaysAllTimeRaw > 0 ? totalPlaysAllTimeRaw : 0;
  const uniqueListenersMonthly = Number.isFinite(uniqueListenersMonthlyRaw) && uniqueListenersMonthlyRaw > 0 ? uniqueListenersMonthlyRaw : 0;
  const likesCount = Number.isFinite(likesCountRaw) && likesCountRaw > 0 ? likesCountRaw : 0;


  return (
    <Grid>
      <StatTile
        icon={<FaHeadphones size={16} />}
        label="Прослушивания / месяц"
        value={formatCompactNumber(monthlyPlays)}
        sub={monthlyPlays > 0 ? null : 'Данные появятся после первых прослушиваний'}
      />
      <StatTile
        icon={<FaHeadphones size={16} />}
        label="Всего прослушиваний"
        value={formatCompactNumber(totalPlaysAllTime)}
        sub={totalPlaysAllTime > 0 ? 'за всё время' : 'нет данных'}
      />
      <StatTile
        icon={<FaUsers size={16} />}
        label="Уникальные слушатели"
        value={formatCompactNumber(uniqueListenersMonthly)}
        sub={uniqueListenersMonthly > 0 ? 'за месяц' : 'нет данных'}
      />
      <StatTile
        icon={<FaHeart size={16} />}
        label="Лайки"
        value={formatCompactNumber(likesCount)}
        sub={likesCount > 0 ? null : 'нет лайков'}
      />
    </Grid>
  );
}

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;

  @media (max-width: 1024px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
    gap: 10px;
  }
`;

const Tile = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 18px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.04);
  border: 0;
  min-width: 0;
  transition: border-color 0.15s ease, background 0.15s ease;

  &:hover {
    border-color: rgba(255, 255, 255, 0.18);
    background: rgba(255, 255, 255, 0.06);
  }
`;

const IconBox = styled.div`
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.08);
  border: 0;
  color: #fff;
`;

const Body = styled.div`
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Label = styled.div`
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Value = styled.div`
  font-size: 21px;
  font-weight: 900;
  color: #fff;
  letter-spacing: -0.02em;
  line-height: 1.05;
`;

const Sub = styled.div`
  font-size: 11px;
  color: rgba(255, 255, 255, 0.55);
`;
