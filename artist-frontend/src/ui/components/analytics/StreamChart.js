import React, { useMemo } from 'react';
import styled from 'styled-components';

function buildSvgPath(data, width, height, key) {
  if (!data || data.length === 0) return '';
  const values = data.map((d) => Number(d[key]) || 0);
  const max = Math.max(...values, 1);
  const step = width / Math.max(data.length - 1, 1);
  const points = values.map((v, i) => {
    const x = i * step;
    const y = height - (v / max) * height * 0.74 - height * 0.13;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return `M${points.join(' L')}`;
}

function buildAreaPath(linePath, width, height) {
  if (!linePath) return '';
  return `${linePath} L${width.toFixed(2)},${height.toFixed(2)} L0,${height.toFixed(2)} Z`;
}

export default function StreamChart({ data, periodLabel }) {
  const W = 960;
  const H = 280;

  const playsPath = useMemo(() => buildSvgPath(data, W, H, 'plays'), [data]);
  const listenersPath = useMemo(() => buildSvgPath(data, W, H, 'uniqueListeners'), [data]);
  const playsArea = useMemo(() => buildAreaPath(playsPath, W, H), [playsPath]);

  const totalPlays = useMemo(() => (data || []).reduce((s, d) => s + (Number(d.plays) || 0), 0), [data]);
  const totalListeners = useMemo(() => (data || []).reduce((s, d) => s + (Number(d.uniqueListeners) || 0), 0), [data]);

  if (!data || data.length === 0) {
    return (
      <Wrap>
        <Header>
          <TitleBlock>
            <Title>Прослушивания</Title>
            <Subtitle>Нет данных за выбранный период</Subtitle>
          </TitleBlock>
        </Header>
        <EmptyState>График появится после первых событий прослушивания</EmptyState>
      </Wrap>
    );
  }

  return (
    <Wrap>
      <Header>
        <TitleBlock>
          <Title>Прослушивания</Title>
          <Subtitle>{periodLabel}</Subtitle>
        </TitleBlock>
        <Legend>
          <LegendItem><LegendDot />Прослушивания <strong>{totalPlays.toLocaleString('ru-RU')}</strong></LegendItem>
          <LegendItem><LegendDot $muted />Уникальные <strong>{totalListeners.toLocaleString('ru-RU')}</strong></LegendItem>
        </Legend>
      </Header>

      <ChartContainer>
        <GridLines aria-hidden="true">
          <span />
          <span />
          <span />
        </GridLines>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height="100%">
          {playsArea && <path d={playsArea} fill="rgba(255, 255, 255, 0.04)" />}
          {playsPath && (
            <path
              d={playsPath}
              fill="none"
              stroke="rgba(255, 255, 255, 0.95)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {listenersPath && (
            <path
              d={listenersPath}
              fill="none"
              stroke="rgba(255, 255, 255, 0.42)"
              strokeWidth="2"
              strokeDasharray="7 8"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      </ChartContainer>
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
  gap: 20px;
  box-shadow: none;

  @media (max-width: 720px) {
    padding: 18px;
    border-radius: 22px;
  }
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 18px;
  flex-wrap: wrap;
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

const Subtitle = styled.div`
  margin-top: 7px;
  color: rgba(255, 255, 255, 0.46);
  font-size: 12px;
  font-weight: 750;
`;

const Legend = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
`;

const LegendItem = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: rgba(255, 255, 255, 0.62);
  font-size: 12px;
  font-weight: 750;

  strong {
    color: #fff;
    font-weight: 900;
    font-variant-numeric: tabular-nums;
  }
`;

const LegendDot = styled.span`
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: ${(p) => (p.$muted ? 'rgba(255,255,255,0.42)' : '#fff')};
  box-shadow: none;
`;

const ChartContainer = styled.div`
  position: relative;
  width: 100%;
  height: clamp(240px, 29vw, 360px);
  border-radius: 22px;
  background: #101010;
  border: 0;
  overflow: hidden;

  svg {
    position: relative;
    z-index: 1;
    display: block;
    padding: 14px 0 10px;
    box-sizing: border-box;
  }
`;

const GridLines = styled.div`
  position: absolute;
  inset: 18px 0 18px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  pointer-events: none;

  span {
    width: 100%;
    height: 1px;
    background: rgba(255, 255, 255, 0.045);
  }
`;

const EmptyState = styled.div`
  min-height: 220px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.46);
  font-size: 13px;
  font-weight: 700;
  border-radius: 22px;
  background: #101010;
  border: 0;
`;