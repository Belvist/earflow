import React, { useMemo } from 'react';
import styled from 'styled-components';
import { FaAlignLeft, FaImage, FaShieldAlt } from 'react-icons/fa';

const BIO_MAX = 1000;

function StatTile({ icon, label, value, sub, tone }) {
    return (
        <Tile $tone={tone}>
            <IconBox $tone={tone} aria-hidden="true">{icon}</IconBox>
            <Body>
                <Label>{label}</Label>
                <Value>{value}</Value>
                {sub ? <Sub>{sub}</Sub> : null}
            </Body>
        </Tile>
    );
}

export default function ManageStats({ bioLength, hasAvatar, hasBanner, mfaEnabled }) {
    const bioLen = Math.max(0, Number.isFinite(Number(bioLength)) ? Number(bioLength) : 0);
    const avatar = hasAvatar === true;
    const banner = hasBanner === true;
    const mfa = mfaEnabled === true;

    const bioTone = useMemo(() => {
        if (bioLen > BIO_MAX) return 'warn';
        if (bioLen === 0) return 'warn';
        return 'ok';
    }, [bioLen]);

    const mediaTone = useMemo(() => {
        if (avatar && banner) return 'ok';
        if (avatar || banner) return 'warn';
        return 'warn';
    }, [avatar, banner]);

    const mediaDone = (avatar ? 1 : 0) + (banner ? 1 : 0);
    const mediaSub = useMemo(() => {
        if (mediaDone === 2) return 'Аватар и баннер загружены';
        const missing = [];
        if (!avatar) missing.push('аватар');
        if (!banner) missing.push('баннер');
        return `Добавьте: ${missing.join(' и ')}`;
    }, [avatar, banner, mediaDone]);

    const bioSub = useMemo(() => {
        if (bioLen > BIO_MAX) return `Превышение на ${bioLen - BIO_MAX}`;
        if (bioLen === 0) return 'Добавьте описание';
        const left = BIO_MAX - bioLen;
        return `Осталось ${left}`;
    }, [bioLen]);

    return (
        <Grid>
            <StatTile
                icon={<FaAlignLeft size={16} />}
                label="Биография"
                value={`${bioLen} / ${BIO_MAX}`}
                sub={bioSub}
                tone={bioTone}
            />
            <StatTile
                icon={<FaImage size={16} />}
                label="Медиа"
                value={`${mediaDone} / 2`}
                sub={mediaSub}
                tone={mediaTone}
            />
            <StatTile
                icon={<FaShieldAlt size={16} />}
                label="Безопасность"
                value={mfa ? '2FA' : '—'}
                sub={mfa ? 'Активна — можно сохранять' : 'Требуется для сохранения'}
                tone={mfa ? 'ok' : 'warn'}
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
  border: 0;
  color: #fff;

  background: ${(p) => {
        if (p.$tone === 'ok') return 'rgba(255, 255, 255, 0.12)';
        if (p.$tone === 'warn') return 'rgba(255, 255, 255, 0.10)';
        return 'rgba(255, 255, 255, 0.08)';
    }};
  border-color: ${(p) => {
        if (p.$tone === 'ok') return 'rgba(255, 255, 255, 0.12)';
        if (p.$tone === 'warn') return 'rgba(255, 255, 255, 0.10)';
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
