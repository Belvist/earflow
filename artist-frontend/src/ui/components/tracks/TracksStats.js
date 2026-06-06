import React, { useMemo } from 'react';
import styled from 'styled-components';
import { FaMusic, FaCheckCircle, FaRegFileAudio } from 'react-icons/fa';

import { formatCompactNumber } from '../dashboard/formatters';

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

export default function TracksStats({ tracks, drafts }) {
  const { total, published, inProgress } = useMemo(() => {
    const list = Array.isArray(tracks) ? tracks : [];
    const totalCount = list.length;
    const publishedCount = list.reduce(
      (acc, t) => acc + (t && t.is_available === true ? 1 : 0),
      0,
    );
    const unpublishedCount = Math.max(0, totalCount - publishedCount);
    const draftsLen = Array.isArray(drafts) ? drafts.length : 0;
    return {
      total: totalCount,
      published: publishedCount,
      inProgress: unpublishedCount + draftsLen,
    };
  }, [tracks, drafts]);

  return (
    <Grid>
      <StatTile
        icon={<FaMusic size={16} />}
        label="Всего треков"
        value={formatCompactNumber(total)}
        sub={total === 0 ? 'Загрузите первый трек' : 'в каталоге'}
      />
      <StatTile
        icon={<FaCheckCircle size={16} />}
        label="Опубликовано"
        value={formatCompactNumber(published)}
        sub={published === 0 ? 'ожидает публикации' : 'доступно слушателям'}
      />
      <StatTile
        icon={<FaRegFileAudio size={16} />}
        label="Черновики и загрузки"
        value={formatCompactNumber(inProgress)}
        sub={inProgress === 0 ? 'нет ожидающих' : 'требуют действий'}
      />
    </Grid>
  );
}

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;

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
