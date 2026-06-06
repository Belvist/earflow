import React, { useMemo, useState } from 'react';
import styled from 'styled-components';
import { FaCheckCircle } from 'react-icons/fa';

const Section = styled.section`
  max-width: 980px;
  margin: 0 auto;
  padding: 24px 12px 0;
  font-family: 'Unbounded', sans-serif;

  @media (min-width: 521px) {
    padding: 44px 16px 0;
  }
`;

const Title = styled.h2`
  margin: 0 0 12px;
  font-size: 16px;
  font-weight: 900;
  letter-spacing: -0.02em;
  color: #fff;

  @media (min-width: 521px) {
    margin: 0 0 18px;
    font-size: 22px;
  }
`;

const Card = styled.div`
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  padding: 24px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 260px;
  gap: 28px;
  align-items: start;

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
    gap: 20px;
    padding: 20px;
  }
`;

const BioCol = styled.div`
  min-width: 0;
`;

const BioText = styled.p`
  margin: 0;
  font-size: 12px;
  line-height: 1.55;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.85);

  @media (min-width: 521px) {
    font-size: 14px;
    line-height: 1.6;
  }
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'Unbounded', sans-serif;

  display: ${(p) => (p.$collapsed ? '-webkit-box' : 'block')};
  -webkit-line-clamp: ${(p) => (p.$collapsed ? 5 : 'unset')};
  -webkit-box-orient: vertical;
  overflow: ${(p) => (p.$collapsed ? 'hidden' : 'visible')};
`;

const ToggleBtn = styled.button`
  margin-top: 10px;
  background: transparent;
  border: none;
  padding: 6px 0;
  color: rgba(255, 255, 255, 0.65);
  font-family: 'Unbounded', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  cursor: pointer;
  text-transform: uppercase;
  transition: color 0.15s ease;

  &:hover {
    color: #fff;
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.85);
    outline-offset: 2px;
    border-radius: 4px;
  }
`;

const StatsList = styled.dl`
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  padding-left: 22px;

  @media (max-width: 720px) {
    border-left: none;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    padding-left: 0;
    padding-top: 16px;
  }
`;

const StatRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const StatLabel = styled.dt`
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.45);
`;

const StatValue = styled.dd`
  margin: 0;
  font-size: 13px;
  font-weight: 800;
  color: #fff;
  display: inline-flex;

  @media (min-width: 521px) {
    font-size: 15px;
  }
  align-items: center;
  gap: 6px;

  svg {
    color: #fff;
  }
`;

const BIO_COLLAPSE_THRESHOLD = 320;

function formatCompactNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return '0';
    try {
        return new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
    } catch {
        return String(Math.round(n));
    }
}

export default function ArtistAboutSection({ bio, isVerified, trackCount, albumCount, totalPlays }) {
    const [expanded, setExpanded] = useState(false);

    const safeBio = typeof bio === 'string' ? bio.trim() : '';
    const needsCollapse = safeBio.length > BIO_COLLAPSE_THRESHOLD;

    const stats = useMemo(() => {
        const list = [];

        if (isVerified) {
            list.push({
                label: 'Статус',
                value: (
                    <>
                        <FaCheckCircle size={14} /> Подтверждён
                    </>
                ),
            });
        }

        const trackNum = Number(trackCount);
        if (Number.isFinite(trackNum) && trackNum > 0) {
            list.push({ label: 'Треки', value: formatCompactNumber(trackNum) });
        }

        const albumNum = Number(albumCount);
        if (Number.isFinite(albumNum) && albumNum > 0) {
            list.push({ label: 'Релизы', value: formatCompactNumber(albumNum) });
        }

        const playsNum = Number(totalPlays);
        if (totalPlays !== null && totalPlays !== undefined && Number.isFinite(playsNum) && playsNum > 0) {
            list.push({ label: 'Прослушиваний', value: formatCompactNumber(playsNum) });
        }

        return list;
    }, [isVerified, trackCount, albumCount, totalPlays]);

    if (!safeBio && stats.length === 0) return null;

    return (
        <Section>
            <Title>Об артисте</Title>
            <Card>
                <BioCol>
                    {safeBio ? (
                        <>
                            <BioText $collapsed={needsCollapse && !expanded}>{safeBio}</BioText>
                            {needsCollapse && (
                                <ToggleBtn type="button" onClick={() => setExpanded((v) => !v)}>
                                    {expanded ? 'Свернуть' : 'Читать дальше'}
                                </ToggleBtn>
                            )}
                        </>
                    ) : (
                        <BioText>Биография пока не добавлена.</BioText>
                    )}
                </BioCol>

                {stats.length > 0 && (
                    <StatsList>
                        {stats.map((s, i) => (
                            <StatRow key={`about-stat-${i}`}>
                                <StatLabel>{s.label}</StatLabel>
                                <StatValue>{s.value}</StatValue>
                            </StatRow>
                        ))}
                    </StatsList>
                )}
            </Card>
        </Section>
    );
}
