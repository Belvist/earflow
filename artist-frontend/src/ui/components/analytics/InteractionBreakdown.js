import React, { useMemo } from 'react';
import styled from 'styled-components';

const TYPE_LABELS = {
  play: 'Прослушивание',
  skip: 'Пропуск',
  like: 'Лайк',
  dislike: 'Дизлайк',
  complete: 'Дослушивание',
};

const TYPE_COLORS = {
  play: '#38bdf8',
  skip: '#f97316',
  like: '#ec4899',
  dislike: '#ef4444',
  complete: '#22c55e',
};

function getColor(type) {
  return TYPE_COLORS[type] || '#a78bfa';
}

function getLabel(type) {
  return TYPE_LABELS[type] || type;
}

export default function InteractionBreakdown({ data }) {
  const items = useMemo(() => {
    if (!Array.isArray(data) || data.length === 0) return [];
    const total = data.reduce((s, d) => s + (Number(d.count) || 0), 0);
    if (total === 0) return [];
    return data
      .filter((d) => Number(d.count) > 0)
      .map((d) => ({
        type: String(d.type || 'unknown'),
        count: Number(d.count) || 0,
        pct: ((Number(d.count) || 0) / total) * 100,
      }))
      .sort((a, b) => b.count - a.count);
  }, [data]);

  if (items.length === 0) {
    return (
      <Wrap>
        <Title>Типы взаимодействий</Title>
        <EmptyState>Нет данных</EmptyState>
      </Wrap>
    );
  }

  const total = items.reduce((s, i) => s + i.count, 0);

  return (
    <Wrap>
      <Title>Типы взаимодействий</Title>

      <BarContainer>
        {items.map((item) => (
          <BarSegment
            key={item.type}
            $color={getColor(item.type)}
            $width={`${item.pct}%`}
            title={`${getLabel(item.type)}: ${item.count.toLocaleString('ru-RU')} (${item.pct.toFixed(1)}%)`}
          />
        ))}
      </BarContainer>

      <LegendGrid>
        {items.map((item) => (
          <LegendItem key={item.type}>
            <LegendDot $color={getColor(item.type)} />
            <LegendLabel>{getLabel(item.type)}</LegendLabel>
            <LegendValue>{item.count.toLocaleString('ru-RU')}</LegendValue>
            <LegendPct>{item.pct.toFixed(1)}%</LegendPct>
          </LegendItem>
        ))}
      </LegendGrid>

      <Total>Всего: {total.toLocaleString('ru-RU')}</Total>
    </Wrap>
  );
}

const Wrap = styled.div`
  padding: 20px;
  border-radius: 18px;
  background: #080808;
  border: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

const Title = styled.h2`
  margin: 0;
  font-size: 16px;
  font-weight: 900;
  color: #fff;
  letter-spacing: -0.01em;
`;

const BarContainer = styled.div`
  display: flex;
  width: 100%;
  height: 18px;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.06);
`;

const BarSegment = styled.div`
  height: 100%;
  background: ${(p) => p.$color || '#a78bfa'};
  width: ${(p) => p.$width || '0%'};
  min-width: ${(p) => (parseFloat(p.$width || '0') > 0 ? '3px' : '0')};
  transition: width 0.4s ease;
`;

const LegendGrid = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 10px 20px;
`;

const LegendItem = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
`;

const LegendDot = styled.span`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${(p) => p.$color || '#a78bfa'};
  flex-shrink: 0;
`;

const LegendLabel = styled.span`
  color: rgba(255, 255, 255, 0.7);
  font-weight: 600;
`;

const LegendValue = styled.span`
  color: rgba(255, 255, 255, 0.9);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
`;

const LegendPct = styled.span`
  color: rgba(255, 255, 255, 0.4);
  font-size: 11px;
`;

const Total = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
  text-align: right;
`;

const EmptyState = styled.div`
  text-align: center;
  color: rgba(255, 255, 255, 0.45);
  font-size: 13px;
  padding: 20px 0;
`;
