import React from 'react';
import styled from 'styled-components';

import { resolveStatIcon } from './iconMap';

export default function SecurityStats({ stats }) {
    const items = Array.isArray(stats) ? stats : [];

    return (
        <Grid>
            {items.map((stat) => {
                const Icon = resolveStatIcon(stat?.icon);
                return (
                    <Tile key={stat.id} $tone={stat.tone || 'neutral'}>
                        <IconBox $tone={stat.tone || 'neutral'} aria-hidden="true">
                            <Icon size={16} />
                        </IconBox>
                        <Body>
                            <Label>{stat.label || ''}</Label>
                            <Value>{stat.value || '—'}</Value>
                            {stat.sub ? <Sub>{stat.sub}</Sub> : null}
                        </Body>
                    </Tile>
                );
            })}
        </Grid>
    );
}

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;

  @media (max-width: 900px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @media (max-width: 540px) {
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
  border: 0;
  color: #fff;

  background: ${(p) => {
        if (p.$tone === 'ok') return 'rgba(255, 255, 255, 0.12)';
        if (p.$tone === 'warn') return 'rgba(255, 255, 255, 0.10)';
        if (p.$tone === 'danger') return 'rgba(255, 255, 255, 0.10)';
        return 'rgba(255, 255, 255, 0.08)';
    }};
  border-color: ${(p) => {
        if (p.$tone === 'ok') return 'rgba(255, 255, 255, 0.12)';
        if (p.$tone === 'warn') return 'rgba(255, 255, 255, 0.10)';
        if (p.$tone === 'danger') return 'rgba(255, 255, 255, 0.10)';
        return 'rgba(255, 255, 255, 0.08)';
    }};
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
  font-size: 24px;
  font-weight: 900;
  color: #fff;
  letter-spacing: -0.02em;
  line-height: 1.05;
`;

const Sub = styled.div`
  font-size: 11px;
  color: rgba(255, 255, 255, 0.55);
`;
