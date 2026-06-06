import React, { useMemo } from 'react';
import styled from 'styled-components';
import {
  FaCheckCircle,
  FaForward,
  FaClock,
  FaPercentage,
} from 'react-icons/fa';

function pct(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0%';
  return `${(n * 100).toFixed(1)}%`;
}

function formatDuration(ms) {
  const totalSec = Math.round(Number(ms) / 1000);
  if (!Number.isFinite(totalSec) || totalSec <= 0) return '0 сек';
  if (totalSec < 60) return `${totalSec} сек`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec > 0 ? `${min}м ${String(sec).padStart(2, '0')}с` : `${min} мин`;
}

function EngagementTile({ icon, label, value, sub, accent }) {
  return (
    <Tile $accent={accent}>
      <TopLine>
        <IconBox $accent={accent} aria-hidden="true">{icon}</IconBox>
        <Label>{label}</Label>
      </TopLine>
      <Value $accent={accent}>{value}</Value>
      {sub ? <Sub>{sub}</Sub> : null}
    </Tile>
  );
}

export default function EngagementPanel({ engagement }) {
  const data = useMemo(() => {
    if (!engagement || typeof engagement !== 'object') {
      return { avgDurationMs: 0, avgProgress: 0, completionRate: 0, skipRate: 0 };
    }
    return engagement;
  }, [engagement]);

  return (
    <Wrap>
      <Header>
        <Title>Вовлечённость</Title>
      </Header>
      <Grid>
        <EngagementTile
          icon={<FaClock size={15} />}
          label="Среднее время"
          value={formatDuration(data.avgDurationMs)}
          sub="прослушивания на трек"
          accent="#38bdf8"
        />
        <EngagementTile
          icon={<FaPercentage size={15} />}
          label="Средний прогресс"
          value={pct(data.avgProgress)}
          sub="от длительности"
          accent="#a78bfa"
        />
        <EngagementTile
          icon={<FaCheckCircle size={15} />}
          label="Дослушивания"
          value={pct(data.completionRate)}
          sub="доля complete / play"
          accent="#22c55e"
        />
        <EngagementTile
          icon={<FaForward size={15} />}
          label="Пропуски"
          value={pct(data.skipRate)}
          sub="доля skip / всего"
          accent="#f97316"
        />
      </Grid>
    </Wrap>
  );
}

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

const Header = styled.div``;

const Title = styled.h2`
  margin: 0;
  font-size: 16px;
  font-weight: 900;
  color: #fff;
  letter-spacing: -0.01em;
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;

  @media (max-width: 480px) {
    grid-template-columns: 1fr;
  }
`;

const Tile = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 126px;
  gap: 10px;
  padding: 16px 16px 15px;
  border-radius: 16px;
  background: #080808;
  border: 0;
  transition: background 0.15s ease;
  overflow: hidden;

  &:hover {
    background: #101010;
  }

  &::before {
    content: '';
    position: absolute;
    left: 0;
    top: 16px;
    bottom: 16px;
    width: 4px;
    border-radius: 999px;
    background: ${(p) => p.$accent || '#fff'};
  }
`;

const TopLine = styled.div`
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  min-width: 0;
`;

const IconBox = styled.div`
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: ${(p) => p.$accent || '#fff'};
  color: #050505;
`;

const Label = styled.div`
  min-width: 0;
  font-size: 9px;
  font-weight: 800;
  line-height: 1.22;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.5);
  overflow-wrap: normal;
`;

const Value = styled.div`
  font-size: clamp(22px, 3.1vw, 30px);
  font-weight: 900;
  color: ${(p) => p.$accent || '#fff'};
  letter-spacing: -0.02em;
  line-height: 0.98;
  overflow-wrap: normal;
`;

const Sub = styled.div`
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  line-height: 1.2;
`;
